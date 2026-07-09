import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createFakeOpenAiServer } from "./lib/fakeOpenAi.mjs";
import { reservePort, startMockBackend } from "./lib/harness.mjs";

let fakeOpenAi;
let backend;

async function executeLiveTool(sessionId, toolName, args, toolBackend = "local") {
  const response = await fetch(`${backend.baseUrl}/api/live/sessions/${sessionId}/tools/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Backend": toolBackend,
    },
    body: JSON.stringify({
      toolName,
      callId: `test-${toolName}`,
      arguments: args,
    }),
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

async function createLiveSession(toolBackend = "local") {
  const response = await fetch(`${backend.baseUrl}/api/live/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Backend": toolBackend,
      "X-Live-Agent-Prompt-Variant": "default",
    },
    body: JSON.stringify({ toolBackend, liveAgentPromptVariant: "default" }),
  });
  assert.equal(response.status, 200);
  return response.json();
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

test("live tool endpoint blocks account lookup before validation", async () => {
  const session = await createLiveSession();
  const { status, payload } = await executeLiveTool(
    session.sessionId,
    "get_customer_information",
    { lookup: "latest_invoice" },
  );
  assert.equal(status, 200);
  assert.equal(payload.status, "error");
  assert.equal(payload.result.error, "CUSTOMER_NOT_VALIDATED");
});

test("live tool endpoint validates customer and retrieves invoice", async () => {
  const session = await createLiveSession();
  const validate = await executeLiveTool(session.sessionId, "validate_customer", {
    customer_number: "12345",
    auth_method: "phone_password",
    phone_password: "9876",
  });
  assert.equal(validate.status, 200);
  assert.equal(validate.payload.status, "success");
  assert.equal(validate.payload.result.valid, true);

  const invoice = await executeLiveTool(session.sessionId, "get_customer_information", {
    lookup: "latest_invoice",
  });
  assert.equal(invoice.status, 200);
  assert.equal(invoice.payload.status, "success");
  assert.ok(invoice.payload.result);
});

test("live tool endpoint retrieves public documentation", async () => {
  const session = await createLiveSession();
  const docs = await executeLiveTool(session.sessionId, "retrieve_information", {
    query: "support hours",
  });
  assert.equal(docs.status, 200);
  assert.equal(docs.payload.status, "success");
  assert.ok(docs.payload.result);
});

test("live session creation returns system prompt and config", async () => {
  const session = await createLiveSession();
  assert.ok(session.sessionId);
  assert.ok(session.systemPrompt.includes("Helen"));
  assert.equal(session.toolBackendMode, "local");
  assert.equal(session.liveAgentPromptVariant, "default");
});
