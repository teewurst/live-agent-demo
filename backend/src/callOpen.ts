import type { Response } from "express";
import { CALL_GREETING } from "./agentPrompt.js";
import { isAbortError } from "./errors.js";
import { createSpeechSequence, speakText } from "./speechStreamer.js";
import { addMessage, addTimelineItem } from "./sessions.js";
import { closeSse, writeEvent } from "./sse.js";
import type { SessionState } from "./types.js";

type OpenCallLineOptions = {
  session: SessionState;
  res: Response;
  signal: AbortSignal;
};

export async function openCallLine({
  session,
  res,
  signal,
}: OpenCallLineOptions): Promise<void> {
  writeEvent(res, "session", { sessionId: session.id });

  if (session.greetingPlayed) {
    writeEvent(res, "status", { state: "done" });
    closeSse(res);
    return;
  }

  try {
    writeEvent(res, "status", { state: "speaking" });

    const sequence = createSpeechSequence();
    const spoken = await speakText(res, CALL_GREETING, signal, sequence);

    if (signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      return;
    }

    if (spoken) {
      session.greetingPlayed = true;
      addMessage(session, "assistant", spoken);
      addTimelineItem(session, {
        kind: "assistant",
        text: spoken,
      });
      writeEvent(res, "assistant_text_final", { text: spoken });
    }

    writeEvent(res, "status", { state: "done" });
    closeSse(res);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      writeEvent(res, "status", { state: "interrupted" });
      closeSse(res);
      return;
    }
    throw error;
  }
}
