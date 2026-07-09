#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeOpenAiServer } from "../tests/lib/fakeOpenAi.mjs";
import {
  createSession,
  reservePort,
  runDebugTurn,
  runUtteranceTurn,
  startLiveBackend,
  startMockBackend,
} from "../tests/lib/harness.mjs";
import { backendRoot, loadProjectEnv, requireOpenAiKey } from "../tests/lib/loadEnv.mjs";
import {
  STANDARD_SCENARIO,
  buildBenchmarkReport,
} from "../tests/lib/standardScenario.mjs";
import { ensureUtteranceFixture } from "../tests/lib/utteranceFixture.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputPath = path.join(backendRoot, "test-results", "standard-benchmark.json");

function parseArgs(argv) {
  const options = {
    mode: "live",
    route: "debug-message",
    outputPath: defaultOutputPath,
    pretty: true,
    writeFile: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mock") {
      options.mode = "mock";
      continue;
    }
    if (arg === "--live") {
      options.mode = "live";
      continue;
    }
    if (arg === "--voice") {
      options.mode = "live";
      options.route = "utterance";
      continue;
    }
    if (arg === "--stdout-only") {
      options.writeFile = false;
      continue;
    }
    if (arg === "--compact") {
      options.pretty = false;
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.outputPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  return options;
}

async function runMockBenchmark() {
  const fakeOpenAi = await createFakeOpenAiServer();
  const backendPort = await reservePort();
  const backend = await startMockBackend({
    fakeBaseUrl: fakeOpenAi.baseUrl,
    backendPort,
  });

  try {
    const sessionId = await createSession(backend.baseUrl);
    const wallStarted = performance.now();
    const { events, clientFirstResponse } = await runDebugTurn(
      backend.baseUrl,
      sessionId,
      STANDARD_SCENARIO.input,
      STANDARD_SCENARIO.toolBackend,
    );
    return buildBenchmarkReport(events, STANDARD_SCENARIO, {
      mode: "strict",
      executionMode: "mock",
      route: "debug-message",
      clientFirstResponse,
      apis: ["mock-openai.chat", "mock-openai.tts"],
      wallClockMs: Math.round(performance.now() - wallStarted),
    });
  } finally {
    await backend.stop();
    await fakeOpenAi.close();
  }
}

async function runLiveBenchmark(route) {
  loadProjectEnv();
  requireOpenAiKey();

  const backendPort = await reservePort();
  const backend = await startLiveBackend({
    backendPort,
    readyTimeoutMs: 20_000,
  });

  try {
    const sessionId = await createSession(backend.baseUrl);
    const wallStarted = performance.now();

    if (route === "utterance") {
      const audioBuffer = await ensureUtteranceFixture();
      const { events, clientTiming, clientFirstResponse } = await runUtteranceTurn(
        backend.baseUrl,
        sessionId,
        audioBuffer,
        "audio/mpeg",
        STANDARD_SCENARIO.toolBackend,
      );

      return buildBenchmarkReport(events, STANDARD_SCENARIO, {
        mode: "live",
        executionMode: "live-voice",
        route: "utterance",
        clientTiming,
        clientFirstResponse,
        apis: [
          "openai.audio.transcriptions",
          "openai.chat.completions",
          "openai.audio.speech",
        ],
        models: {
          stt: process.env.OPENAI_STT_MODEL ?? null,
          agent: process.env.OPENAI_AGENT_MODEL ?? null,
          tts: process.env.OPENAI_TTS_MODEL ?? null,
        },
        wallClockMs: Math.round(performance.now() - wallStarted),
      });
    }

    const { events, clientFirstResponse } = await runDebugTurn(
      backend.baseUrl,
      sessionId,
      STANDARD_SCENARIO.input,
      STANDARD_SCENARIO.toolBackend,
    );

    return buildBenchmarkReport(events, STANDARD_SCENARIO, {
      mode: "live",
      executionMode: "live-debug",
      route: "debug-message",
      clientFirstResponse,
      apis: ["openai.chat.completions", "openai.audio.speech"],
      models: {
        agent: process.env.OPENAI_AGENT_MODEL ?? null,
        tts: process.env.OPENAI_TTS_MODEL ?? null,
      },
      wallClockMs: Math.round(performance.now() - wallStarted),
    });
  } finally {
    await backend.stop();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report =
    options.mode === "mock"
      ? await runMockBenchmark()
      : await runLiveBenchmark(options.route);

  const json = options.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);

  if (options.writeFile) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${json}\n`, "utf8");
    process.stderr.write(`Benchmark report written to ${options.outputPath}\n`);
  }

  process.stderr.write(
    `Mode: ${report.execution.mode} · wall ${report.summary.totalMs ?? report.execution.wallClockMs} ms server · ` +
      `first caption ${report.summary.firstResponse?.server?.captionMs ?? report.summary.firstResponse?.client?.captionMs ?? "?"} ms · ` +
      `passed: ${report.passed}\n`,
  );

  process.stdout.write(`${json}\n`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
