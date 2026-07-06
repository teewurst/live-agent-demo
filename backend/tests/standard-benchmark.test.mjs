import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createFakeOpenAiServer } from "./lib/fakeOpenAi.mjs";
import {
  createSession,
  reservePort,
  runDebugTurn,
  startMockBackend,
} from "./lib/harness.mjs";
import {
  STANDARD_SCENARIO,
  buildBenchmarkReport,
} from "./lib/standardScenario.mjs";

let fakeOpenAi;
let backend;

before(async () => {
  fakeOpenAi = await createFakeOpenAiServer();
  const backendPort = await reservePort();
  backend = await startMockBackend({
    fakeBaseUrl: fakeOpenAi.baseUrl,
    backendPort,
  });
});

after(async () => {
  await backend?.stop();
  await fakeOpenAi?.close();
});

test("mock benchmark scenario produces deterministic tool flow and report", async () => {
  const sessionId = await createSession(backend.baseUrl);
  const events = await runDebugTurn(
    backend.baseUrl,
    sessionId,
    STANDARD_SCENARIO.input,
    STANDARD_SCENARIO.toolBackend,
  );
  const report = buildBenchmarkReport(events, STANDARD_SCENARIO, { mode: "strict", executionMode: "mock" });

  assert.equal(report.scenario.id, STANDARD_SCENARIO.id);
  assert.equal(report.passed, true, JSON.stringify(report.assertions.filter((item) => !item.passed), null, 2));
  assert.ok(report.turnProfile);
  assert.ok(report.summary.totalMs >= 0);
  assert.equal(
    report.toolSequence.filter((step) => step.phase === "call").map((step) => step.toolName).join(","),
    STANDARD_SCENARIO.expected.toolCallOrder.join(","),
  );
});
