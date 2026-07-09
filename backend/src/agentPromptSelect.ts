import { AGENT_SYSTEM_PROMPT } from "./agentPrompt.js";
import { AGENT_SYSTEM_PROMPT_LATENCY_UX } from "./agentPrompt.latencyUx.js";
import type { AgentPromptVariant } from "./types.js";

export function getAgentSystemPrompt(variant: AgentPromptVariant): string {
  if (variant === "latency_ux") {
    return AGENT_SYSTEM_PROMPT_LATENCY_UX;
  }
  return AGENT_SYSTEM_PROMPT;
}
