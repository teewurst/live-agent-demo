const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001";

export type SseEventName =
  | "session"
  | "status"
  | "user_transcript"
  | "assistant_caption_delta"
  | "audio_segment"
  | "assistant_text_final"
  | "agent_trace"
  | "tool_call"
  | "tool_result"
  | "error";

export type SseHandler = (event: SseEventName, data: Record<string, unknown>) => void;

export type ToolBackendMode = "local" | "mcp";

export const TOOL_BACKEND_HEADER = "X-Tool-Backend";

function toolBackendHeaders(toolBackend?: ToolBackendMode): HeadersInit {
  if (!toolBackend) {
    return {};
  }
  return { [TOOL_BACKEND_HEADER]: toolBackend };
}

export async function createSession(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/sessions/instant`, { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to create session");
  }
  const payload = (await response.json()) as { sessionId: string };
  return payload.sessionId;
}

async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = block.split("\n");
      let eventName: SseEventName | null = null;
      let dataLine = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() as SseEventName;
        } else if (line.startsWith("data:")) {
          dataLine += line.slice(5).trim();
        }
      }

      if (eventName && dataLine) {
        try {
          onEvent(eventName, JSON.parse(dataLine) as Record<string, unknown>);
        } catch {
          onEvent(eventName, { raw: dataLine });
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}

export async function openCall(
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to open call");
  }

  let sessionId = "";
  await parseSseStream(
    response.body,
    (event, data) => {
      if (event === "session") {
        sessionId = String(data.sessionId ?? "");
      }
      onEvent(event, data);
    },
    signal,
  );

  if (!sessionId) {
    throw new Error("Call opened without session id");
  }

  return sessionId;
}

export async function reopenCall(
  sessionId: string,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/reset`, {
    method: "POST",
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to reopen call");
  }

  let nextSessionId = "";
  await parseSseStream(
    response.body,
    (event, data) => {
      if (event === "session") {
        nextSessionId = String(data.sessionId ?? "");
      }
      onEvent(event, data);
    },
    signal,
  );

  if (!nextSessionId) {
    throw new Error("Call reopened without session id");
  }

  return nextSessionId;
}

export async function interruptSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/interrupt`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to interrupt session");
  }
}

export async function sendUtterance(
  sessionId: string,
  audioBlob: Blob,
  onEvent: SseHandler,
  signal?: AbortSignal,
  clientTurnId?: string,
  toolBackend?: ToolBackendMode,
): Promise<void> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "utterance.webm");
  if (clientTurnId) {
    formData.append("clientTurnId", clientTurnId);
  }

  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/utterance`, {
    method: "POST",
    body: formData,
    signal,
    headers: toolBackendHeaders(toolBackend),
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to send utterance");
  }

  await parseSseStream(response.body, onEvent, signal);
}

export async function sendDebugMessage(
  sessionId: string,
  text: string,
  onEvent: SseHandler,
  signal?: AbortSignal,
  clientTurnId?: string,
  toolBackend?: ToolBackendMode,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/debug-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...toolBackendHeaders(toolBackend),
    },
    body: JSON.stringify({ text, clientTurnId }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to send debug message");
  }

  await parseSseStream(response.body, onEvent, signal);
}
