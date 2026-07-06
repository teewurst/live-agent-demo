import OpenAI, { toFile } from "openai";
import { config } from "./config.js";
import { TTS_INSTRUCTIONS } from "./ttsConfig.js";
import { AppError, isAbortError } from "./errors.js";
import type { SynthesizedAudio } from "./types.js";
import type { TurnProfiler } from "./turnProfiler.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  baseURL: config.OPENAI_BASE_URL,
});

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "mp4",
};

function extensionForMime(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? "webm";
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  signal?: AbortSignal,
  profiler?: TurnProfiler,
): Promise<string> {
  if (!buffer.length) {
    throw new AppError("Empty audio upload", "EMPTY_AUDIO", 400);
  }

  const extension = extensionForMime(mimeType);
  profiler?.startSpan("stt-prep", "transcribing", "STT prepare", "build audio file");
  const file = await toFile(buffer, `utterance.${extension}`, { type: mimeType });
  profiler?.endSpan("stt-prep");

  try {
    profiler?.startSpan("stt-api", "transcribing", "STT API", config.OPENAI_STT_MODEL);
    const result = await openai.audio.transcriptions.create(
      {
        file,
        model: config.OPENAI_STT_MODEL,
      },
      { signal },
    );
    profiler?.endSpan("stt-api");

    const text = result.text?.trim() ?? "";
    if (!text) {
      throw new AppError("Empty transcript", "EMPTY_TRANSCRIPT", 400);
    }

    return text;
  } catch (error) {
    profiler?.endSpan("stt-api");
    if (isAbortError(error)) {
      throw error;
    }
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Speech transcription failed", "STT_FAILED", 502);
  }
}

export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<SynthesizedAudio> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new AppError("Empty text for TTS", "EMPTY_TTS_TEXT", 400);
  }

  try {
    const response = await openai.audio.speech.create(
      {
        model: config.OPENAI_TTS_MODEL,
        voice: config.OPENAI_TTS_VOICE as "shimmer",
        input: trimmed,
        response_format: config.OPENAI_TTS_FORMAT,
        instructions: TTS_INSTRUCTIONS,
      },
      { signal },
    );

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      mimeType: "audio/mpeg",
      base64,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new AppError("Speech synthesis failed", "TTS_FAILED", 502);
  }
}
