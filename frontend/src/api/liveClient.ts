const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

export type ToolBackendMode = "local" | "mcp";
export type LiveAgentPromptVariant = "default" | "latency_ux";

export const TOOL_BACKEND_HEADER = "X-Tool-Backend";
export const LIVE_AGENT_PROMPT_VARIANT_HEADER = "X-Live-Agent-Prompt-Variant";

export const LIVE_AGENT_PROMPT_LABELS: Record<LiveAgentPromptVariant, string> = {
  default: "Prompt A (classic)",
  latency_ux: "Prompt B (operator UX)",
};

function requestOptionHeaders(
  toolBackend?: ToolBackendMode,
  liveAgentPromptVariant?: LiveAgentPromptVariant,
): HeadersInit {
  const headers: Record<string, string> = {};
  if (toolBackend) {
    headers[TOOL_BACKEND_HEADER] = toolBackend;
  }
  if (liveAgentPromptVariant) {
    headers[LIVE_AGENT_PROMPT_VARIANT_HEADER] = liveAgentPromptVariant;
  }
  return headers;
}

export type LiveSessionInfo = {
  sessionId: string;
  systemPrompt: string;
  openingGreeting: string;
  liveAgentPromptVariant: LiveAgentPromptVariant;
  toolBackendMode: ToolBackendMode;
  realtimeModel: string;
  voice: string;
};

export type LiveToolExecutionResult = {
  callId: string;
  toolName: string;
  status: "success" | "error";
  output: string;
  result: unknown;
};

export async function createLiveSession(
  toolBackend: ToolBackendMode,
  liveAgentPromptVariant: LiveAgentPromptVariant,
): Promise<LiveSessionInfo> {
  const response = await fetch(`${API_BASE}/api/live/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestOptionHeaders(toolBackend, liveAgentPromptVariant),
    },
    body: JSON.stringify({ toolBackend, liveAgentPromptVariant }),
  });

  if (!response.ok) {
    throw new Error("Failed to create Live session");
  }

  return (await response.json()) as LiveSessionInfo;
}

export async function connectLiveSession(
  sessionId: string,
  sdpOffer: string,
  toolBackend: ToolBackendMode,
  liveAgentPromptVariant: LiveAgentPromptVariant,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/live/sessions/${sessionId}/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      ...requestOptionHeaders(toolBackend, liveAgentPromptVariant),
    },
    body: sdpOffer,
    signal,
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let message = `Failed to connect Live session (HTTP ${response.status})`;
    try {
      const payload = JSON.parse(rawBody) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error;
      } else if (rawBody.trim()) {
        message = `${message}: ${rawBody.trim().slice(0, 400)}`;
      }
    } catch {
      if (rawBody.trim()) {
        message = `${message}: ${rawBody.trim().slice(0, 400)}`;
      }
    }
    throw new Error(message);
  }

  return response.text();
}

export async function resetLiveSession(
  sessionId: string,
  toolBackend: ToolBackendMode,
  liveAgentPromptVariant: LiveAgentPromptVariant,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/live/sessions/${sessionId}/reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestOptionHeaders(toolBackend, liveAgentPromptVariant),
    },
    body: JSON.stringify({ toolBackend, liveAgentPromptVariant }),
  });

  if (!response.ok) {
    throw new Error("Failed to reset Live session");
  }

  const payload = (await response.json()) as { sessionId: string };
  return payload.sessionId;
}

export async function interruptLiveSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/live/sessions/${sessionId}/interrupt`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to interrupt Live session");
  }
}

export async function executeLiveTool(
  sessionId: string,
  toolName: string,
  callId: string,
  args: Record<string, unknown>,
  toolBackend: ToolBackendMode,
): Promise<LiveToolExecutionResult> {
  const response = await fetch(`${API_BASE}/api/live/sessions/${sessionId}/tools/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestOptionHeaders(toolBackend),
    },
    body: JSON.stringify({
      toolName,
      callId,
      arguments: args,
    }),
  });

  const payload = (await response.json()) as LiveToolExecutionResult & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Live tool execution failed");
  }

  return payload;
}

export async function fetchLivePrompt(sessionId: string): Promise<LiveSessionInfo> {
  const response = await fetch(`${API_BASE}/api/live/sessions/${sessionId}/prompt`);
  if (!response.ok) {
    throw new Error("Failed to fetch Live prompt");
  }
  return (await response.json()) as LiveSessionInfo;
}
