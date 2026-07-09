import assert from "node:assert/strict";
import test from "node:test";
import { loadProjectEnv, requireOpenAiKey } from "./lib/loadEnv.mjs";
import { reservePort, startLiveBackend } from "./lib/harness.mjs";

loadProjectEnv();

async function createRealSdpOffer() {
  let wrtc;
  try {
    wrtc = await import("@roamhq/wrtc");
  } catch {
    return null;
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

test("live connect accepts session config and returns SDP answer", async (t) => {
  let apiKey;
  try {
    apiKey = requireOpenAiKey();
  } catch {
    t.skip("OPENAI_API_KEY is not configured");
    return;
  }
  assert.ok(apiKey);

  const sdpOffer = await createRealSdpOffer();
  if (!sdpOffer) {
    t.skip("Install @roamhq/wrtc to run the live connect probe");
    return;
  }

  const backendPort = await reservePort();
  const backend = await startLiveBackend({ backendPort, readyTimeoutMs: 20_000 });
  try {
    const createResponse = await fetch(`${backend.baseUrl}/api/live/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tool-Backend": "local",
      },
      body: JSON.stringify({ toolBackend: "local" }),
    });
    assert.equal(createResponse.status, 200);
    const { sessionId } = await createResponse.json();

    const connectResponse = await fetch(`${backend.baseUrl}/api/live/sessions/${sessionId}/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        "X-Tool-Backend": "local",
      },
      body: sdpOffer,
    });

    const answer = await connectResponse.text();
    assert.equal(connectResponse.status, 200, answer);
    assert.match(answer, /^v=0/m);
    assert.match(answer, /m=audio /m);
  } finally {
    await backend.stop();
  }
});
