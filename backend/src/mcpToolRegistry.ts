import type OpenAI from "openai";
import { EMIT_OUTPUT_TOOL_DEFINITION } from "./agentTools.js";
import { config } from "./config.js";
import {
  closeMcpConnections,
  discoverMcpTools,
  type DiscoveredMcpTool,
} from "./mcpConnectionManager.js";
import { LOCAL_BACKEND_TOOLS } from "./localToolCatalog.js";
import type { SessionState, ToolBackendMode } from "./types.js";

export const RETRIEVE_INFORMATION_TOOL = "retrieve_information";
export const VALIDATE_CUSTOMER_TOOL = "validate_customer";
export const GET_CUSTOMER_INFORMATION_TOOL = "get_customer_information";

/** @deprecated */
export const RESEARCH_CUSTOMER_TOOL = GET_CUSTOMER_INFORMATION_TOOL;

function mcpToolToOpenAi(tool: DiscoveredMcpTool): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? `MCP tool ${tool.name}`,
      parameters: {
        ...tool.inputSchema,
        additionalProperties: false,
      },
    },
  };
}

export function isPublicInfoTool(toolName: string): boolean {
  return toolName === RETRIEVE_INFORMATION_TOOL || toolName.startsWith("retrieve_");
}

export function isCustomerInfoTool(toolName: string): boolean {
  return (
    toolName === GET_CUSTOMER_INFORMATION_TOOL ||
    toolName === "research_customer" ||
    toolName.startsWith("get_customer_")
  );
}

/** @deprecated use isCustomerInfoTool */
export function isResearchTool(toolName: string): boolean {
  return isCustomerInfoTool(toolName);
}

export function isValidateTool(toolName: string): boolean {
  return toolName === VALIDATE_CUSTOMER_TOOL || toolName.startsWith("validate_");
}

export async function ensureAgentTools(
  session: SessionState,
  signal?: AbortSignal,
): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  if (session.toolBackendMode === "local") {
    return [EMIT_OUTPUT_TOOL_DEFINITION, ...LOCAL_BACKEND_TOOLS];
  }

  if (session.discoveredMcpTools?.length) {
    return [
      EMIT_OUTPUT_TOOL_DEFINITION,
      ...session.discoveredMcpTools.map(mcpToolToOpenAi),
    ];
  }

  const discovered = await discoverMcpTools(session.id, config.MCP_SERVER_URLS, signal);
  session.discoveredMcpTools = discovered;
  session.mcpDiscoveredAt = new Date().toISOString();

  return [EMIT_OUTPUT_TOOL_DEFINITION, ...discovered.map(mcpToolToOpenAi)];
}

export function findDiscoveredTool(
  session: SessionState,
  toolName: string,
): DiscoveredMcpTool | undefined {
  return session.discoveredMcpTools?.find((tool) => tool.name === toolName);
}

export async function refreshMcpTools(
  session: SessionState,
  mode: ToolBackendMode,
  signal?: AbortSignal,
): Promise<void> {
  if (mode === "local") {
    session.discoveredMcpTools = undefined;
    session.mcpDiscoveredAt = undefined;
    return;
  }

  const discovered = await discoverMcpTools(session.id, config.MCP_SERVER_URLS, signal);
  session.discoveredMcpTools = discovered;
  session.mcpDiscoveredAt = new Date().toISOString();
}

export async function teardownMcpSession(voiceSessionId: string): Promise<void> {
  await closeMcpConnections(voiceSessionId);
}
