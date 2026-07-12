import {
  ESTIMATED_QUEUE_WAIT_MINUTES,
  LIVE_CALL_GREETING,
  LIVE_AGENT_SYSTEM_PROMPT,
} from "./liveAgentPrompt.js";
import { LIVE_AGENT_SYSTEM_PROMPT_LATENCY_UX } from "./liveAgentPrompt.latencyUx.js";
import type { AgentPromptVariant } from "./types.js";

export function getLiveAgentSystemPrompt(variant: AgentPromptVariant): string {
  if (variant === "latency_ux") {
    return LIVE_AGENT_SYSTEM_PROMPT_LATENCY_UX;
  }
  return LIVE_AGENT_SYSTEM_PROMPT;
}

export function getLiveCallGreeting(_variant: AgentPromptVariant): string {
  return LIVE_CALL_GREETING;
}

export { ESTIMATED_QUEUE_WAIT_MINUTES, LIVE_CALL_GREETING };
