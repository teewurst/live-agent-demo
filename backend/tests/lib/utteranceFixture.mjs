import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { backendRoot } from "./loadEnv.mjs";
import { STANDARD_SCENARIO } from "./standardScenario.mjs";

const FIXTURE_PATH = path.join(backendRoot, "tests/fixtures/standard-utterance.mp3");

export function utteranceFixturePath() {
  return FIXTURE_PATH;
}

export async function ensureUtteranceFixture() {
  try {
    await access(FIXTURE_PATH);
    return readFile(FIXTURE_PATH);
  } catch {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    });

    const response = await openai.audio.speech.create({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts-2025-03-20",
      voice: (process.env.OPENAI_TTS_VOICE ?? "shimmer"),
      input: STANDARD_SCENARIO.input,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
    await writeFile(FIXTURE_PATH, buffer);
    process.stderr.write(`Generated utterance fixture: ${FIXTURE_PATH}\n`);
    return buffer;
  }
}
