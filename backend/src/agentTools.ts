import type OpenAI from "openai";

export const EMIT_OUTPUT_TOOL = "emit_output";

export const EMIT_OUTPUT_TOOL_DEFINITION: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: EMIT_OUTPUT_TOOL,
    description:
      "Speak to the caller. You must use this for every spoken message — never use plain assistant text. " +
      "Set is_final=true when the caller should speak next or the turn is complete. " +
      "Never end with a hollow affirmation (e.g. 'Yes I can help') — include facts, steps, or an honest limit.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Short natural sentence for voice output.",
        },
        visible_note: {
          type: "string",
          description: "Optional short UI note for the background panel.",
        },
        is_final: {
          type: "boolean",
          description: "True when this is the final spoken message for the turn.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export function buildSessionContextPrompt(session: {
  customerValidated: boolean;
  customerNumber?: string;
  toolBackendMode: "local" | "mcp";
  agentPromptVariant?: "default" | "latency_ux";
  discoveredToolNames?: string[];
}): string {
  const toolList =
    session.discoveredToolNames?.length
      ? session.discoveredToolNames.join(", ")
      : "retrieve_information, validate_customer, get_customer_information (local demo)";

  return [
    "Session security state:",
    `- customerValidated: ${session.customerValidated}`,
    `- customerNumber: ${session.customerNumber ?? "none"}`,
    `- toolBackend: ${session.toolBackendMode}`,
    `- agentPrompt: ${session.agentPromptVariant ?? "default"}`,
    session.customerValidated
      ? "Account lookup tools are allowed for this session."
      : "Account lookup tools are blocked until validate_customer succeeds.",
    `Available backend tools (from ${session.toolBackendMode === "mcp" ? "MCP discovery" : "local catalog"}): ${toolList}`,
    "Use lookup enum values only for research tools — never free-text query strings.",
  ].join("\n");
}
