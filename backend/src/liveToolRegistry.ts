import type OpenAI from "openai";
import { ensureAgentTools } from "./mcpToolRegistry.js";
import type { SessionState } from "./types.js";

export type RealtimeFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

function chatToolToRealtime(tool: OpenAI.Chat.ChatCompletionTool): RealtimeFunctionTool | null {
  if (tool.type !== "function") {
    return null;
  }
  const fn = tool.function;
  if (fn.name === "emit_output") {
    return null;
  }
  return {
    type: "function",
    name: fn.name,
    description: fn.description ?? `Tool ${fn.name}`,
    parameters: {
      ...(fn.parameters as Record<string, unknown>),
      additionalProperties: false,
    },
  };
}

export async function ensureLiveTools(
  session: SessionState,
  signal?: AbortSignal,
): Promise<RealtimeFunctionTool[]> {
  const chatTools = await ensureAgentTools(session, signal);
  return chatTools
    .map(chatToolToRealtime)
    .filter((tool): tool is RealtimeFunctionTool => tool !== null);
}
