import { LIVE_AGENT_SYSTEM_PROMPT } from "./liveAgentPrompt.js";
import { LIVE_AGENT_SYSTEM_PROMPT_LATENCY_UX } from "./liveAgentPrompt.latencyUx.js";
import type { AgentPromptVariant } from "./types.js";

export function getLiveAgentSystemPrompt(variant: AgentPromptVariant): string {
  if (variant === "latency_ux") {
    return LIVE_AGENT_SYSTEM_PROMPT_LATENCY_UX;
  }
  return LIVE_AGENT_SYSTEM_PROMPT;
}

export function getLiveCallGreeting(variant: AgentPromptVariant): string {
  if (variant === "latency_ux") {
    return `Hi, this is Helen from Nexus ERP support. How can I help you today?`;
  }
  return `Hi, this is Helen from Nexus ERP support. How can I help you today?`;
}
