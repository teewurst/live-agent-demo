import type { Response } from "express";
import { scheduleSpeakText, type SpeechSequence } from "./speechStreamer.js";
import { addTimelineItem } from "./sessions.js";
import type { SessionState } from "./types.js";
import { writeEvent } from "./sse.js";
import type { TurnProfiler } from "./turnProfiler.js";

const GENERIC_PREAMBLES = [
  "One moment, let me check that for you.",
  "Give me just a second while I look that up.",
  "Hold on, I'll pull that up in our system.",
  "Let me take a quick look on my side.",
  "Just a moment while I verify that.",
  "I'll check that right away.",
  "Bear with me for a second.",
  "Let me see what we have on file.",
];

const PREAMBLES_BY_TOOL: Record<string, string[]> = {
  validate_customer: [
    "One moment, I'll verify your account details.",
    "Let me quickly confirm your customer information.",
    "Give me a second to validate your credentials.",
    "I'll check your account in our system now.",
    "Hold on while I confirm your customer number.",
  ],
  get_customer_information: [
    "One moment, let me look up your account information.",
    "I'll pull up your records right now.",
    "Give me a second to find that in our system.",
    "Let me check your account details.",
    "Hold on, I'm retrieving that information now.",
  ],
  retrieve_information: [
    "Let me check our knowledge base for that.",
    "One moment, I'll look that up for you.",
    "Give me a second to find the right information.",
    "I'll search our documentation quickly.",
  ],
};

export function pickToolPreamble(toolName: string, avoidMessage?: string): string {
  const pool = PREAMBLES_BY_TOOL[toolName] ?? GENERIC_PREAMBLES;
  const candidates = avoidMessage ? pool.filter((line) => line !== avoidMessage) : pool;
  const choices = candidates.length > 0 ? candidates : pool;
  const index = Math.floor(Math.random() * choices.length);
  return choices[index] ?? pool[0];
}

type PreambleOptions = {
  res: Response;
  session: SessionState;
  signal: AbortSignal;
  sequence: SpeechSequence;
  pendingSpeech: Promise<void>[];
  profiler?: TurnProfiler;
};

export function speakBackendToolPreamble(
  options: PreambleOptions,
  toolName: string,
  lastPreambleMessage: string,
): string {
  const message = pickToolPreamble(toolName, lastPreambleMessage || undefined);
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

  return message;
}
