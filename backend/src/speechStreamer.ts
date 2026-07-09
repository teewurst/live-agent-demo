import type { Response } from "express";
import { config } from "./config.js";
import { isAbortError } from "./errors.js";
import { synthesizeSpeech } from "./openaiAudio.js";
import { PhraseSegmenter } from "./phraseSegmenter.js";
import { writeEvent } from "./sse.js";
import type { TurnProfiler } from "./turnProfiler.js";

export type SpeechSequence = {
  next: () => number;
};

export function createSpeechSequence(start = 0): SpeechSequence {
  let current = start;
  return {
    next: () => {
      current += 1;
      return current;
    },
  };
}

async function speakPhrase(
  res: Response,
  phrase: string,
  sequence: number,
  signal: AbortSignal,
  profiler?: TurnProfiler,
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }

  writeEvent(res, "status", { state: "speaking" });

  const spanId = `tts-${sequence}`;
  profiler?.startSpan(spanId, "tts", "TTS API", phrase.slice(0, 48));

  try {
    const audio = await synthesizeSpeech(phrase, signal);
    profiler?.endSpan(spanId);
    if (signal.aborted) {
      return false;
    }
    profiler?.markFirstAudio();
    writeEvent(res, "audio_segment", {
      sequence,
      mimeType: audio.mimeType,
      base64: audio.base64,
    });
    return true;
  } catch (error) {
    profiler?.endSpan(spanId);
    if (isAbortError(error) || signal.aborted) {
      return false;
    }
    writeEvent(res, "error", {
      message: "Speech synthesis failed for one segment. Captions remain visible.",
    });
    return true;
  }
}

async function speakPhrases(
  res: Response,
  phrases: string[],
  signal: AbortSignal,
  sequence: SpeechSequence,
  profiler?: TurnProfiler,
): Promise<void> {
  for (const phrase of phrases) {
    if (signal.aborted) {
      break;
    }
    const seq = sequence.next();
    const shouldContinue = await speakPhrase(res, phrase, seq, signal, profiler);
    if (!shouldContinue) {
      break;
    }
  }
}

export async function speakText(
  res: Response,
  text: string,
  signal: AbortSignal,
  sequence: SpeechSequence,
  onDelta?: (delta: string) => void,
  profiler?: TurnProfiler,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  onDelta?.(trimmed);
  emitCaption(res, trimmed, profiler);

  const phrases =
    trimmed.length <= config.TTS_WHOLE_MESSAGE_MAX_CHARS
      ? [trimmed]
      : collectPhrases(trimmed);

  await speakPhrases(res, phrases, signal, sequence, profiler);
  return trimmed;
}

/** Starts TTS without blocking the caller; captions are sent immediately. */
export function scheduleSpeakText(
  res: Response,
  text: string,
  signal: AbortSignal,
  sequence: SpeechSequence,
  pendingSpeech: Promise<void>[],
  profiler?: TurnProfiler,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  emitCaption(res, trimmed, profiler);
  writeEvent(res, "status", { state: "speaking" });

  const phrases =
    trimmed.length <= config.TTS_WHOLE_MESSAGE_MAX_CHARS
      ? [trimmed]
      : collectPhrases(trimmed);

  const task = speakPhrases(res, phrases, signal, sequence, profiler).catch((error) => {
    if (!isAbortError(error) && !signal.aborted) {
      writeEvent(res, "error", {
        message: "Speech synthesis failed for one segment. Captions remain visible.",
      });
    }
  });

  pendingSpeech.push(task);
  return true;
}

function emitCaption(
  res: Response,
  text: string,
  profiler?: TurnProfiler,
): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  profiler?.markFirstCaption(trimmed);
  writeEvent(res, "assistant_caption_delta", { delta: trimmed });
}

function collectPhrases(text: string): string[] {
  const segmenter = new PhraseSegmenter();
  const phrases = segmenter.feed(text);
  const remaining = segmenter.flushRemaining(true);
  return remaining ? [...phrases, remaining] : phrases;
}

export async function speakTextStream(
  res: Response,
  textStream: AsyncGenerator<string>,
  signal: AbortSignal,
  sequence: SpeechSequence,
  onDelta?: (delta: string) => void,
  profiler?: TurnProfiler,
): Promise<string> {
  const segmenter = new PhraseSegmenter();
  let fullText = "";

  for await (const chunk of textStream) {
    if (signal.aborted) {
      break;
    }

    fullText += chunk;
    onDelta?.(chunk);
    writeEvent(res, "assistant_caption_delta", { delta: chunk });

    const phrases = segmenter.feed(chunk);
    for (const phrase of phrases) {
      const seq = sequence.next();
      const shouldContinue = await speakPhrase(res, phrase, seq, signal, profiler);
      if (!shouldContinue) {
        return fullText;
      }
    }
  }

  if (signal.aborted) {
    return fullText;
  }

  const remaining = segmenter.flushRemaining(true);
  if (remaining) {
    const seq = sequence.next();
    await speakPhrase(res, remaining, seq, signal, profiler);
  }

  return fullText;
}
