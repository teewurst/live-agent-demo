import http from "node:http";

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

export function toolCall(id, name, args) {
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

/** Deterministic fake agent responses for the standard benchmark scenario. */
export function buildAgentResponse(messages) {
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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

export async function createFakeOpenAiServer() {
  const server = http.createServer((req, res) => {
    void fakeApiHandler(req, res).catch((error) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  const baseUrl = await listen(server);
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
