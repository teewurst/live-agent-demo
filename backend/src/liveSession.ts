import type { Request, Response } from "express";
import { buildSessionContextPrompt } from "./agentTools.js";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { formatOpenAiError } from "./openaiError.js";
import { getLiveAgentSystemPrompt, getLiveCallGreeting } from "./liveAgentPromptSelect.js";
import { buildRealtimeSessionConfig } from "./liveSessionConfig.js";
import { ensureLiveTools } from "./liveToolRegistry.js";
import { applyLiveAgentPromptFromRequest } from "./livePromptVariant.js";
import { applyToolBackendFromRequest } from "./toolBackend.js";
import {
  createSession,
  getSession,
  interruptSession,
  resetSession,
} from "./sessions.js";
import type { SessionState } from "./types.js";

function sessionIdFromParams(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export async function createLiveSessionHandler(req: Request, res: Response): Promise<void> {
  const session = createSession();
  applyToolBackendFromRequest(req, session);
  applyLiveAgentPromptFromRequest(req, session);

  const tools = await ensureLiveTools(session);
  const systemPrompt = `${getLiveAgentSystemPrompt(session.agentPromptVariant)}\n\n${buildSessionContextPrompt({
    customerValidated: session.customerValidated,
    customerNumber: session.customerNumber,
    toolBackendMode: session.toolBackendMode,
    agentPromptVariant: session.agentPromptVariant,
    discoveredToolNames: tools.map((tool) => tool.name),
  })}`;

  res.json({
    sessionId: session.id,
    systemPrompt,
    openingGreeting: getLiveCallGreeting(session.agentPromptVariant),
    liveAgentPromptVariant: session.agentPromptVariant,
    toolBackendMode: session.toolBackendMode,
    realtimeModel: config.OPENAI_REALTIME_MODEL,
    voice: config.OPENAI_REALTIME_VOICE,
  });
}

export async function connectLiveSessionHandler(req: Request, res: Response): Promise<void> {
  let session: SessionState;
  try {
    session = getSession(sessionIdFromParams(req.params.sessionId));
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Session not found";
    res.status(404).json({ error: message });
    return;
  }

  applyToolBackendFromRequest(req, session);
  applyLiveAgentPromptFromRequest(req, session);

  const sdpOffer =
    typeof req.body === "string"
      ? req.body
      : typeof req.body?.sdp === "string"
        ? req.body.sdp
        : "";

  if (!sdpOffer.trim()) {
    res.status(400).json({ error: "Missing SDP offer" });
    return;
  }

  const abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const sessionConfig = await buildRealtimeSessionConfig(session, signal);
    const formData = new FormData();
    formData.set("sdp", sdpOffer);
    formData.set("session", JSON.stringify(sessionConfig));

    const openaiResponse = await fetch(`${config.OPENAI_BASE_URL}/realtime/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: formData,
      signal,
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("[live/connect] OpenAI error:", openaiResponse.status, errorText);
      throw new AppError(
        formatOpenAiError("OpenAI Realtime connection failed", errorText || openaiResponse.statusText),
        "REALTIME_CONNECT_FAILED",
        openaiResponse.status,
      );
    }

    const sdpAnswer = await openaiResponse.text();
    const callId = openaiResponse.headers.get("Location") ?? undefined;

    res.setHeader("Content-Type", "application/sdp");
    if (callId) {
      res.setHeader("X-OpenAI-Call-Id", callId);
    }
    res.send(sdpAnswer);
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to connect Live session";
    console.error("[live/connect] unexpected error:", error);
    res.status(500).json({ error: message, code: "LIVE_CONNECT_ERROR" });
  }
}

export function getLivePromptHandler(req: Request, res: Response): void {
  try {
    const session = getSession(sessionIdFromParams(req.params.sessionId));
    const tools = session.discoveredMcpTools?.map((tool) => tool.name) ?? [
      "retrieve_information",
      "validate_customer",
      "get_customer_information",
    ];
    const systemPrompt = `${getLiveAgentSystemPrompt(session.agentPromptVariant)}\n\n${buildSessionContextPrompt({
      customerValidated: session.customerValidated,
      customerNumber: session.customerNumber,
      toolBackendMode: session.toolBackendMode,
      agentPromptVariant: session.agentPromptVariant,
      discoveredToolNames: tools,
    })}`;

    res.json({
      sessionId: session.id,
      systemPrompt,
      openingGreeting: getLiveCallGreeting(session.agentPromptVariant),
      liveAgentPromptVariant: session.agentPromptVariant,
      toolBackendMode: session.toolBackendMode,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Session not found";
    res.status(404).json({ error: message });
  }
}

export function resetLiveSessionHandler(req: Request, res: Response): void {
  try {
    const session = resetSession(sessionIdFromParams(req.params.sessionId));
    applyToolBackendFromRequest(req, session);
    applyLiveAgentPromptFromRequest(req, session);
    res.json({ sessionId: session.id });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Session not found";
    res.status(404).json({ error: message });
  }
}

export function interruptLiveSessionHandler(req: Request, res: Response): void {
  try {
    interruptSession(sessionIdFromParams(req.params.sessionId));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Session not found";
    res.status(404).json({ error: message });
  }
}
