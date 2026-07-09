import type { Request } from "express";
import { config } from "./config.js";
import type { AgentPromptVariant, SessionState } from "./types.js";
import { setAgentPromptVariant } from "./sessions.js";

const HEADER_NAME = "x-live-agent-prompt-variant";

export function parseLiveAgentPromptVariant(value: string | undefined): AgentPromptVariant | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "default" || normalized === "latency_ux") {
    return normalized;
  }
  return null;
}

export function applyLiveAgentPromptFromRequest(
  req: Request,
  session: SessionState,
): AgentPromptVariant {
  const fromHeader = parseLiveAgentPromptVariant(req.header(HEADER_NAME));
  if (fromHeader) {
    setAgentPromptVariant(session, fromHeader);
    return fromHeader;
  }

  const bodyVariant =
    req.body && typeof req.body === "object"
      ? parseLiveAgentPromptVariant(
          String((req.body as { liveAgentPromptVariant?: string }).liveAgentPromptVariant ?? ""),
        )
      : null;
  if (bodyVariant) {
    setAgentPromptVariant(session, bodyVariant);
    return bodyVariant;
  }

  return session.agentPromptVariant;
}

export const LIVE_AGENT_PROMPT_VARIANT_HEADER = "X-Live-Agent-Prompt-Variant";

export function defaultLiveAgentPromptVariant(): AgentPromptVariant {
  return config.LIVE_AGENT_PROMPT_VARIANT;
}
