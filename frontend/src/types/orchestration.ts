export type TimelineItemKind =
  | "user"
  | "assistant"
  | "agent_trace"
  | "tool_call"
  | "tool_result"
  | "error";

export type TimelineItem = {
  id: string;
  kind: TimelineItemKind;
  text: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  live?: boolean;
};

export type ExecutionPhase =
  | "idle"
  | "transcribing"
  | "thinking"
  | "waiting_tool"
  | "waiting_mcp"
  | "speaking"
  | "done"
  | "interrupted"
  | "error";

export type McpToolId =
  | "retrieve_information"
  | "validate_customer"
  | "get_customer_information";

export type ToolNodeState = "idle" | "active" | "success" | "error" | "locked";

export type ExecutionState = {
  phase: ExecutionPhase;
  waitingLabel: string;
  showWaiting: boolean;
  callerActive: boolean;
  middlewareActive: boolean;
  agentActive: boolean;
  emitOutputActive: boolean;
  mcpHostActive: boolean;
  activeMcpTool: McpToolId | null;
  toolStates: Record<McpToolId, ToolNodeState>;
  customerValidated: boolean;
  paused: boolean;
  focusToolCallId: string | null;
};

export function createIdleExecution(): ExecutionState {
  return {
    phase: "idle",
    waitingLabel: "",
    showWaiting: false,
    callerActive: false,
    middlewareActive: false,
    agentActive: false,
    emitOutputActive: false,
    mcpHostActive: false,
    activeMcpTool: null,
    toolStates: {
      retrieve_information: "idle",
      validate_customer: "idle",
      get_customer_information: "locked",
    },
    customerValidated: false,
    paused: false,
    focusToolCallId: null,
  };
}
