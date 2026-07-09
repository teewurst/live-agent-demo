import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { backendRoot } from "./loadEnv.mjs";

export async function reservePort() {
  const probe = http.createServer();
  const baseUrl = await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  await new Promise((resolve) => probe.close(resolve));
  return new URL(baseUrl).port;
}

export async function waitForBackend(backendBaseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendBaseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Backend did not become ready");
}

export async function startMockBackend({ fakeBaseUrl, backendPort, extraEnv = {} }) {
  const backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  const backendProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `${fakeBaseUrl}/v1`,
      BACKEND_PORT: backendPort,
      FRONTEND_ORIGIN: "http://localhost:3000",
      PHRASE_MIN_CHARS: "1",
      DEMO_CUSTOMER_PASSWORDS: '{"12345":"9876","67890":"horizon42"}',
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return startBackendProcess(backendProcess, backendBaseUrl);
}

/** Starts backend with real OpenAI credentials from the environment (.env). */
export async function startLiveBackend({ backendPort, extraEnv = {}, readyTimeoutMs = 15_000 }) {
  const backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  const backendProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      BACKEND_PORT: String(backendPort),
      FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
      PHRASE_MIN_CHARS: "1",
      DEMO_CUSTOMER_PASSWORDS:
        process.env.DEMO_CUSTOMER_PASSWORDS ?? '{"12345":"9876","67890":"horizon42"}',
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return startBackendProcess(backendProcess, backendBaseUrl, readyTimeoutMs);
}

/** @deprecated use startMockBackend */
export async function startBackend(options) {
  return startMockBackend(options);
}

async function startBackendProcess(backendProcess, backendBaseUrl, readyTimeoutMs = 10_000) {
  let stderr = "";
  backendProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  backendProcess.once("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(`Backend exited with ${code}: ${stderr}\n`);
    }
  });

  await waitForBackend(backendBaseUrl, readyTimeoutMs);

  return {
    baseUrl: backendBaseUrl,
    stop: async () => {
      backendProcess.kill("SIGTERM");
      await new Promise((resolve) => backendProcess.once("exit", resolve));
    },
  };
}

export async function readSse(response, options = {}) {
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  const requestStartedAt = options.requestStartedAt ?? performance.now();
  let streamStartedAt = options.streamStartedAt ?? null;
  let firstChunkAt = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (firstChunkAt === null) {
      firstChunkAt = performance.now();
      if (streamStartedAt === null) {
        streamStartedAt = firstChunkAt;
      }
    }
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const name = block.match(/^event:\s*(.+)$/m)?.[1];
      const rawData = block.match(/^data:\s*(.+)$/m)?.[1];
      if (name && rawData) {
        const receivedAtMs = Math.round(performance.now() - requestStartedAt);
        const streamAtMs =
          streamStartedAt !== null ? Math.round(performance.now() - streamStartedAt) : null;
        events.push({
          name,
          data: JSON.parse(rawData),
          receivedAtMs,
          streamAtMs,
        });
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

export function computeClientFirstResponse(events) {
  const captionEvent = events.find((event) => event.name === "assistant_caption_delta");
  const audioEvent = events.find((event) => event.name === "audio_segment");

  return {
    captionMs: captionEvent?.receivedAtMs ?? null,
    audioMs: audioEvent?.receivedAtMs ?? null,
    streamCaptionMs: captionEvent?.streamAtMs ?? null,
    streamAudioMs: audioEvent?.streamAtMs ?? null,
    captionPreview:
      captionEvent?.data?.delta != null ? String(captionEvent.data.delta).slice(0, 120) : undefined,
  };
}

export async function createSession(backendBaseUrl) {
  const response = await fetch(`${backendBaseUrl}/api/sessions/instant`, { method: "POST" });
  assert.equal(response.status, 200);
  return (await response.json()).sessionId;
}

export async function runDebugTurn(backendBaseUrl, sessionId, text, toolBackend = "local") {
  const requestStartedAt = performance.now();
  const response = await fetch(`${backendBaseUrl}/api/sessions/${sessionId}/debug-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Backend": toolBackend,
    },
    body: JSON.stringify({ text }),
  });
  const events = await readSse(response, { requestStartedAt });
  return { events, clientFirstResponse: computeClientFirstResponse(events) };
}

function readUtteranceResourceTiming(url, fallbackMs) {
  const entries = performance.getEntriesByType("resource");
  const entry = [...entries].reverse().find((item) => item.name.startsWith(url));
  if (!entry || entry.responseStart <= 0 || entry.requestStart <= 0) {
    return { uploadMs: fallbackMs, connectMs: 0 };
  }

  return {
    uploadMs: Math.max(0, Math.round(entry.responseStart - entry.requestStart)),
    connectMs:
      entry.connectEnd > 0 && entry.connectStart > 0
        ? Math.max(0, Math.round(entry.connectEnd - entry.connectStart))
        : 0,
  };
}

export async function runUtteranceTurn(
  backendBaseUrl,
  sessionId,
  audioBuffer,
  mimeType = "audio/mpeg",
  toolBackend = "local",
) {
  const utteranceUrl = `${backendBaseUrl}/api/sessions/${sessionId}/utterance`;
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append("audio", blob, mimeType.includes("mpeg") ? "utterance.mp3" : "utterance.webm");

  const uploadStarted = performance.now();
  const response = await fetch(utteranceUrl, {
    method: "POST",
    body: formData,
    headers: {
      "X-Tool-Backend": toolBackend,
    },
  });
  const streamStartedAt = performance.now();
  const fallbackUploadMs = Math.max(0, Math.round(streamStartedAt - uploadStarted));
  const { uploadMs, connectMs } = readUtteranceResourceTiming(utteranceUrl, fallbackUploadMs);
  const events = await readSse(response, {
    requestStartedAt: uploadStarted,
    streamStartedAt,
  });

  return {
    events,
    clientTiming: {
      uploadMs,
      connectMs,
      audioBytes: audioBuffer.byteLength,
    },
    clientFirstResponse: computeClientFirstResponse(events),
  };
}
