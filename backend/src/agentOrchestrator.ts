import type { Response } from "express";
import { AppError, isAbortError, sendErrorEvent } from "./errors.js";
import { runAgentTurn } from "./openaiAgent.js";
import { AgentTurnLogger } from "./agentTurnLogger.js";
import { createSpeechSequence } from "./speechStreamer.js";
import {
  addMessage,
  addTimelineItem,
  clearAbortController,
  incrementTurn,
} from "./sessions.js";
import { closeSse, writeEvent } from "./sse.js";
import type { SessionState } from "./types.js";
import { TurnProfiler } from "./turnProfiler.js";

type ProcessTextTurnOptions = {
  session: SessionState;
  res: Response;
  userText: string;
  signal: AbortSignal;
  profiler?: TurnProfiler;
};

export async function processTextTurn({
  session,
  res,
  userText,
  signal,
  profiler: externalProfiler,
}: ProcessTextTurnOptions): Promise<void> {
  const transcript = userText.trim();
  if (!transcript) {
    throw new AppError("Empty text", "EMPTY_TEXT", 400);
  }

  const sequence = createSpeechSequence();
  const profiler = externalProfiler ?? new TurnProfiler();

  try {
    writeEvent(res, "user_transcript", { text: transcript });
    addMessage(session, "user", transcript);
    addTimelineItem(session, {
      kind: "user",
      text: transcript,
    });
    incrementTurn(session);

    writeEvent(res, "status", { state: "thinking" });

    const logger = new AgentTurnLogger(session.id, session.turnCounter);
    console.info(`[agent] turn log: ${logger.logFilePath}`);

    const pendingSpeech: Promise<void>[] = [];
    const { finalText, completed } = await runAgentTurn({
      session,
      res,
      userText: transcript,
      signal,
      sequence,
      logger,
      profiler,
      pendingSpeech,
    });

    if (signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      clearAbortController(session, signal);
      return;
    }

    if (finalText.trim()) {
      writeEvent(res, "assistant_text_final", { text: finalText });
    }

    const profile = profiler.finish(session.turnCounter);
    writeEvent(res, "turn_profile", profile);
    logger?.log("turn_profile", profile as unknown as Record<string, unknown>);

    writeEvent(res, "status", { state: completed ? "done" : "done" });
    closeSse(res);
    clearAbortController(session, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      clearAbortController(session, signal);
      return;
    }

    const message =
      error instanceof AppError ? error.message : "Unexpected error during turn processing";
    sendErrorEvent(res, message);
    addTimelineItem(session, {
      kind: "error",
      text: message,
    });
    closeSse(res);
    clearAbortController(session, signal);
  }
}
