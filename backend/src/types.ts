export type ChatRole = "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
};

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
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  live?: boolean;
};

export type ToolBackendMode = "local" | "mcp";

export type AgentPromptVariant = "default" | "latency_ux";

export type DiscoveredMcpToolSnapshot = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverUrl: string;
};

export type SessionState = {
  id: string;
  createdAt: string;
  updatedAt: string;
  turnCounter: number;
  history: ChatMessage[];
  timeline: TimelineItem[];
  currentAbortController?: AbortController;
  interrupted: boolean;
  greetingPlayed: boolean;
  customerValidated: boolean;
  customerNumber?: string;
  toolBackendMode: ToolBackendMode;
  agentPromptVariant: AgentPromptVariant;
  discoveredMcpTools?: DiscoveredMcpToolSnapshot[];
  mcpDiscoveredAt?: string;
};

export type PipelineStatus =
  | "transcribing"
  | "thinking"
  | "speaking"
  | "done"
  | "interrupted"
  | "error";

export type StatusEvent = {
  state: PipelineStatus;
};

export type UserTranscriptEvent = {
  text: string;
};

export type AssistantCaptionDeltaEvent = {
  delta: string;
};

export type AudioSegmentEvent = {
  sequence: number;
  mimeType: string;
  base64: string;
};

export type AssistantTextFinalEvent = {
  text: string;
};

export type AgentTraceEvent = {
  text: string;
  phase?: string;
};

export type ToolCallEvent = {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type ToolResultEvent = {
  toolCallId: string;
  toolName: string;
  result: unknown;
  status: "success" | "error";
};

export type ErrorEvent = {
  message: string;
};

export type CreateSessionResponse = {
  sessionId: string;
};

export type ResetSessionResponse = {
  sessionId: string;
};

export type InterruptSessionResponse = {
  ok: boolean;
};

export type ToolExecutionResult = {
  status: "success" | "error";
  result: unknown;
};

export type EmitOutputArgs = {
  message: string;
  visible_note?: string;
  is_final?: boolean;
};

export type SynthesizedAudio = {
  mimeType: string;
  base64: string;
};
