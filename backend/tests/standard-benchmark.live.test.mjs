import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  createSession,
  reservePort,
  runDebugTurn,
  runUtteranceTurn,
  startLiveBackend,
} from "./lib/harness.mjs";
import { loadProjectEnv, requireOpenAiKey } from "./lib/loadEnv.mjs";
import {
  STANDARD_SCENARIO,
  buildBenchmarkReport,
} from "./lib/standardScenario.mjs";
import { ensureUtteranceFixture } from "./lib/utteranceFixture.mjs";

loadProjectEnv();
const hasLiveKey = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_API_KEY !== "test-key");

let backend;

before(async () => {
  if (!hasLiveKey) {
    return;
  }
  requireOpenAiKey();
  const backendPort = await reservePort();
  backend = await startLiveBackend({
    backendPort,
    readyTimeoutMs: 20_000,
  });
});

after(async () => {
  await backend?.stop();
});

test(
  "live benchmark hits real OpenAI APIs and records execution timing",
  { timeout: 180_000, skip: !hasLiveKey },
  async () => {
    const sessionId = await createSession(backend.baseUrl);
    const wallStarted = performance.now();
    const events = await runDebugTurn(
      backend.baseUrl,
      sessionId,
      STANDARD_SCENARIO.input,
      STANDARD_SCENARIO.toolBackend,
    );
    const report = buildBenchmarkReport(events, STANDARD_SCENARIO, {
      mode: "live",
      executionMode: "live-debug",
      route: "debug-message",
      apis: ["openai.chat.completions", "openai.audio.speech"],
      wallClockMs: Math.round(performance.now() - wallStarted),
    });

    assert.equal(report.execution.mode, "live-debug");
    assert.equal(report.passed, true, JSON.stringify(report.assertions.filter((item) => !item.passed), null, 2));
    assert.ok(report.summary.totalMs > 100, `expected real API latency, got ${report.summary.totalMs} ms`);
    assert.ok(report.turnProfile?.buckets?.length > 0);
    assert.ok(report.summary.toolCallNames.includes("validate_customer"));
    assert.ok(report.summary.toolCallNames.includes("get_customer_information"));
  },
);

test(
  "live voice benchmark includes STT middleware timing via real APIs",
  { timeout: 240_000, skip: !hasLiveKey },
  async () => {
    const audioBuffer = await ensureUtteranceFixture();
    const sessionId = await createSession(backend.baseUrl);
    const wallStarted = performance.now();
    const { events, clientTiming } = await runUtteranceTurn(
      backend.baseUrl,
      sessionId,
      audioBuffer,
      "audio/mpeg",
      STANDARD_SCENARIO.toolBackend,
    );
    const report = buildBenchmarkReport(events, STANDARD_SCENARIO, {
      mode: "live",
      executionMode: "live-voice",
      route: "utterance",
      clientTiming,
      apis: ["openai.audio.transcriptions", "openai.chat.completions", "openai.audio.speech"],
      wallClockMs: Math.round(performance.now() - wallStarted),
    });

    assert.equal(report.execution.mode, "live-voice");
    assert.equal(report.passed, true, JSON.stringify(report.assertions.filter((item) => !item.passed), null, 2));
    assert.ok(report.summary.totalMs > 500, `expected full voice pipeline latency, got ${report.summary.totalMs} ms`);
    assert.ok(
      report.turnProfile?.buckets?.some((bucket) => bucket.key === "transcribing"),
      "middleware/STT bucket expected for utterance route",
    );
  },
);
