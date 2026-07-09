import type { Response } from "express";
import { scheduleSpeakText, type SpeechSequence } from "./speechStreamer.js";
import { addTimelineItem } from "./sessions.js";
import type { SessionState } from "./types.js";
import { writeEvent } from "./sse.js";
import type { TurnProfiler } from "./turnProfiler.js";

/** One contextual hold line per lookup phase — says what Helen is doing, not just "one moment". */
const PREAMBLE_BY_TOOL: Record<string, string[]> = {
  retrieve_information: [
    "I'll check our documentation for that.",
    "Let me look that up in our help guides.",
  ],
  validate_customer: [
    "I'll verify your account first, then pull up what you need.",
    "Let me confirm your details first.",
  ],
  get_customer_information: [
    "I'll pull up your account records now.",
    "Let me load that from your account.",
  ],
};

const LOOKUP_PHASE_TOOLS = new Set(Object.keys(PREAMBLE_BY_TOOL));

export type LookupPreambleState = {
  lookupPreambleSpoken: boolean;
  lastPreambleMessage: string;
};

export function isLookupPhaseTool(toolName: string): boolean {
  return LOOKUP_PHASE_TOOLS.has(toolName);
}

export function pickLookupPhasePreamble(toolName: string, avoidMessage?: string): string {
  const pool = PREAMBLE_BY_TOOL[toolName] ?? ["One moment please."];
  const candidates = avoidMessage ? pool.filter((line) => line !== avoidMessage) : pool;
  const choices = candidates.length > 0 ? candidates : pool;
  return choices[Math.floor(Math.random() * choices.length)] ?? pool[0];
}

type PreambleOptions = {
  res: Response;
  session: SessionState;
  signal: AbortSignal;
  sequence: SpeechSequence;
  pendingSpeech: Promise<void>[];
  profiler?: TurnProfiler;
};

/**
 * Speaks at most one hold line per agent turn, before the first lookup-phase tool.
 * Phrase matches the first tool (docs vs verify vs account load).
 */
export function speakLookupPreambleOnce(
  options: PreambleOptions,
  toolName: string,
  state: LookupPreambleState,
): boolean {
  if (state.lookupPreambleSpoken || !isLookupPhaseTool(toolName)) {
    return false;
  }

  const message = pickLookupPhasePreamble(toolName, state.lastPreambleMessage || undefined);
  scheduleSpeakText(
    options.res,
    message,
    options.signal,
    options.sequence,
    options.pendingSpeech,
    options.profiler,
  );

  writeEvent(options.res, "agent_trace", {
    text: message,
    phase: "tool_preamble",
    toolName,
  });

  addTimelineItem(options.session, {
    kind: "agent_trace",
    text: message,
  });

  state.lookupPreambleSpoken = true;
  state.lastPreambleMessage = message;
  return true;
}
