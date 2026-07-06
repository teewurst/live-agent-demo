import type { Response } from "express";
import { config } from "./config.js";
import { isAbortError } from "./errors.js";
import { synthesizeSpeech } from "./openaiAudio.js";
import { PhraseSegmenter } from "./phraseSegmenter.js";
import { writeEvent } from "./sse.js";

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
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }

  writeEvent(res, "status", { state: "speaking" });

  try {
    const audio = await synthesizeSpeech(phrase, signal);
    if (signal.aborted) {
      return false;
    }
    writeEvent(res, "audio_segment", {
      sequence,
      mimeType: audio.mimeType,
      base64: audio.base64,
    });
    return true;
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      return false;
    }
    writeEvent(res, "error", {
      message: "Speech synthesis failed for one segment. Captions remain visible.",
    });
    return true;
  }
}

export async function speakText(
  res: Response,
  text: string,
  signal: AbortSignal,
  sequence: SpeechSequence,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  onDelta?.(trimmed);
  writeEvent(res, "assistant_caption_delta", { delta: trimmed });

  const phrases =
    trimmed.length <= config.TTS_WHOLE_MESSAGE_MAX_CHARS
      ? [trimmed]
      : collectPhrases(trimmed);

  for (const phrase of phrases) {
    const seq = sequence.next();
    const shouldContinue = await speakPhrase(res, phrase, seq, signal);
    if (!shouldContinue) {
      break;
    }
  }

  return trimmed;
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
      const shouldContinue = await speakPhrase(res, phrase, seq, signal);
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
    await speakPhrase(res, remaining, seq, signal);
  }

  return fullText;
}
