import {
  connectLiveSession,
  executeLiveTool,
  type LiveAgentPromptVariant,
  type ToolBackendMode,
} from "../api/liveClient";

export type LiveCallState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking"
  | "interrupted"
  | "error";

export type LiveRealtimeEvent = {
  type: string;
  [key: string]: unknown;
};

export type LiveSessionCallbacks = {
  onStateChange?: (state: LiveCallState) => void;
  onAudioLevel?: (level: number) => void;
  onEvent?: (event: LiveRealtimeEvent) => void;
  onError?: (message: string) => void;
};

type ActiveResources = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  localStream: MediaStream;
  remoteAudio: HTMLAudioElement;
  analyser?: AnalyserNode;
  audioContext?: AudioContext;
  levelFrame?: number;
};

function parseJsonArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function extractMessageTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.transcript === "string" && record.transcript.trim()) {
        return record.transcript;
      }
      if (typeof record.text === "string" && record.text.trim()) {
        return record.text;
      }
      return "";
    })
    .filter(Boolean);
  return parts.join(" ").trim();
}

function extractFunctionCall(event: LiveRealtimeEvent): {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
} | null {
  if (event.type === "response.function_call_arguments.done") {
    return {
      callId: String(event.call_id ?? ""),
      name: String(event.name ?? ""),
      arguments: parseJsonArguments(event.arguments),
    };
  }

  if (event.type === "response.done") {
    const response = event.response as Record<string, unknown> | undefined;
    const output = Array.isArray(response?.output) ? response.output : [];
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type === "function_call") {
        return {
          callId: String(record.call_id ?? ""),
          name: String(record.name ?? ""),
          arguments: parseJsonArguments(record.arguments),
        };
      }
    }
  }

  return null;
}

type PendingToolOutput = {
  callId: string;
  output: string;
};

function isBenignRealtimeError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("no active response") ||
    lower.includes("cancellation failed") ||
    lower.includes("response_cancel_not_active") ||
    lower.includes("buffer is empty") ||
    lower.includes("no audio")
  );
}

function extractRealtimeErrorMessage(event: LiveRealtimeEvent): string {
  const nested = event.error as { message?: string } | undefined;
  if (nested?.message) {
    return nested.message;
  }
  if (typeof event.message === "string") {
    return event.message;
  }
  return "Realtime error";
}

function waitForDataChannelOpen(dc: RTCDataChannel, timeoutMs = 15_000): Promise<void> {
  if (dc.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Live data channel did not open"));
    }, timeoutMs);

    dc.addEventListener(
      "open",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export class RealtimeSession {
  private resources: ActiveResources | null = null;
  private callbacks: LiveSessionCallbacks = {};
  private sessionId: string | null = null;
  private toolBackend: ToolBackendMode = "local";
  private liveAgentPromptVariant: LiveAgentPromptVariant = "default";
  private connectAbort: AbortController | null = null;
  private handledCallIds = new Set<string>();
  private responseActive = false;
  private audioPlaying = false;
  private pendingToolOutputs: PendingToolOutput[] = [];
  private flushingToolOutputs = false;
  private initialTurnRequested = false;
  private sessionReady = false;
  private openingGreeting =
    "Hi, this is Helen from Nexus ERP support. How can I help you today?";
  private sessionReadyResolvers: Array<() => void> = [];
  private initialGreetingFallbackTimer: number | null = null;

  setCallbacks(callbacks: LiveSessionCallbacks): void {
    this.callbacks = callbacks;
  }

  private setState(state: LiveCallState): void {
    this.callbacks.onStateChange?.(state);
  }

  private emit(event: LiveRealtimeEvent): void {
    if (event.type === "error") {
      const message = extractRealtimeErrorMessage(event);
      if (isBenignRealtimeError(message)) {
        return;
      }
    }
    this.callbacks.onEvent?.(event);
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.resources?.dc || this.resources.dc.readyState !== "open") {
      return;
    }
    this.resources.dc.send(JSON.stringify(event));
  }

  private maybeFlushPendingToolOutputs(): void {
    if (
      this.flushingToolOutputs ||
      this.responseActive ||
      this.audioPlaying ||
      !this.pendingToolOutputs.length
    ) {
      return;
    }

    this.flushingToolOutputs = true;
    const batch = this.pendingToolOutputs.splice(0);
    for (const item of batch) {
      this.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: item.callId,
          output: item.output,
        },
      });
    }
    this.sendEvent({ type: "response.create" });
    this.flushingToolOutputs = false;
  }

  private queueToolOutput(callId: string, output: string): void {
    this.pendingToolOutputs.push({ callId, output });
    this.maybeFlushPendingToolOutputs();
  }

  private startInitialAssistantTurn(): void {
    if (this.initialTurnRequested) {
      return;
    }
    this.initialTurnRequested = true;
    this.sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: `Deliver this opening greeting naturally, then wait for the caller: "${this.openingGreeting}"`,
      },
    });
  }

  private markSessionReady(): void {
    if (this.sessionReady) {
      return;
    }
    this.sessionReady = true;
    for (const resolve of this.sessionReadyResolvers) {
      resolve();
    }
    this.sessionReadyResolvers = [];
    this.maybeStartInitialAssistantTurn();
  }

  private waitForSessionReady(timeoutMs = 8_000): Promise<void> {
    if (this.sessionReady) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        this.sessionReady = true;
        resolve();
      }, timeoutMs);
      this.sessionReadyResolvers.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
    });
  }

  private maybeStartInitialAssistantTurn(): void {
    if (this.initialTurnRequested || !this.sessionReady) {
      return;
    }
    if (!this.resources?.dc || this.resources.dc.readyState !== "open") {
      return;
    }
    this.startInitialAssistantTurn();
  }

  private clearInitialGreetingFallback(): void {
    if (this.initialGreetingFallbackTimer !== null) {
      window.clearTimeout(this.initialGreetingFallbackTimer);
      this.initialGreetingFallbackTimer = null;
    }
  }

  private scheduleInitialGreetingFallback(): void {
    this.clearInitialGreetingFallback();
    this.initialGreetingFallbackTimer = window.setTimeout(() => {
      if (!this.initialTurnRequested) {
        this.sessionReady = true;
        this.maybeStartInitialAssistantTurn();
      }
    }, 2_500);
  }

  private async ensureRemoteAudioPlayback(): Promise<void> {
    const remoteAudio = this.resources?.remoteAudio;
    if (!remoteAudio) {
      return;
    }
    try {
      await remoteAudio.play();
    } catch {
      // Browser autoplay policies can still block until the next user gesture.
    }
  }

  private startAudioLevelMonitor(stream: MediaStream): void {
    if (!this.resources) {
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!this.resources) {
        return;
      }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      this.callbacks.onAudioLevel?.(rms);
      this.resources.levelFrame = requestAnimationFrame(tick);
    };

    this.resources.audioContext = audioContext;
    this.resources.analyser = analyser;
    this.resources.levelFrame = requestAnimationFrame(tick);
  }

  private async handleFunctionCall(
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    if (!this.sessionId || !callId || !name || this.handledCallIds.has(callId)) {
      return;
    }

    this.handledCallIds.add(callId);
    this.setState("thinking");

    this.emit({
      type: "tool_call",
      toolCallId: callId,
      toolName: name,
      arguments: args,
    });

    try {
      const result = await executeLiveTool(
        this.sessionId,
        name,
        callId,
        args,
        this.toolBackend,
      );

      this.emit({
        type: "tool_result",
        toolCallId: callId,
        toolName: name,
        status: result.status,
        result: result.result,
      });

      this.queueToolOutput(callId, result.output);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      this.emit({
        type: "tool_result",
        toolCallId: callId,
        toolName: name,
        status: "error",
        result: { error: message },
      });
      this.queueToolOutput(callId, JSON.stringify({ error: message }));
    }
  }

  private handleRealtimeMessage(raw: string): void {
    let event: LiveRealtimeEvent;
    try {
      event = JSON.parse(raw) as LiveRealtimeEvent;
    } catch {
      return;
    }

    this.emit(event);

    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.markSessionReady();
        break;
      case "input_audio_buffer.speech_started":
        this.setState("listening");
        break;
      case "response.created":
        this.responseActive = true;
        this.setState("thinking");
        break;
      case "response.output_item.added":
        this.setState("thinking");
        break;
      case "output_audio_buffer.started":
        this.audioPlaying = true;
        this.setState("speaking");
        void this.ensureRemoteAudioPlayback();
        break;
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        this.setState("speaking");
        this.emit({
          type: "assistant_caption_delta",
          delta: String(event.delta ?? ""),
        });
        break;
      case "output_audio_buffer.stopped":
        this.audioPlaying = false;
        this.setState("listening");
        this.maybeFlushPendingToolOutputs();
        break;
      case "response.done":
        this.responseActive = false;
        this.setState("listening");
        this.maybeFlushPendingToolOutputs();
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.emit({
          type: "user_transcript",
          text: String(event.transcript ?? ""),
        });
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        this.emit({
          type: "assistant_text_final",
          text: String(event.transcript ?? ""),
        });
        break;
      case "response.output_text.delta":
        this.setState("speaking");
        this.emit({
          type: "assistant_caption_delta",
          delta: String(event.delta ?? ""),
        });
        break;
      case "response.output_text.done":
        this.emit({
          type: "assistant_text_final",
          text: String(event.text ?? ""),
        });
        break;
      case "conversation.item.created": {
        const item = event.item as Record<string, unknown> | undefined;
        const role = String(item?.role ?? "");
        const text =
          extractMessageTextFromContent(item?.content) ||
          String(item?.transcript ?? "");
        if (text.trim() && role === "user") {
          this.emit({ type: "user_transcript", text });
        }
        if (text.trim() && role === "assistant") {
          this.emit({ type: "assistant_text_final", text });
        }
        break;
      }
      case "error": {
        const message = extractRealtimeErrorMessage(event);
        if (isBenignRealtimeError(message)) {
          break;
        }
        this.callbacks.onError?.(message);
        this.setState("error");
        break;
      }
      default:
        break;
    }

    const functionCall = extractFunctionCall(event);
    if (functionCall?.callId && functionCall.name) {
      void this.handleFunctionCall(functionCall.callId, functionCall.name, functionCall.arguments);
    }
  }

  async connect(
    sessionId: string,
    toolBackend: ToolBackendMode,
    liveAgentPromptVariant: LiveAgentPromptVariant,
    openingGreeting?: string,
  ): Promise<void> {
    await this.disconnect();

    this.sessionId = sessionId;
    this.toolBackend = toolBackend;
    this.liveAgentPromptVariant = liveAgentPromptVariant;
    this.openingGreeting =
      openingGreeting?.trim() ||
      "Hi, this is Helen from Nexus ERP support. How can I help you today?";
    this.handledCallIds.clear();
    this.responseActive = false;
    this.audioPlaying = false;
    this.pendingToolOutputs = [];
    this.flushingToolOutputs = false;
    this.initialTurnRequested = false;
    this.sessionReady = false;
    this.sessionReadyResolvers = [];
    this.clearInitialGreetingFallback();
    this.connectAbort = new AbortController();
    this.setState("connecting");

    const pc = new RTCPeerConnection();
    const remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "true");

    pc.ontrack = (trackEvent) => {
      remoteAudio.srcObject = trackEvent.streams[0] ?? null;
      void this.ensureRemoteAudioPlayback();
    };

    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    const attachDataChannel = (dc: RTCDataChannel): void => {
      dc.addEventListener("message", (messageEvent) => {
        if (typeof messageEvent.data === "string") {
          this.handleRealtimeMessage(messageEvent.data);
        }
      });
    };

    const dc = pc.createDataChannel("oai-events");
    attachDataChannel(dc);
    pc.addEventListener("datachannel", (channelEvent) => {
      if (channelEvent.channel.label === "oai-events") {
        this.resources = this.resources
          ? { ...this.resources, dc: channelEvent.channel }
          : this.resources;
        attachDataChannel(channelEvent.channel);
      }
    });

    this.resources = {
      pc,
      dc,
      localStream,
      remoteAudio,
    };
    this.startAudioLevelMonitor(localStream);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpAnswer = await connectLiveSession(
      sessionId,
      offer.sdp ?? "",
      toolBackend,
      liveAgentPromptVariant,
      this.connectAbort.signal,
    );

    await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
    await waitForDataChannelOpen(dc);
    this.scheduleInitialGreetingFallback();
    await this.waitForSessionReady();
    this.maybeStartInitialAssistantTurn();
    this.setState("listening");
  }

  interrupt(): void {
    if (this.audioPlaying) {
      this.sendEvent({ type: "output_audio_buffer.clear" });
    }
    if (this.responseActive) {
      this.sendEvent({ type: "response.cancel" });
    }

    this.audioPlaying = false;
    this.responseActive = false;
    this.setState("listening");
  }

  async disconnect(): Promise<void> {
    this.connectAbort?.abort();
    this.connectAbort = null;
    this.clearInitialGreetingFallback();
    this.sessionReadyResolvers = [];

    if (this.resources) {
      if (this.resources.levelFrame) {
        cancelAnimationFrame(this.resources.levelFrame);
      }
      await this.resources.audioContext?.close().catch(() => undefined);
      this.resources.dc.close();
      this.resources.pc.close();
      for (const track of this.resources.localStream.getTracks()) {
        track.stop();
      }
      this.resources.remoteAudio.srcObject = null;
      this.resources = null;
    }

    this.handledCallIds.clear();
    this.responseActive = false;
    this.audioPlaying = false;
    this.pendingToolOutputs = [];
    this.flushingToolOutputs = false;
    this.initialTurnRequested = false;
    this.sessionReady = false;
    this.sessionId = null;
    this.callbacks.onAudioLevel?.(0);
  }
}
