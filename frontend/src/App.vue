<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  createSession,
  interruptSession,
  openCall,
  reopenCall,
  sendDebugMessage,
  sendUtterance,
  type SseEventName,
  type ToolBackendMode,
} from "./api/client";
import { PlaybackQueue } from "./audio/playbackQueue";
import { unlockAudioPlayback } from "./audio/unlockAudio";
import { DEMO_CUSTOMERS, PRIMARY_DEMO_CUSTOMER } from "./demoCredentials";
import { UtteranceRecorder } from "./audio/recorder";
import BackgroundPanel from "./components/BackgroundPanel.vue";
import CallControls from "./components/CallControls.vue";
import PhoneFrame from "./components/PhoneFrame.vue";
import StatusPill from "./components/StatusPill.vue";
import Waveform from "./components/Waveform.vue";
import { useOrchestrationState } from "./composables/useOrchestrationState";

type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

const callState = ref<CallState>("idle");
const sessionId = ref<string | null>(null);
const audioLevel = ref(0);
const errorMessage = ref<string | null>(null);
const {
  sessionLog,
  execution,
  expandedIds,
  liveAssistantId,
  clearSession,
  resetExecution,
  markInterrupted,
  setOutputPlaybackActive,
  setAgentListening,
  toggleExpanded,
  focusToolCall,
  handleSseEvent: handleOrchestrationEvent,
} = useOrchestrationState();
const toolBackendMode = ref<ToolBackendMode>(
  (localStorage.getItem("toolBackendMode") as ToolBackendMode | null) ?? "local",
);

let utteranceAbort: AbortController | null = null;
let turnCounter = 0;
let acceptAudioSegments = true;
let greetingInProgress = false;
let openingPlaybackStarted = false;
let openingPlaybackFailed = false;

const debugMessages = [
  "I need my invoice number.",
  "Where can I find my phone password?",
  `My customer number is ${PRIMARY_DEMO_CUSTOMER.customerNumber} and phone password is ${PRIMARY_DEMO_CUSTOMER.phonePassword}. Please look up my latest invoice.`,
  "Look up my invoice without validating first.",
];

const playbackQueue = new PlaybackQueue({
  onPlaybackStart: () => {
    recorder.setPlaybackActive(true);
    setOutputPlaybackActive(true);
    if (greetingInProgress) {
      openingPlaybackStarted = true;
    }
    if (callState.value !== "recording") {
      callState.value = "speaking";
    }
  },
  onPlaybackError: () => {
    if (greetingInProgress) {
      openingPlaybackFailed = true;
    }
  },
  onQueueEmpty: () => {
    recorder.setPlaybackActive(false);
    setOutputPlaybackActive(false);
    setAgentListening();
    if (["speaking", "thinking", "transcribing"].includes(callState.value)) {
      callState.value = "listening";
    }
  },
});

const recorder = new UtteranceRecorder({
  onSpeechStart: () => {
    const assistantAudioPlaying = playbackQueue.isActive();
    if (assistantAudioPlaying) {
      void handleBargeIn();
      return;
    }
    callState.value = "recording";
  },
  onSpeechEnd: (blob) => {
    void submitUtterance(blob);
  },
  onLevel: (rms) => {
    audioLevel.value = rms;
  },
  onError: (message) => {
    errorMessage.value = message;
    callState.value = "error";
  },
});

const callActive = computed(() => callState.value !== "idle");
const canStop = computed(() => callActive.value);

async function handleSseEvent(event: SseEventName, data: Record<string, unknown>): Promise<void> {
  switch (event) {
    case "status": {
      const state = String(data.state ?? "");
      if (state === "transcribing") callState.value = "transcribing";
      if (state === "thinking") callState.value = "thinking";
      if (state === "speaking") callState.value = "speaking";
      if (state === "done") {
        if (greetingInProgress) {
          callState.value = playbackQueue.isActive() ? "speaking" : callState.value;
        } else {
          callState.value = playbackQueue.isActive() ? "speaking" : "listening";
        }
      }
      if (state === "interrupted") callState.value = "listening";
      if (state === "error") callState.value = "error";
      break;
    }
    case "audio_segment":
      if (!acceptAudioSegments) {
        break;
      }
      playbackQueue.enqueue(
        String(data.base64 ?? ""),
        String(data.mimeType ?? "audio/mpeg"),
        Number(data.sequence ?? 0),
      );
      break;
    case "error":
      errorMessage.value = String(data.message ?? "Unexpected error");
      break;
    default:
      break;
  }

  handleOrchestrationEvent(event, data);
}

async function stopCallActivity(): Promise<void> {
  acceptAudioSegments = false;
  playbackQueue.clear();
  recorder.setPlaybackActive(false);
  setOutputPlaybackActive(false);

  utteranceAbort?.abort();
  utteranceAbort = null;

  recorder.cancelActiveRecording();

  if (sessionId.value) {
    try {
      await interruptSession(sessionId.value);
    } catch {
      // Keep local stop flow even if backend call fails.
    }
  }

  liveAssistantId.value = null;

  if (!callActive.value) {
    return;
  }

  if (callState.value === "listening" && !recorder.isRecording()) {
    recorder.stop();
    sessionId.value = null;
    callState.value = "idle";
    return;
  }

  callState.value = "listening";
}

async function handleBargeIn(): Promise<void> {
  acceptAudioSegments = false;
  playbackQueue.clear();
  recorder.setPlaybackActive(false);
  setOutputPlaybackActive(false);

  utteranceAbort?.abort();
  utteranceAbort = null;

  if (sessionId.value) {
    try {
      await interruptSession(sessionId.value);
    } catch {
      // Keep local interrupt flow even if backend call fails.
    }
  }

  liveAssistantId.value = null;
  callState.value = "recording";
}

function setToolBackendMode(mode: ToolBackendMode): void {
  toolBackendMode.value = mode;
  localStorage.setItem("toolBackendMode", mode);
}

async function submitUtterance(blob: Blob): Promise<void> {
  if (!sessionId.value) {
    return;
  }

  utteranceAbort?.abort();
  utteranceAbort = new AbortController();
  const activeSignal = utteranceAbort.signal;
  turnCounter += 1;
  acceptAudioSegments = true;
  callState.value = "transcribing";
  liveAssistantId.value = null;

  try {
    await sendUtterance(
      sessionId.value,
      blob,
      (event, data) => {
        void handleSseEvent(event, data);
      },
      activeSignal,
      String(turnCounter),
      toolBackendMode.value,
    );
  } catch (error) {
    if (activeSignal.aborted) {
      callState.value = "listening";
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to process utterance";
    callState.value = "error";
  }
}

async function submitDebugMessage(text: string): Promise<void> {
  acceptAudioSegments = false;
  playbackQueue.clear();
  utteranceAbort?.abort();

  if (!sessionId.value) {
    sessionId.value = await createSession();
  } else {
    try {
      await interruptSession(sessionId.value);
    } catch {
      // Debug mode should still be able to start a fresh request locally.
    }
  }

  utteranceAbort = new AbortController();
  const activeSignal = utteranceAbort.signal;
  turnCounter += 1;
  acceptAudioSegments = true;
  errorMessage.value = null;
  liveAssistantId.value = null;
  callState.value = "thinking";

  try {
    await sendDebugMessage(
      sessionId.value,
      text,
      (event, data) => {
        void handleSseEvent(event, data);
      },
      activeSignal,
      String(turnCounter),
      toolBackendMode.value,
    );
  } catch (error) {
    if (activeSignal.aborted) {
      callState.value = "listening";
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to send debug message";
    callState.value = "error";
  }
}

async function connectCallLine(reopen = false): Promise<string | null> {
  utteranceAbort?.abort();
  utteranceAbort = new AbortController();
  const activeSignal = utteranceAbort.signal;
  acceptAudioSegments = true;
  greetingInProgress = true;
  openingPlaybackStarted = false;
  openingPlaybackFailed = false;
  callState.value = "connecting";
  liveAssistantId.value = null;

  let audioSegments = 0;

  const onStreamEvent = (event: SseEventName, data: Record<string, unknown>) => {
    if (event === "audio_segment") {
      audioSegments += 1;
    }
    if (event === "error") {
      errorMessage.value = String(data.message ?? "Call connection failed");
    }
    void handleSseEvent(event, data);
  };

  try {
    const nextSessionId = reopen && sessionId.value
      ? await reopenCall(sessionId.value, onStreamEvent, activeSignal)
      : await openCall(onStreamEvent, activeSignal);

    if (audioSegments === 0) {
      errorMessage.value = errorMessage.value ?? "No opening audio received from server";
      callState.value = "error";
      return null;
    }

    await playbackQueue.waitUntilIdle();
    setAgentListening();

    if (openingPlaybackFailed || !openingPlaybackStarted) {
      errorMessage.value =
        "Opening audio was blocked by the browser. Click the green button again or check autoplay settings.";
      callState.value = "error";
      return null;
    }

    return nextSessionId;
  } catch (error) {
    if (activeSignal.aborted) {
      return null;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to open call";
    callState.value = "error";
    return null;
  } finally {
    greetingInProgress = false;
    if (!activeSignal.aborted) {
      utteranceAbort = null;
    }
  }
}

async function startCall(): Promise<void> {
  errorMessage.value = null;
  clearSession();
  turnCounter = 0;

  unlockAudioPlayback();

  try {
    await recorder.acquireMicrophone();
    const [id, listeningOk] = await Promise.all([
      connectCallLine(),
      recorder.startListening(),
    ]);
    if (!id || errorMessage.value) {
      recorder.stop();
      return;
    }
    if (!listeningOk) {
      callState.value = "error";
      return;
    }
    sessionId.value = id;
    if (!["recording", "speaking", "thinking", "transcribing"].includes(callState.value)) {
      callState.value = "listening";
    }
  } catch (error) {
    recorder.stop();
    errorMessage.value = error instanceof Error ? error.message : "Failed to start call";
    callState.value = "error";
  }
}

async function interruptCall(): Promise<void> {
  await stopCallActivity();
  markInterrupted();
}

async function resetCall(): Promise<void> {
  const wasActive = callActive.value;

  playbackQueue.clear();
  utteranceAbort?.abort();
  utteranceAbort = null;

  resetExecution();
  errorMessage.value = null;

  if (wasActive) {
    unlockAudioPlayback();
    try {
      await recorder.acquireMicrophone();
      const [id, listeningOk] = await Promise.all([
        connectCallLine(Boolean(sessionId.value)),
        recorder.startListening(),
      ]);
      if (!id || errorMessage.value) {
        recorder.stop();
        sessionId.value = null;
        callState.value = "error";
        return;
      }
      if (!listeningOk) {
        callState.value = "error";
        return;
      }
      sessionId.value = id;
      if (!["recording", "speaking", "thinking", "transcribing"].includes(callState.value)) {
        callState.value = "listening";
      }
    } catch (error) {
      recorder.stop();
      errorMessage.value = error instanceof Error ? error.message : "Failed to reset call";
      sessionId.value = null;
      callState.value = "error";
    }
    return;
  }

  recorder.stop();
  sessionId.value = null;
  callState.value = "idle";
}

onBeforeUnmount(() => {
  playbackQueue.clear();
  utteranceAbort?.abort();
  recorder.stop();
});
</script>

<template>
  <div class="debug-mode">
    <div class="debug-label">debug</div>

    <div class="tool-backend-toggle">
      <div class="tool-backend-label">Customer tools</div>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: toolBackendMode === 'local' }"
        @click="setToolBackendMode('local')"
      >
        Local demo
      </button>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: toolBackendMode === 'mcp' }"
        @click="setToolBackendMode('mcp')"
      >
        MCP mock
      </button>
    </div>

    <div class="demo-credentials">
      <div class="demo-credentials-title">Demo credentials</div>
      <div
        v-for="customer in DEMO_CUSTOMERS"
        :key="customer.customerNumber"
        class="demo-credentials-block"
      >
        <div class="demo-credentials-row">
          <span class="demo-credentials-id">{{ customer.customerNumber }}</span>
          <span class="demo-credentials-sep">→</span>
          <span class="demo-credentials-pass">{{ customer.phonePassword }}</span>
        </div>
        <div class="demo-credentials-alt">
          alt: {{ customer.fullName }}, {{ customer.birthDate }}
        </div>
      </div>
    </div>

    <button
      v-for="message in debugMessages"
      :key="message"
      class="debug-chip"
      type="button"
      @click="submitDebugMessage(message)"
    >
      {{ message }}
    </button>
  </div>

  <div class="app-shell">
    <div class="app-layout">
      <PhoneFrame :session-id="sessionId">
        <StatusPill :state="callState" />
        <Waveform :state="callState" :level="audioLevel" />
        <CallControls
          :call-active="callActive"
          :can-interrupt="canStop"
          @start="startCall"
          @interrupt="interruptCall"
          @reset="resetCall"
        />
        <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
      </PhoneFrame>

      <BackgroundPanel
        :items="sessionLog"
        :execution="execution"
        :expanded-ids="expandedIds"
        :tool-backend-mode="toolBackendMode"
        @toggle-expand="toggleExpanded"
        @focus-tool="focusToolCall"
      />
    </div>
  </div>
</template>
