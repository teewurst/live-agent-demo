import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { AppError } from "./errors.js";
import { gateBackendTool } from "./toolGating.js";
import { addTimelineItem, getSession, updateTimelineItem } from "./sessions.js";
import { executeBackendTool } from "./toolExecutor.js";
import { applyToolBackendFromRequest } from "./toolBackend.js";
import { summarizeToolResult } from "./toolResultUtils.js";

function sessionIdFromParams(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export async function executeLiveToolHandler(req: Request, res: Response): Promise<void> {
  let session;
  try {
    session = getSession(sessionIdFromParams(req.params.sessionId));
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Session not found";
    res.status(404).json({ error: message });
    return;
  }

  applyToolBackendFromRequest(req, session);

  const toolName = typeof req.body?.toolName === "string" ? req.body.toolName.trim() : "";
  const callId =
    typeof req.body?.callId === "string"
      ? req.body.callId.trim()
      : typeof req.params.callId === "string"
        ? req.params.callId
        : "";

  if (!toolName) {
    res.status(400).json({ error: "Missing toolName" });
    return;
  }

  const toolArgs = parseToolArguments(req.body?.arguments);
  const toolCallId = callId || uuidv4();

  const timelineId = addTimelineItem(session, {
    kind: "tool_call",
    text: `Tool call: ${toolName}`,
    toolCallId,
    toolName,
    arguments: toolArgs,
    status: "running",
  });

  const gate = gateBackendTool(session, toolName, toolArgs);
  if (!gate.allowed) {
    updateTimelineItem(session, timelineId, {
      status: "error",
      result: gate.result,
    });
    res.json({
      callId: toolCallId,
      toolName,
      status: "error" as const,
      output: JSON.stringify(gate.result),
      result: gate.result,
    });
    return;
  }

  try {
    const execution = await executeBackendTool(session, toolName, toolArgs, "");
    const status = execution.status;
    const summary = summarizeToolResult(execution.result);

    updateTimelineItem(session, timelineId, {
      status,
      result: execution.result,
      text: `Tool result: ${toolName} — ${summary}`,
    });

    addTimelineItem(session, {
      kind: "tool_result",
      text: `Tool result: ${toolName} — ${summary}`,
      toolCallId,
      toolName,
      result: execution.result,
      status,
    });

    res.json({
      callId: toolCallId,
      toolName,
      status,
      output: JSON.stringify(execution.result),
      result: execution.result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    const errorResult = { error: "TOOL_EXECUTION_FAILED", message };
    updateTimelineItem(session, timelineId, {
      status: "error",
      result: errorResult,
    });
    addTimelineItem(session, {
      kind: "tool_result",
      text: `Tool result: ${toolName} — error`,
      toolCallId,
      toolName,
      result: errorResult,
      status: "error",
    });
    res.status(500).json({
      callId: toolCallId,
      toolName,
      status: "error" as const,
      output: JSON.stringify(errorResult),
      result: errorResult,
    });
  }
}
