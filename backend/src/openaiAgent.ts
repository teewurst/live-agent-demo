import OpenAI from "openai";
import type { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  buildSessionContextPrompt,
  EMIT_OUTPUT_TOOL,
} from "./agentTools.js";
import { AGENT_SYSTEM_PROMPT } from "./agentPrompt.js";
import { config } from "./config.js";
import {
  describeCustomerInfoArgsForGate,
  describeValidateArgsForGate,
} from "./crmDemoData.js";
import { AppError, isAbortError } from "./errors.js";
import { scheduleSpeakText, speakText } from "./speechStreamer.js";
import type { SpeechSequence } from "./speechStreamer.js";
import { executeBackendTool, GET_CUSTOMER_INFORMATION_TOOL } from "./toolExecutor.js";
import {
  ensureAgentTools,
  isCustomerInfoTool,
  isPublicInfoTool,
  isValidateTool,
} from "./mcpToolRegistry.js";
import {
  addMessage,
  addTimelineItem,
  updateTimelineItem,
} from "./sessions.js";
import { summarizeToolResult } from "./toolResultUtils.js";
import { writeEvent } from "./sse.js";
import type { ChatMessage, EmitOutputArgs, SessionState } from "./types.js";
import { AgentTurnLogger } from "./agentTurnLogger.js";
import { speakBackendToolPreamble } from "./toolLookupPreamble.js";
import type { TurnProfiler } from "./turnProfiler.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  baseURL: config.OPENAI_BASE_URL,
});

type RunAgentTurnOptions = {
  session: SessionState;
  res: Response;
  userText: string;
  signal: AbortSignal;
  sequence: SpeechSequence;
  logger?: AgentTurnLogger;
  profiler?: TurnProfiler;
  pendingSpeech: Promise<void>[];
};

type TurnSpeechState = {
  lastSpokenMessage: string;
  lastPreambleMessage: string;
  researchCalled: boolean;
};

function looksLikeAccountQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  const keywords = [
    "invoice",
    "rechnung",
    "billing",
    "subscription",
    "account profile",
    "open invoice",
    "overdue",
    "latest invoice",
    "my invoice",
    "my subscription",
    "my account",
    "look up my",
    "find my",
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

function buildHistoryMessages(history: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user" as const,
        content: `[Tool result ${message.toolName ?? "tool"}]: ${message.content}`,
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function gateBackendTool(
  session: SessionState,
  toolName: string,
  toolArgs: Record<string, unknown>,
): { allowed: true } | { allowed: false; result: unknown } {
  if (isValidateTool(toolName)) {
    const missing = describeValidateArgsForGate(toolArgs);
    if (missing) {
      return {
        allowed: false,
        result: {
          error: "MISSING_CREDENTIALS",
          message:
            `Do not call validate_customer until the caller has provided ${missing}. ` +
            "Preferred: customer_number + phone_password (auth_method phone_password). " +
            "Alternative: customer_number + full_name + birth_date (auth_method name_birthdate). " +
            "Ask for missing details with emit_output and is_final=true, then end the turn.",
        },
      };
    }
  }

  if (isCustomerInfoTool(toolName)) {
    if (!session.customerValidated || !session.customerNumber) {
      return {
        allowed: false,
        result: {
          error: "CUSTOMER_NOT_VALIDATED",
          message:
            "Validation is required before customer information lookup. Ask for credentials with emit_output (is_final=true) if needed.",
        },
      };
    }

    const missing = describeCustomerInfoArgsForGate(toolArgs);
    if (missing) {
      return {
        allowed: false,
        result: {
          error: "MISSING_LOOKUP_ARGS",
          message:
            `get_customer_information requires a valid lookup enum${missing === "invoice_id" ? " and invoice_id when lookup is invoice_by_id" : ""}. ` +
            "Do not use free-text queries.",
        },
      };
    }
  }

  return { allowed: true };
}

async function handleEmitOutput(
  options: RunAgentTurnOptions,
  speechState: TurnSpeechState,
  args: EmitOutputArgs,
): Promise<{ ok: true; is_final: boolean; spoken: boolean }> {
  const message = args.message.trim();
  if (!message) {
    return { ok: true, is_final: Boolean(args.is_final), spoken: false };
  }

  if (message === speechState.lastSpokenMessage) {
    return { ok: true, is_final: Boolean(args.is_final), spoken: false };
  }

  speechState.lastSpokenMessage = message;
  const spoken = scheduleSpeakText(
    options.res,
    message,
    options.signal,
    options.sequence,
    options.pendingSpeech,
    options.profiler,
  );

  addMessage(options.session, "assistant", message);
  addTimelineItem(options.session, {
    kind: "assistant",
    text: message,
  });

  if (args.visible_note?.trim()) {
    writeEvent(options.res, "agent_trace", {
      text: args.visible_note.trim(),
      phase: "output",
    });
    addTimelineItem(options.session, {
      kind: "agent_trace",
      text: args.visible_note.trim(),
    });
  }

  return { ok: true, is_final: Boolean(args.is_final), spoken };
}

function skippedToolResult(reason: string): string {
  return JSON.stringify({ skipped: true, reason });
}

export type AgentTurnResult = {
  finalText: string;
  completed: boolean;
};

export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnResult> {
  const { session, userText, signal, logger, profiler } = options;
  const pendingSpeech = options.pendingSpeech;
  const speechState: TurnSpeechState = {
    lastSpokenMessage: "",
    lastPreambleMessage: "",
    researchCalled: false,
  };
  const agentTools = await ensureAgentTools(session, signal);
  const discoveredToolNames = agentTools
    .filter((tool) => tool.type === "function" && tool.function.name !== EMIT_OUTPUT_TOOL)
    .map((tool) => (tool.type === "function" ? tool.function.name : ""));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${AGENT_SYSTEM_PROMPT}\n\n${buildSessionContextPrompt({
        customerValidated: session.customerValidated,
        customerNumber: session.customerNumber,
        toolBackendMode: session.toolBackendMode,
        discoveredToolNames,
      })}`,
    },
    ...buildHistoryMessages(session.history.slice(0, -1)),
    { role: "user", content: userText },
  ];

  let finalText = "";
  let completed = false;
  let exitReason = "started";
  let stepsUsed = 0;

  logger?.log("turn_start", {
    userText,
    customerValidated: session.customerValidated,
    customerNumber: session.customerNumber,
    toolBackendMode: session.toolBackendMode,
    maxSteps: config.AGENT_MAX_TOOL_CALLS,
    logFile: logger.logFilePath,
  });

  for (let step = 0; step < config.AGENT_MAX_TOOL_CALLS; step += 1) {
    stepsUsed = step + 1;
    if (signal.aborted) {
      exitReason = "aborted";
      break;
    }

    logger?.log("llm_request", { step, messageCount: messages.length });

    const llmSpanId = `llm-${step}`;
    profiler?.startSpan(llmSpanId, "agent_llm", "LLM API", `step ${step + 1}`);

    const completion = await openai.chat.completions.create(
      {
        model: config.OPENAI_AGENT_MODEL,
        temperature: 0.2,
        messages,
        tools: agentTools,
        tool_choice: "required",
      },
      { signal },
    );

    profiler?.endSpan(llmSpanId);

    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) {
      throw new AppError("Empty agent response", "AGENT_EMPTY", 502);
    }

    messages.push(assistantMessage);

    const rawToolCalls =
      assistantMessage.tool_calls?.filter((toolCall) => toolCall.type === "function") ?? [];

    logger?.log("llm_response", {
      step,
      toolCalls: rawToolCalls.map((tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    });

    if (!rawToolCalls.length) {
      exitReason = "no_tool_calls";
      break;
    }

    const emitCalls = rawToolCalls.filter((tc) => tc.function.name === EMIT_OUTPUT_TOOL);
    const backendCalls = rawToolCalls.filter((tc) => tc.function.name !== EMIT_OUTPUT_TOOL);
    const orderedCalls = [...emitCalls, ...backendCalls];

    let turnFinished = false;

    for (const toolCall of orderedCalls) {
      if (signal.aborted) {
        break;
      }

      const toolName = toolCall.function.name;
      const toolArgs = parseToolArguments(toolCall.function.arguments);
      const toolCallId = toolCall.id || uuidv4();

      if (turnFinished) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: skippedToolResult("Turn ended; waiting for caller input."),
        });
        continue;
      }

      if (toolName === EMIT_OUTPUT_TOOL) {
        logger?.log("emit_output_call", { toolCallId, arguments: toolArgs });

        writeEvent(options.res, "tool_call", {
          toolCallId,
          toolName,
          arguments: toolArgs,
        });

        const timelineId = addTimelineItem(options.session, {
          kind: "tool_call",
          text: `Output: ${String(toolArgs.message ?? "").slice(0, 80)}`,
          toolCallId,
          toolName,
          arguments: toolArgs,
          status: "running",
        });

        const output = await handleEmitOutput(
          options,
          speechState,
          toolArgs as EmitOutputArgs,
        );
        if (output.spoken) {
          finalText = String(toolArgs.message ?? finalText);
        }

        writeEvent(options.res, "tool_result", {
          toolCallId,
          toolName,
          result: { spoken: output.spoken, is_final: output.is_final },
          status: "success",
        });

        updateTimelineItem(options.session, timelineId, {
          status: "success",
          result: { spoken: output.spoken, is_final: output.is_final },
        });

        addTimelineItem(options.session, {
          kind: "tool_result",
          text: output.spoken ? "Spoken to caller" : "Duplicate output skipped",
          toolCallId,
          toolName,
          result: { spoken: output.spoken, is_final: output.is_final },
          status: "success",
        });

        logger?.log("emit_output_result", {
          toolCallId,
          spoken: output.spoken,
          is_final: output.is_final,
          message: String(toolArgs.message ?? "").slice(0, 200),
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ spoken: output.spoken, is_final: output.is_final }),
        });

        if (output.is_final) {
          turnFinished = true;
          completed = true;
          exitReason = "emit_final";
        }
        continue;
      }

      const gate = gateBackendTool(session, toolName, toolArgs);
      if (!gate.allowed) {
        logger?.log("backend_tool_blocked", { toolCallId, toolName, result: gate.result });

        writeEvent(options.res, "tool_call", {
          toolCallId,
          toolName,
          arguments: toolArgs,
        });

        const timelineToolId = addTimelineItem(options.session, {
          kind: "tool_call",
          text: `Tool blocked: ${toolName}`,
          toolCallId,
          toolName,
          arguments: toolArgs,
          status: "error",
        });

        writeEvent(options.res, "tool_result", {
          toolCallId,
          toolName,
          result: gate.result,
          status: "error",
        });

        updateTimelineItem(options.session, timelineToolId, {
          status: "error",
          result: gate.result,
        });

        addTimelineItem(options.session, {
          kind: "tool_result",
          text: summarizeToolResult(gate.result),
          toolCallId,
          toolName,
          result: gate.result,
          status: "error",
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(gate.result),
        });
        continue;
      }

      logger?.log("backend_tool_start", { toolCallId, toolName, arguments: toolArgs });

      writeEvent(options.res, "agent_trace", {
        text: `Calling ${toolName}`,
        phase: "tool_start",
      });
      writeEvent(options.res, "tool_call", {
        toolCallId,
        toolName,
        arguments: toolArgs,
      });

      const timelineToolId = addTimelineItem(options.session, {
        kind: "tool_call",
        text: `Tool: ${toolName}`,
        toolCallId,
        toolName,
        arguments: toolArgs,
        status: "running",
      });

      speechState.lastPreambleMessage = speakBackendToolPreamble(
        options,
        toolName,
        speechState.lastPreambleMessage,
      );

      const toolSpanId = `tool-${toolCallId}`;
      profiler?.startSpan(toolSpanId, "tool", toolName);

      const toolResult = await executeBackendTool(
        session,
        toolName,
        toolArgs,
        userText,
        signal,
      );

      profiler?.endSpan(toolSpanId);

      if (signal.aborted) {
        break;
      }

      if (isCustomerInfoTool(toolName)) {
        speechState.researchCalled = true;
      }

      logger?.log("backend_tool_result", {
        toolCallId,
        toolName,
        status: toolResult.status,
        result: toolResult.result,
      });

      writeEvent(options.res, "tool_result", {
        toolCallId,
        toolName,
        result: toolResult.result,
        status: toolResult.status,
      });

      updateTimelineItem(options.session, timelineToolId, {
        status: toolResult.status,
        result: toolResult.result,
      });

      addTimelineItem(options.session, {
        kind: "tool_result",
        text: summarizeToolResult(toolResult.result),
        toolCallId,
        toolName,
        result: toolResult.result,
        status: toolResult.status,
      });

      const toolContext = summarizeToolResult(toolResult.result);
      addMessage(session, "tool", toolContext, toolCallId, toolName);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult.result),
      });

      messages.push({
        role: "system",
        content: buildSessionContextPrompt({
          customerValidated: session.customerValidated,
          customerNumber: session.customerNumber,
          toolBackendMode: session.toolBackendMode,
          discoveredToolNames,
        }),
      });

      if (
        isValidateTool(toolName) &&
        toolResult.status === "success" &&
        (toolResult.result as { valid?: boolean }).valid
      ) {
        messages.push({
          role: "system",
          content:
            "Validation succeeded. Call get_customer_information only if the caller already asked for specific account data in this turn. " +
            "If they only greeted you or supplied credentials without a concrete request, thank them, confirm validation briefly, and ask what they need (emit_output, is_final=true). " +
            "When you do look up data, use the single smallest lookup that answers their question — never dump full account history unprompted.",
        });
        logger?.log("validation_nudge", { customerNumber: session.customerNumber });
      }
    }

    if (turnFinished || signal.aborted) {
      if (turnFinished) {
        exitReason = exitReason === "started" ? "turn_finished" : exitReason;
      }
      break;
    }
  }

  if (
    !signal.aborted &&
    !completed &&
    session.customerValidated &&
    !speechState.researchCalled &&
    looksLikeAccountQuery(userText)
  ) {
    exitReason = "research_fallback";
    logger?.log("research_fallback_start", { userText });

    const fallbackToolCallId = uuidv4();
    const fallbackArgs = { lookup: "latest_invoice" };
    speechState.lastPreambleMessage = speakBackendToolPreamble(
      options,
      GET_CUSTOMER_INFORMATION_TOOL,
      speechState.lastPreambleMessage,
    );
    profiler?.startSpan("tool-fallback", "tool", GET_CUSTOMER_INFORMATION_TOOL, "fallback");
    const toolResult = await executeBackendTool(
      session,
      GET_CUSTOMER_INFORMATION_TOOL,
      fallbackArgs,
      userText,
      signal,
    );
    profiler?.endSpan("tool-fallback");
    speechState.researchCalled = true;

    logger?.log("research_fallback_result", {
      toolCallId: fallbackToolCallId,
      status: toolResult.status,
      result: toolResult.result,
    });

    addMessage(session, "tool", summarizeToolResult(toolResult.result), fallbackToolCallId, GET_CUSTOMER_INFORMATION_TOOL);

    messages.push({
      role: "system",
      content:
        `get_customer_information was executed automatically because the turn ended early. Result: ${JSON.stringify(toolResult.result)}. ` +
        "Call emit_output once with the answer for the caller and is_final=true.",
    });

    if (!signal.aborted) {
      logger?.log("llm_request", { step: "fallback_emit", messageCount: messages.length });

      profiler?.startSpan("llm-fallback", "agent_llm", "LLM API", "fallback emit");

      const completion = await openai.chat.completions.create(
        {
          model: config.OPENAI_AGENT_MODEL,
          temperature: 0.2,
          messages,
          tools: agentTools,
          tool_choice: "required",
        },
        { signal },
      );

      profiler?.endSpan("llm-fallback");

      const assistantMessage = completion.choices[0]?.message;
      if (assistantMessage?.tool_calls?.length) {
        messages.push(assistantMessage);
        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.type !== "function" || toolCall.function.name !== EMIT_OUTPUT_TOOL) {
            continue;
          }
          const toolArgs = parseToolArguments(toolCall.function.arguments);
          const toolCallId = toolCall.id || uuidv4();
          const output = await handleEmitOutput(options, speechState, toolArgs as EmitOutputArgs);
          if (output.spoken) {
            finalText = String(toolArgs.message ?? finalText);
          }
          if (output.is_final) {
            completed = true;
          }
          logger?.log("emit_output_result", {
            toolCallId,
            spoken: output.spoken,
            is_final: output.is_final,
            message: String(toolArgs.message ?? "").slice(0, 200),
            fallback: true,
          });
        }
      }
    }
  }

  if (exitReason === "started" && stepsUsed >= config.AGENT_MAX_TOOL_CALLS) {
    exitReason = "max_steps_reached";
  }

  logger?.close({
    exitReason,
    stepsUsed,
    completed,
    researchCalled: speechState.researchCalled,
    finalText: finalText.slice(0, 200),
    customerValidated: session.customerValidated,
  });

  if (!signal.aborted) {
    await Promise.allSettled(pendingSpeech);
  }

  return { finalText, completed };
}
