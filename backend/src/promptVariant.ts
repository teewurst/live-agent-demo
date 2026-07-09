import type { Request } from "express";
import { config } from "./config.js";
import type { AgentPromptVariant, SessionState } from "./types.js";
import { setAgentPromptVariant } from "./sessions.js";

const HEADER_NAME = "x-agent-prompt-variant";

export function parseAgentPromptVariant(value: string | undefined): AgentPromptVariant | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "default" || normalized === "latency_ux") {
    return normalized;
  }
  return null;
}

export function applyAgentPromptFromRequest(req: Request, session: SessionState): AgentPromptVariant {
  const fromHeader = parseAgentPromptVariant(req.header(HEADER_NAME));
  if (fromHeader) {
    setAgentPromptVariant(session, fromHeader);
    return fromHeader;
  }

  const bodyVariant =
    req.body && typeof req.body === "object"
      ? parseAgentPromptVariant(
          String((req.body as { agentPromptVariant?: string }).agentPromptVariant ?? ""),
        )
      : null;
  if (bodyVariant) {
    setAgentPromptVariant(session, bodyVariant);
    return bodyVariant;
  }

  return session.agentPromptVariant;
}

export const AGENT_PROMPT_VARIANT_HEADER = "X-Agent-Prompt-Variant";

export function defaultAgentPromptVariant(): AgentPromptVariant {
  return config.AGENT_PROMPT_VARIANT;
}
