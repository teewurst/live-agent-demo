import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createFakeOpenAiServer } from "./lib/fakeOpenAi.mjs";
import {
  createSession,
  reservePort,
  runDebugTurn,
  startMockBackend,
} from "./lib/harness.mjs";

let fakeOpenAi;
let backend;

function eventNames(events) {
  return events.map((event) => event.name);
}

function assistantCaptions(events) {
  return events
    .filter((event) => event.name === "assistant_caption_delta")
    .map((event) => event.data.delta)
    .join("");
}

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

test("validated research flow speaks interim output, researches, and finishes", async () => {
  const sessionId = await createSession(backend.baseUrl);
  const events = await runDebugTurn(
    backend.baseUrl,
    sessionId,
    "Please find my latest invoice. Customer 12345 password 9876.",
  );
  const names = eventNames(events);
  const captions = assistantCaptions(events);

  assert.ok(names.includes("tool_call"));
  assert.ok(names.includes("tool_result"));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "emit_output"));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "validate_customer"));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "get_customer_information"));
  assert.match(captions, /One moment please/);
  assert.match(captions, /INV-12345-2026-004/);
  assert.equal(events.at(-1)?.data.state, "done");
});

test("research without validation is blocked and explained to the caller", async () => {
  const sessionId = await createSession(backend.baseUrl);
  const events = await runDebugTurn(
    backend.baseUrl,
    sessionId,
    "Look up my invoice without validating first.",
  );
  const captions = assistantCaptions(events);

  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "get_customer_information"));
  assert.ok(
    events.some(
      (event) =>
        event.name === "tool_result" &&
        event.data.toolName === "get_customer_information" &&
        event.data.status === "error",
    ),
  );
  assert.match(captions, /verify your customer number/i);
  assert.equal(events.at(-1)?.data.state, "done");
});

test("local tool backend returns demo validation and research results", async () => {
  const sessionId = await createSession(backend.baseUrl);
  const events = await runDebugTurn(
    backend.baseUrl,
    sessionId,
    "Please find my latest invoice. Customer 12345 password 9876.",
    "local",
  );

  const validateResult = events.find(
    (event) => event.name === "tool_result" && event.data.toolName === "validate_customer",
  );
  assert.ok(validateResult);
  assert.equal(validateResult.data.status, "success");
  assert.match(JSON.stringify(validateResult.data.result), /local_demo/);

  const researchResult = events.find(
    (event) => event.name === "tool_result" && event.data.toolName === "get_customer_information",
  );
  assert.ok(researchResult);
  assert.match(JSON.stringify(researchResult.data.result), /INV-12345-2026-004/);
});
