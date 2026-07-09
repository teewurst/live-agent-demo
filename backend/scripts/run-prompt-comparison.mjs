#!/usr/bin/env node
/**
 * A/B benchmark: default prompt vs latency_ux prompt (live OpenAI APIs).
 *
 * Usage:
 *   node backend/scripts/run-prompt-comparison.mjs
 *   node backend/scripts/run-prompt-comparison.mjs --voice
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  reservePort,
  runDebugTurn,
  runUtteranceTurn,
  startLiveBackend,
} from "../tests/lib/harness.mjs";
import { backendRoot, loadProjectEnv, requireOpenAiKey } from "../tests/lib/loadEnv.mjs";
import {
  STANDARD_SCENARIO,
  buildBenchmarkReport,
} from "../tests/lib/standardScenario.mjs";
import { ensureUtteranceFixture } from "../tests/lib/utteranceFixture.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(backendRoot, "test-results");

const PROMPT_VARIANTS = [
  { id: "default", env: { AGENT_PROMPT_VARIANT: "default" } },
  { id: "latency_ux", env: { AGENT_PROMPT_VARIANT: "latency_ux" } },
];

function parseArgs(argv) {
  return { voice: argv.includes("--voice") };
}

function countLlmSteps(events) {
  const spans = events.find((event) => event.name === "turn_profile")?.data?.spans ?? [];
  return spans.filter((span) => span.kind === "agent_llm").length;
}

function countEmitOutput(events) {
  return events.filter((event) => event.name === "tool_call" && event.data.toolName === "emit_output")
    .length;
}

function bucketMs(report, key) {
  return report.summary.buckets.find((bucket) => bucket.key === key)?.ms ?? 0;
}

function summarizeReport(report) {
  const criticalFailed = report.assertions.filter((item) => item.critical && !item.passed);
  const fr = report.summary.firstResponse ?? {};
  return {
    promptVariant: report.execution.promptVariant,
    passed: report.passed,
    totalMs: report.summary.totalMs,
    serverMs: report.summary.serverMs,
    wallClockMs: report.execution.wallClockMs,
    firstResponse: {
      serverCaptionMs: fr.server?.captionMs ?? null,
      serverAudioMs: fr.server?.audioMs ?? null,
      clientCaptionMs: fr.client?.captionMs ?? null,
      clientAudioMs: fr.client?.audioMs ?? null,
      streamCaptionMs: fr.client?.streamCaptionMs ?? null,
      captionPreview: fr.server?.captionPreview ?? fr.client?.captionPreview ?? "",
    },
    llmSteps: countLlmSteps(report.events),
    emitOutputCalls: countEmitOutput(report.events),
    toolCallNames: report.summary.toolCallNames,
    buckets: Object.fromEntries(
      (report.summary.buckets ?? []).map((bucket) => [bucket.key, bucket.ms]),
    ),
    caption: report.summary.assistantCaption?.slice(0, 160) ?? "",
    failedAssertions: criticalFailed.map((item) => item.id),
    nonCriticalFailed: report.assertions
      .filter((item) => !item.critical && !item.passed)
      .map((item) => item.id),
  };
}

function evaluateComparison(defaultRun, latencyRun) {
  const verdicts = [];
  const delta = (a, b) => (a != null && b != null ? b - a : null);

  const totalDelta = delta(defaultRun.totalMs, latencyRun.totalMs);
  if (totalDelta != null) {
    verdicts.push({
      metric: "total_server_ms",
      default: defaultRun.totalMs,
      latency_ux: latencyRun.totalMs,
      deltaMs: totalDelta,
      better: totalDelta < 0 ? "latency_ux" : totalDelta > 0 ? "default" : "tie",
    });
  }

  const llmDelta = delta(defaultRun.llmSteps, latencyRun.llmSteps);
  verdicts.push({
    metric: "llm_steps",
    default: defaultRun.llmSteps,
    latency_ux: latencyRun.llmSteps,
    delta: llmDelta,
    better:
      llmDelta != null && llmDelta < 0
        ? "latency_ux"
        : llmDelta != null && llmDelta > 0
          ? "default"
          : "tie",
  });

  const agentDelta = delta(defaultRun.buckets.agent, latencyRun.buckets.agent);
  if (agentDelta != null) {
    verdicts.push({
      metric: "agent_bucket_ms",
      default: defaultRun.buckets.agent,
      latency_ux: latencyRun.buckets.agent,
      deltaMs: agentDelta,
      better: agentDelta < 0 ? "latency_ux" : agentDelta > 0 ? "default" : "tie",
    });
  }

  const firstCaptionDelta = delta(
    defaultRun.firstResponse.serverCaptionMs,
    latencyRun.firstResponse.serverCaptionMs,
  );
  if (firstCaptionDelta != null) {
    verdicts.push({
      metric: "first_response_caption_ms",
      default: defaultRun.firstResponse.serverCaptionMs,
      latency_ux: latencyRun.firstResponse.serverCaptionMs,
      deltaMs: firstCaptionDelta,
      better:
        firstCaptionDelta < 0 ? "latency_ux" : firstCaptionDelta > 0 ? "default" : "tie",
    });
  }

  const firstAudioDelta = delta(
    defaultRun.firstResponse.serverAudioMs,
    latencyRun.firstResponse.serverAudioMs,
  );
  if (firstAudioDelta != null) {
    verdicts.push({
      metric: "first_response_audio_ms",
      default: defaultRun.firstResponse.serverAudioMs,
      latency_ux: latencyRun.firstResponse.serverAudioMs,
      deltaMs: firstAudioDelta,
      better: firstAudioDelta < 0 ? "latency_ux" : firstAudioDelta > 0 ? "default" : "tie",
    });
  }

  const bothPassed = defaultRun.passed && latencyRun.passed;
  const success =
    bothPassed &&
    (llmDelta != null && llmDelta <= 0) &&
    (totalDelta == null || totalDelta <= 0);

  let recommendation;
  if (!bothPassed) {
    recommendation =
      "latency_ux prompt needs tuning — one or both runs failed functional checks.";
  } else if (success && (totalDelta ?? 0) < -200) {
    recommendation =
      "latency_ux is faster and correct — good candidate to trial in the UI.";
  } else if (success && Math.abs(totalDelta ?? 0) <= 200) {
    recommendation =
      "Similar speed; prefer latency_ux if subjective ack behavior is better in manual listen tests.";
  } else if (bothPassed && (totalDelta ?? 0) > 200) {
    recommendation =
      "latency_ux passed but was slower this run — check for extra emit_output or preamble overlap.";
  } else {
    recommendation = "Inconclusive — re-run or test voice path.";
  }

  return { verdicts, success, bothPassed, recommendation };
}

async function runVariant(variant, route) {
  const backendPort = await reservePort();
  const backend = await startLiveBackend({
    backendPort,
    extraEnv: variant.env,
    readyTimeoutMs: 25_000,
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
        promptVariant: variant.id,
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
      promptVariant: variant.id,
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
  loadProjectEnv();
  requireOpenAiKey();

  const route = options.voice ? "utterance" : "debug-message";
  const reports = [];

  for (const variant of PROMPT_VARIANTS) {
    process.stderr.write(`\nRunning ${variant.id} (${route})...\n`);
    const report = await runVariant(variant, route);
    reports.push(report);
    process.stderr.write(
      `  passed=${report.passed} totalMs=${report.summary.totalMs} ` +
        `firstCaption=${report.summary.firstResponse?.server?.captionMs ?? "?"}ms ` +
        `firstAudio=${report.summary.firstResponse?.server?.audioMs ?? "?"}ms ` +
        `tools=${report.summary.toolCallNames.join(" → ")}\n`,
    );
  }

  const summaries = reports.map(summarizeReport);
  const [defaultRun, latencyRun] = summaries;
  const evaluation = evaluateComparison(defaultRun, latencyRun);

  const comparison = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    route,
    model: process.env.OPENAI_AGENT_MODEL ?? null,
    scenarios: summaries,
    evaluation,
    reports,
  };

  await mkdir(outputDir, { recursive: true });
  const suffix = options.voice ? "voice" : "debug";
  const outputPath = path.join(outputDir, `prompt-comparison-${suffix}.json`);
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");

  process.stderr.write(`\nWritten: ${outputPath}\n`);
  process.stderr.write(`Recommendation: ${evaluation.recommendation}\n\n`);

  process.stdout.write(`${JSON.stringify({ scenarios: summaries, evaluation }, null, 2)}\n`);
  process.exit(evaluation.bothPassed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
