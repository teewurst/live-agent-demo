#!/usr/bin/env node
/**
 * Debug OpenAI Realtime connect for the Live agent.
 *
 * Usage:
 *   npm run debug:live-config
 *   npm run debug:live-connect
 *   node scripts/debug-live-connect.mjs --real-sdp
 *   node scripts/debug-live-connect.mjs --backend-url http://127.0.0.1:3001 --real-sdp
 *
 * For a full end-to-end probe with real WebRTC SDP (recommended):
 *   npm run debug:live-connect:real
 */
import { loadProjectEnv, requireOpenAiKey } from "../tests/lib/loadEnv.mjs";
import { reservePort, startLiveBackend } from "../tests/lib/harness.mjs";

loadProjectEnv();
requireOpenAiKey();

const args = process.argv.slice(2);
const argSet = new Set(args);
const dumpConfigOnly = argSet.has("--dump-config");
const viaBackend = argSet.has("--via-backend");
const useRealSdp = argSet.has("--real-sdp");
const backendUrlArg = args.find((entry) => entry.startsWith("--backend-url="));
const backendUrl = backendUrlArg?.slice("--backend-url=".length);

const FAKE_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:debug",
  "a=ice-pwd:debugdebugdebugdebugdebug12",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
].join("\r\n");

function parseOpenAiErrorBody(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const payload = JSON.parse(trimmed);
    if (payload?.error?.message) {
      return {
        message: payload.error.message,
        code: payload.error.code,
        type: payload.error.type,
      };
    }
  } catch {
    // Wrapped backend errors may contain JSON inside a longer string.
    const match = trimmed.match(/"message":\s*"([^"]+)"/);
    if (match) {
      const codeMatch = trimmed.match(/"code":\s*"([^"]+)"/);
      return { message: match[1], code: codeMatch?.[1] };
    }
  }
  return { message: trimmed };
}

function classifyConnectResult(status, body) {
  if (status === 200 || status === 201) {
    return { outcome: "CONNECT_OK", summary: "Realtime connect succeeded." };
  }

  const parsed = parseOpenAiErrorBody(body);
  if (parsed?.code === "invalid_offer") {
    return {
      outcome: "SDP_INVALID",
      summary:
        "Session config was accepted; only the SDP offer is invalid (expected with --fake-sdp).",
      parsed,
    };
  }

  return {
    outcome: "CONNECT_FAILED",
    summary: parsed?.message ?? `HTTP ${status}`,
    parsed,
  };
}

async function importBuiltConfig() {
  const mod = await import(new URL("../dist/liveSessionConfig.js", import.meta.url));
  return mod.buildRealtimeSessionConfigForDebug();
}

async function createRealSdpOffer() {
  let wrtc;
  try {
    wrtc = await import("@roamhq/wrtc");
  } catch {
    throw new Error(
      "Real SDP requires @roamhq/wrtc. Run: npm run debug:live-connect:real",
    );
  }

  const { RTCPeerConnection, nonstandard } = wrtc.default ?? wrtc;
  const { RTCAudioSource } = nonstandard;
  const pc = new RTCPeerConnection();
  const source = new RTCAudioSource();
  pc.addTrack(source.createTrack());
  pc.createDataChannel("oai-events");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  pc.close();
  return offer.sdp ?? "";
}

async function resolveSdpOffer() {
  if (useRealSdp) {
    return createRealSdpOffer();
  }
  return FAKE_SDP;
}

async function createSessionViaBackend(baseUrl) {
  const response = await fetch(`${baseUrl}/api/live/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tool-Backend": "local",
      "X-Live-Agent-Prompt-Variant": "default",
    },
    body: JSON.stringify({ toolBackend: "local", liveAgentPromptVariant: "default" }),
  });
  if (!response.ok) {
    throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function connectViaBackend(baseUrl, sessionId, sdpOffer) {
  const response = await fetch(`${baseUrl}/api/live/sessions/${sessionId}/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      "X-Tool-Backend": "local",
      "X-Live-Agent-Prompt-Variant": "default",
    },
    body: sdpOffer,
  });
  const text = await response.text();
  return { status: response.status, contentType: response.headers.get("content-type"), body: text };
}

async function connectDirectOpenAi(sessionConfig, sdpOffer) {
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const formData = new FormData();
  formData.set("sdp", sdpOffer);
  formData.set("session", JSON.stringify(sessionConfig));

  const response = await fetch(`${baseUrl}/realtime/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    location: response.headers.get("location"),
    body: text,
  };
}

function printResult(label, result) {
  const classification = classifyConnectResult(result.status, result.body);
  console.log(`\n=== ${label} ===`);
  console.log(`status: ${result.status}`);
  console.log(`outcome: ${classification.outcome}`);
  console.log(`summary: ${classification.summary}`);
  if (result.contentType) {
    console.log(`content-type: ${result.contentType}`);
  }
  if (result.location) {
    console.log(`location: ${result.location}`);
  }
  console.log("body:");
  try {
    console.log(JSON.stringify(JSON.parse(result.body), null, 2));
  } catch {
    console.log(result.body.slice(0, 1200));
  }
  return classification;
}

async function main() {
  const sessionConfig = await importBuiltConfig();
  console.log("realtime model:", process.env.OPENAI_REALTIME_MODEL ?? "(default gpt-realtime)");
  console.log("transcription model:", process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "(default)");
  console.log("voice:", process.env.OPENAI_REALTIME_VOICE ?? "(default shimmer)");
  console.log("sdp mode:", useRealSdp ? "real WebRTC offer" : "fake datachannel-only offer");

  if (dumpConfigOnly) {
    console.log("\n=== session config ===");
    console.log(JSON.stringify(sessionConfig, null, 2));
    return;
  }

  const sdpOffer = await resolveSdpOffer();
  const outcomes = [];

  outcomes.push(
    printResult("direct OpenAI /realtime/calls", await connectDirectOpenAi(sessionConfig, sdpOffer)),
  );

  if (backendUrl) {
    const session = await createSessionViaBackend(backendUrl);
    console.log("\nsessionId:", session.sessionId);
    outcomes.push(
      printResult(
        `backend ${backendUrl}/api/live/sessions/:id/connect`,
        await connectViaBackend(backendUrl, session.sessionId, sdpOffer),
      ),
    );
  } else if (viaBackend) {
    const backendPort = await reservePort();
    const backend = await startLiveBackend({ backendPort, readyTimeoutMs: 20_000 });
    try {
      const session = await createSessionViaBackend(backend.baseUrl);
      console.log("\nsessionId:", session.sessionId);
      outcomes.push(
        printResult(
          "backend /api/live/sessions/:id/connect",
          await connectViaBackend(backend.baseUrl, session.sessionId, sdpOffer),
        ),
      );
    } finally {
      await backend.stop();
    }
  }

  console.log("\n=== interpretation ===");
  if (outcomes.some((entry) => entry.outcome === "CONNECT_OK")) {
    console.log("OK: Live connect works with the current session config.");
    return;
  }
  if (!useRealSdp && outcomes.every((entry) => entry.outcome === "SDP_INVALID")) {
    console.log(
      "Config looks valid. Re-run with --real-sdp or npm run debug:live-connect:real for a full connect test.",
    );
    return;
  }
  console.log("FAILED: inspect the errors above and fix session config or backend proxying.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
