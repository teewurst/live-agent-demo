import { buildSessionContextPrompt } from "./agentTools.js";
import { config } from "./config.js";
import { getLiveAgentSystemPrompt } from "./liveAgentPromptSelect.js";
import { ensureLiveTools } from "./liveToolRegistry.js";
import { createSession } from "./sessions.js";
import type { SessionState } from "./types.js";

export async function buildRealtimeSessionConfig(
  session: SessionState,
  signal?: AbortSignal,
) {
  const tools = await ensureLiveTools(session, signal);
  const discoveredToolNames = tools.map((tool) => tool.name);
  const instructions = `${getLiveAgentSystemPrompt(session.agentPromptVariant)}\n\n${buildSessionContextPrompt({
    customerValidated: session.customerValidated,
    customerNumber: session.customerNumber,
    toolBackendMode: session.toolBackendMode,
    agentPromptVariant: session.agentPromptVariant,
    discoveredToolNames,
  })}`;

  return {
    type: "realtime" as const,
    model: config.OPENAI_REALTIME_MODEL,
    instructions,
    tools,
    tool_choice: "auto" as const,
    output_modalities: ["audio"] as const,
    audio: {
      input: {
        transcription: {
          model: config.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
        },
        turn_detection: {
          type: "server_vad" as const,
          interrupt_response: true,
          create_response: true,
        },
      },
      output: {
        voice: config.OPENAI_REALTIME_VOICE,
      },
    },
  };
}

/** Used by debug-live-connect.mjs after `npm run build`. */
export async function buildRealtimeSessionConfigForDebug() {
  const session = createSession();
  return buildRealtimeSessionConfig(session);
}
