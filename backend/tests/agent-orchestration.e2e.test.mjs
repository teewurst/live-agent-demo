import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { after, before, test } from "node:test";

let fakeServer;
let backendProcess;
let fakeBaseUrl;
let backendBaseUrl;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function toolCall(id, name, args) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function assistantToolCalls(calls) {
  return {
    id: "chatcmpl-tools",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls,
        },
      },
    ],
  };
}

function assistantFinal(message) {
  return {
    id: "chatcmpl-final",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [toolCall("tc-final", "emit_output", { message, is_final: true })],
        },
      },
    ],
  };
}

function buildAgentResponse(messages) {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";

  if (toolMessages.length === 0) {
    if (lastUser.toLowerCase().includes("without validating")) {
      return assistantToolCalls([
        toolCall("tc-out-1", "emit_output", { message: "One moment please.", is_final: false }),
        toolCall("tc-research-1", "get_customer_information", { lookup: "latest_invoice" }),
      ]);
    }

    return assistantToolCalls([
      toolCall("tc-out-1", "emit_output", { message: "One moment please.", is_final: false }),
      toolCall("tc-validate-1", "validate_customer", {
        customer_number: "12345",
        auth_method: "phone_password",
        phone_password: "9876",
      }),
    ]);
  }

  const lastTool = toolMessages.at(-1)?.content ?? "";
  if (lastTool.includes("CUSTOMER_NOT_VALIDATED")) {
    return assistantFinal(
      "I need to verify your customer number and phone password before I can look that up.",
    );
  }

  if (lastTool.includes('"valid":true') || lastTool.includes('"valid": true')) {
    return assistantToolCalls([
      toolCall("tc-out-2", "emit_output", { message: "Thanks, checking that now.", is_final: false }),
      toolCall("tc-research-1", "get_customer_information", { lookup: "latest_invoice" }),
    ]);
  }

  if (lastTool.includes("INV-12345-2026-004")) {
    return assistantFinal("Your latest invoice number is INV-12345-2026-004.");
  }

  return assistantFinal("I could not complete that request.");
}

async function fakeApiHandler(req, res) {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    const body = await readJson(req);
    sendJson(res, buildAgentResponse(body.messages ?? []));
    return;
  }

  if (req.method === "POST" && req.url === "/v1/audio/speech") {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(Buffer.from("fake-mp3-audio"));
    return;
  }

  res.writeHead(404);
  res.end();
}

async function waitForBackend() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendBaseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Backend process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Backend did not become ready");
}

async function readSse(response, onEvent) {
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const name = block.match(/^event:\s*(.+)$/m)?.[1];
      const rawData = block.match(/^data:\s*(.+)$/m)?.[1];
      if (name && rawData) {
        const event = { name, data: JSON.parse(rawData) };
        events.push(event);
        await onEvent?.(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

async function createSession() {
  const response = await fetch(`${backendBaseUrl}/api/sessions/instant`, { method: "POST" });
  assert.equal(response.status, 200);
  return (await response.json()).sessionId;
}

async function runDebugTurn(sessionId, text, onEvent, toolBackend = "local") {
  const response = await fetch(`${backendBaseUrl}/api/sessions/${sessionId}/debug-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Backend": toolBackend,
    },
    body: JSON.stringify({ text }),
  });
  return readSse(response, onEvent);
}

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
  fakeServer = http.createServer((req, res) => {
    void fakeApiHandler(req, res).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  fakeBaseUrl = await listen(fakeServer);

  const portProbe = http.createServer();
  backendBaseUrl = await listen(portProbe);
  const backendPort = new URL(backendBaseUrl).port;
  await new Promise((resolve) => portProbe.close(resolve));

  backendProcess = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: `${fakeBaseUrl}/v1`,
        BACKEND_PORT: backendPort,
        FRONTEND_ORIGIN: "http://localhost:3000",
        PHRASE_MIN_CHARS: "1",
        DEMO_CUSTOMER_PASSWORDS: '{"12345":"9876","67890":"horizon42"}',
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  backendProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  backendProcess.once("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`Backend exited with ${code}: ${stderr}\n`);
    }
  });
  await waitForBackend();
});

after(async () => {
  backendProcess?.kill("SIGTERM");
  await new Promise((resolve) => fakeServer?.close(resolve));
});

test("validated research flow speaks interim output, researches, and finishes", async () => {
  const sessionId = await createSession();
  const events = await runDebugTurn(
    sessionId,
    "Please find my latest invoice. Customer 12345 password 9876.",
  );
  const names = eventNames(events);
  const captions = assistantCaptions(events);

  assert.ok(names.includes("tool_call"));
  assert.ok(names.includes("tool_result"));
  assert.ok(names.some((name) => name === "tool_call" && true));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "emit_output"));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "validate_customer"));
  assert.ok(events.some((event) => event.name === "tool_call" && event.data.toolName === "get_customer_information"));
  assert.match(captions, /One moment please/);
  assert.match(captions, /INV-12345-2026-004/);
  assert.equal(events.at(-1)?.data.state, "done");
});

test("research without validation is blocked and explained to the caller", async () => {
  const sessionId = await createSession();
  const events = await runDebugTurn(sessionId, "Look up my invoice without validating first.");
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
  const sessionId = await createSession();
  const events = await runDebugTurn(
    sessionId,
    "Please find my latest invoice. Customer 12345 password 9876.",
    undefined,
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
