<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  createSession,
  interruptSession,
  openCall,
  reopenCall,
  sendDebugMessage,
  sendUtterance,
  type AgentPromptVariant,
  type SseEventName,
  type ToolBackendMode,
} from "./api/client";
import {
  createLiveSession,
  fetchLivePrompt,
  interruptLiveSession,
  resetLiveSession,
  type LiveAgentPromptVariant,
} from "./api/liveClient";
import { PlaybackQueue } from "./audio/playbackQueue";
import { RealtimeSession } from "./audio/realtimeSession";
import { unlockAudioPlayback } from "./audio/unlockAudio";
import { DEMO_CUSTOMERS, PRIMARY_DEMO_CUSTOMER } from "./demoCredentials";
import { UtteranceRecorder } from "./audio/recorder";
import AgentModeTabs from "./components/AgentModeTabs.vue";
import BackgroundPanel from "./components/BackgroundPanel.vue";
import CallControls from "./components/CallControls.vue";
import LiveBackgroundPanel from "./components/LiveBackgroundPanel.vue";
import PhoneFrame from "./components/PhoneFrame.vue";
import StatusPill from "./components/StatusPill.vue";
import Waveform from "./components/Waveform.vue";
import { useOrchestrationState } from "./composables/useOrchestrationState";

type AgentMode = "classic" | "live";

type ClassicCallState =
  | "idle"
  | "connecting"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

type LiveCallState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

const agentMode = ref<AgentMode>(
  (localStorage.getItem("agentMode") as AgentMode | null) ?? "classic",
);
const classicCallState = ref<ClassicCallState>("idle");
const liveCallState = ref<LiveCallState>("idle");
const sessionId = ref<string | null>(null);
const classicAudioLevel = ref(0);
const liveAudioLevel = ref(0);
const errorMessage = ref<string | null>(null);
const liveSystemPrompt = ref("");

const {
  sessionLog,
  execution,
  liveExecution,
  turnProfile,
  expandedIds,
  liveAssistantId,
  clearSession,
  resetExecution,
  setGraphIdle,
  setLiveGraphIdle,
  setLiveAgentActive,
  markInterrupted,
  setClientTurnTiming,
  setOutputPlaybackActive,
  onPlaybackEnded,
  toggleExpanded,
  focusToolCall,
  handleSseEvent: handleOrchestrationEvent,
  handleLiveEvent,
} = useOrchestrationState();

const toolBackendMode = ref<ToolBackendMode>(
  (localStorage.getItem("toolBackendMode") as ToolBackendMode | null) ?? "local",
);
const agentPromptVariant = ref<AgentPromptVariant>(
  (localStorage.getItem("agentPromptVariant") as AgentPromptVariant | null) ?? "default",
);
const liveAgentPromptVariant = ref<LiveAgentPromptVariant>(
  (localStorage.getItem("liveAgentPromptVariant") as LiveAgentPromptVariant | null) ?? "default",
);

let utteranceAbort: AbortController | null = null;
let turnCounter = 0;
let acceptAudioSegments = true;
let pendingUtterance: Blob | null = null;

const realtimeSession = new RealtimeSession();
realtimeSession.setCallbacks({
  onStateChange: (state) => {
    liveCallState.value = state;
    setLiveAgentActive(["connecting", "thinking", "speaking"].includes(state));
  },
  onAudioLevel: (level) => {
    liveAudioLevel.value = level;
  },
  onEvent: (event) => {
    if (event.type === "tool_call") {
      handleLiveEvent("tool_call", {
        toolCallId: String(event.toolCallId ?? ""),
        toolName: String(event.toolName ?? ""),
        arguments: (event.arguments as Record<string, unknown>) ?? {},
      });
      return;
    }
    if (event.type === "tool_result") {
      handleLiveEvent("tool_result", {
        toolCallId: String(event.toolCallId ?? ""),
        toolName: String(event.toolName ?? ""),
        status: event.status === "error" ? "error" : "success",
        result: event.result,
      });
      return;
    }
    if (event.type === "user_transcript") {
      handleLiveEvent("user_transcript", { text: String(event.text ?? "") });
      return;
    }
    if (event.type === "assistant_caption_delta") {
      handleLiveEvent("assistant_caption_delta", { delta: String(event.delta ?? "") });
      return;
    }
    if (event.type === "assistant_text_final") {
      handleLiveEvent("assistant_text_final", { text: String(event.text ?? "") });
    }
  },
  onError: (message) => {
    errorMessage.value = message;
    liveCallState.value = "error";
    setLiveAgentActive(false);
  },
});

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
    if (classicCallState.value !== "recording") {
      classicCallState.value = "speaking";
    }
  },
  onPlaybackError: () => {
    if (classicCallState.value === "connecting") {
      errorMessage.value =
        "Audio playback was blocked by the browser. Click the green button again or check autoplay settings.";
      classicCallState.value = "error";
    }
  },
  onQueueEmpty: () => {
    recorder.setPlaybackActive(false);
    onPlaybackEnded();
    if (["speaking", "thinking", "transcribing"].includes(classicCallState.value)) {
      classicCallState.value = "listening";
    }
  },
});

const recorder = new UtteranceRecorder({
  onSpeechStart: () => {
    const assistantAudioPlaying = playbackQueue.isActive();
    if (assistantAudioPlaying) {
      void handleClassicBargeIn();
      return;
    }
    classicCallState.value = "recording";
  },
  onSpeechEnd: (blob) => {
    void submitUtterance(blob);
  },
  onLevel: (rms) => {
    classicAudioLevel.value = rms;
  },
  onError: (message) => {
    errorMessage.value = message;
    classicCallState.value = "error";
  },
});

const displayCallState = computed(() =>
  agentMode.value === "live" ? liveCallState.value : classicCallState.value,
);
const displayAudioLevel = computed(() =>
  agentMode.value === "live" ? liveAudioLevel.value : classicAudioLevel.value,
);
const callActive = computed(() => displayCallState.value !== "idle");
const canStop = computed(() => callActive.value);
const canChangeLivePrompt = computed(() => liveCallState.value === "idle");
const phoneTitle = computed(() =>
  agentMode.value === "live" ? "OpenAI Live Assistant" : "Local Voice Assistant",
);

watch(agentMode, async (nextMode, previousMode) => {
  if (nextMode === previousMode) {
    return;
  }
  localStorage.setItem("agentMode", nextMode);
  errorMessage.value = null;
  if (previousMode === "classic") {
    await teardownClassic();
  } else {
    await teardownLive();
  }
  clearSession();
});

async function teardownClassic(): Promise<void> {
  acceptAudioSegments = false;
  playbackQueue.clear();
  recorder.setPlaybackActive(false);
  setOutputPlaybackActive(false);
  pendingUtterance = null;
  utteranceAbort?.abort();
  utteranceAbort = null;
  recorder.cancelActiveRecording();
  recorder.stop();
  if (sessionId.value && agentMode.value !== "classic") {
    try {
      await interruptSession(sessionId.value);
    } catch {
      // Ignore backend interrupt errors during tab switch.
    }
  }
  liveAssistantId.value = null;
  classicCallState.value = "idle";
  classicAudioLevel.value = 0;
  setGraphIdle();
}

async function teardownLive(): Promise<void> {
  if (sessionId.value && agentMode.value !== "live") {
    try {
      await interruptLiveSession(sessionId.value);
    } catch {
      // Ignore backend interrupt errors during tab switch.
    }
  }
  await realtimeSession.disconnect();
  liveCallState.value = "idle";
  liveAudioLevel.value = 0;
  setLiveGraphIdle();
}

async function handleClassicSseEvent(
  event: SseEventName,
  data: Record<string, unknown>,
): Promise<void> {
  switch (event) {
    case "status": {
      const state = String(data.state ?? "");
      if (state === "transcribing") classicCallState.value = "transcribing";
      if (state === "thinking") classicCallState.value = "thinking";
      if (state === "speaking") classicCallState.value = "speaking";
      if (state === "done") {
        classicCallState.value = playbackQueue.isActive() ? "speaking" : "listening";
      }
      if (state === "interrupted") classicCallState.value = "listening";
      if (state === "error") classicCallState.value = "error";
      break;
    }
    case "audio_segment":
      if (!acceptAudioSegments) {
        break;
      }
      setOutputPlaybackActive(true);
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

  if (event === "assistant_caption_delta" || event === "tool_call") {
    const toolName = event === "tool_call" ? String(data.toolName ?? "") : "";
    if (event === "assistant_caption_delta" || toolName === "emit_output") {
      setOutputPlaybackActive(true);
    }
  }

  handleOrchestrationEvent(event, data);
}

async function stopClassicCallActivity(): Promise<void> {
  acceptAudioSegments = false;
  playbackQueue.clear();
  recorder.setPlaybackActive(false);
  setOutputPlaybackActive(false);
  pendingUtterance = null;
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

  if (classicCallState.value === "idle") {
    return;
  }

  if (classicCallState.value === "listening" && !recorder.isRecording()) {
    recorder.stop();
    sessionId.value = null;
    classicCallState.value = "idle";
    setGraphIdle();
    return;
  }

  classicCallState.value = "listening";
}

async function handleClassicBargeIn(): Promise<void> {
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
  classicCallState.value = "recording";
}

function setToolBackendMode(mode: ToolBackendMode): void {
  toolBackendMode.value = mode;
  localStorage.setItem("toolBackendMode", mode);
}

function setAgentPromptVariant(variant: AgentPromptVariant): void {
  agentPromptVariant.value = variant;
  localStorage.setItem("agentPromptVariant", variant);
}

function setLiveAgentPromptVariant(variant: LiveAgentPromptVariant): void {
  if (!canChangeLivePrompt.value) {
    return;
  }
  liveAgentPromptVariant.value = variant;
  localStorage.setItem("liveAgentPromptVariant", variant);
}

function flushPendingUtterance(): void {
  if (!sessionId.value || !pendingUtterance) {
    return;
  }
  const blob = pendingUtterance;
  pendingUtterance = null;
  void submitUtterance(blob);
}

async function submitUtterance(blob: Blob): Promise<void> {
  if (!sessionId.value) {
    pendingUtterance = blob;
    return;
  }

  utteranceAbort?.abort();
  utteranceAbort = new AbortController();
  const activeSignal = utteranceAbort.signal;
  turnCounter += 1;
  acceptAudioSegments = true;
  classicCallState.value = "transcribing";
  liveAssistantId.value = null;

  try {
    await sendUtterance(
      sessionId.value,
      blob,
      (event, data) => {
        void handleClassicSseEvent(event, data);
      },
      activeSignal,
      String(turnCounter),
      toolBackendMode.value,
      (timing) => setClientTurnTiming(timing),
      agentPromptVariant.value,
    );
  } catch (error) {
    if (activeSignal.aborted) {
      classicCallState.value = "listening";
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to process utterance";
    classicCallState.value = "error";
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
  classicCallState.value = "thinking";

  try {
    await sendDebugMessage(
      sessionId.value,
      text,
      (event, data) => {
        void handleClassicSseEvent(event, data);
      },
      activeSignal,
      String(turnCounter),
      toolBackendMode.value,
      agentPromptVariant.value,
    );
  } catch (error) {
    if (activeSignal.aborted) {
      classicCallState.value = "listening";
      return;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to send debug message";
    classicCallState.value = "error";
  }
}

async function openClassicCallLine(reopen = false): Promise<string | null> {
  utteranceAbort?.abort();
  utteranceAbort = new AbortController();
  const activeSignal = utteranceAbort.signal;
  acceptAudioSegments = true;
  classicCallState.value = "connecting";
  liveAssistantId.value = null;

  let audioSegments = 0;

  const onStreamEvent = (event: SseEventName, data: Record<string, unknown>) => {
    if (event === "session" && data.sessionId) {
      sessionId.value = String(data.sessionId);
      flushPendingUtterance();
    }
    if (event === "audio_segment") {
      audioSegments += 1;
    }
    if (event === "error") {
      errorMessage.value = String(data.message ?? "Call connection failed");
    }
    void handleClassicSseEvent(event, data);
  };

  try {
    const nextSessionId =
      reopen && sessionId.value
        ? await reopenCall(sessionId.value, onStreamEvent, activeSignal)
        : await openCall(onStreamEvent, activeSignal);

    if (audioSegments === 0) {
      errorMessage.value = errorMessage.value ?? "No opening audio received from server";
      classicCallState.value = "error";
      return null;
    }

    sessionId.value = nextSessionId;
    flushPendingUtterance();
    return nextSessionId;
  } catch (error) {
    if (activeSignal.aborted) {
      return sessionId.value;
    }
    errorMessage.value = error instanceof Error ? error.message : "Failed to open call";
    classicCallState.value = "error";
    return null;
  } finally {
    if (!activeSignal.aborted) {
      utteranceAbort = null;
    }
  }
}

async function startClassicCall(): Promise<void> {
  errorMessage.value = null;
  pendingUtterance = null;
  clearSession();
  turnCounter = 0;
  unlockAudioPlayback();

  try {
    await recorder.acquireMicrophone();
    const [id, listeningOk] = await Promise.all([
      openClassicCallLine(),
      recorder.startListening(),
    ]);
    if (!listeningOk) {
      classicCallState.value = "error";
      return;
    }
    if (!id && !sessionId.value) {
      recorder.stop();
      return;
    }
    sessionId.value = id ?? sessionId.value;
    flushPendingUtterance();
    if (!["recording", "speaking", "thinking", "transcribing"].includes(classicCallState.value)) {
      classicCallState.value = "listening";
    }
  } catch (error) {
    recorder.stop();
    errorMessage.value = error instanceof Error ? error.message : "Failed to start call";
    classicCallState.value = "error";
  }
}

async function interruptClassicCall(): Promise<void> {
  await stopClassicCallActivity();
  markInterrupted();
}

async function resetClassicCall(): Promise<void> {
  const wasActive = classicCallState.value !== "idle";

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
        openClassicCallLine(Boolean(sessionId.value)),
        recorder.startListening(),
      ]);
      if (!listeningOk) {
        classicCallState.value = "error";
        return;
      }
      if (!id && !sessionId.value) {
        recorder.stop();
        sessionId.value = null;
        classicCallState.value = "error";
        return;
      }
      sessionId.value = id ?? sessionId.value;
      flushPendingUtterance();
      if (!["recording", "speaking", "thinking", "transcribing"].includes(classicCallState.value)) {
        classicCallState.value = "listening";
      }
    } catch (error) {
      recorder.stop();
      errorMessage.value = error instanceof Error ? error.message : "Failed to reset call";
      sessionId.value = null;
      classicCallState.value = "error";
    }
    return;
  }

  recorder.stop();
  sessionId.value = null;
  classicCallState.value = "idle";
}

async function startLiveCall(): Promise<void> {
  errorMessage.value = null;
  clearSession();
  liveCallState.value = "connecting";
  unlockAudioPlayback();

  try {
    const sessionInfo = await createLiveSession(
      toolBackendMode.value,
      liveAgentPromptVariant.value,
    );
    sessionId.value = sessionInfo.sessionId;
    liveSystemPrompt.value = sessionInfo.systemPrompt;
    await realtimeSession.connect(
      sessionInfo.sessionId,
      toolBackendMode.value,
      liveAgentPromptVariant.value,
      sessionInfo.openingGreeting,
    );
    liveCallState.value = "listening";
  } catch (error) {
    await realtimeSession.disconnect();
    sessionId.value = null;
    errorMessage.value = error instanceof Error ? error.message : "Failed to start Live call";
    liveCallState.value = "error";
  }
}

async function interruptLiveCall(): Promise<void> {
  errorMessage.value = null;
  realtimeSession.interrupt();
  if (sessionId.value) {
    try {
      await interruptLiveSession(sessionId.value);
    } catch {
      // Keep local interrupt flow even if backend call fails.
    }
  }
  await realtimeSession.disconnect();
  sessionId.value = null;
  liveCallState.value = "idle";
  setLiveGraphIdle();
}

async function resetLiveCall(): Promise<void> {
  const wasActive = liveCallState.value !== "idle";
  errorMessage.value = null;
  resetExecution();
  await realtimeSession.disconnect();

  if (!wasActive) {
    sessionId.value = null;
    liveCallState.value = "idle";
    return;
  }

  try {
    const nextSessionId = sessionId.value
      ? await resetLiveSession(
          sessionId.value,
          toolBackendMode.value,
          liveAgentPromptVariant.value,
        )
      : (
          await createLiveSession(toolBackendMode.value, liveAgentPromptVariant.value)
        ).sessionId;

    const promptInfo = await fetchLivePrompt(nextSessionId);
    sessionId.value = nextSessionId;
    liveSystemPrompt.value = promptInfo.systemPrompt;
    await realtimeSession.connect(
      nextSessionId,
      toolBackendMode.value,
      liveAgentPromptVariant.value,
      promptInfo.openingGreeting,
    );
    liveCallState.value = "listening";
  } catch (error) {
    sessionId.value = null;
    errorMessage.value = error instanceof Error ? error.message : "Failed to reset Live call";
    liveCallState.value = "error";
  }
}

async function handleStartCall(): Promise<void> {
  if (agentMode.value === "live") {
    await startLiveCall();
    return;
  }
  await startClassicCall();
}

async function handleInterruptCall(): Promise<void> {
  if (agentMode.value === "live") {
    await interruptLiveCall();
    return;
  }
  await interruptClassicCall();
}

async function handleResetCall(): Promise<void> {
  if (agentMode.value === "live") {
    await resetLiveCall();
    return;
  }
  await resetClassicCall();
}

onBeforeUnmount(async () => {
  playbackQueue.clear();
  utteranceAbort?.abort();
  recorder.stop();
  await realtimeSession.disconnect();
});
</script>

<template>
  <div v-if="agentMode === 'classic'" class="debug-mode">
    <div class="debug-label">debug</div>

    <div class="tool-backend-toggle">
      <div class="tool-backend-label">A/B testing</div>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: agentPromptVariant === 'default' }"
        @click="setAgentPromptVariant('default')"
      >
        Prompt A
      </button>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: agentPromptVariant === 'latency_ux' }"
        @click="setAgentPromptVariant('latency_ux')"
      >
        Prompt B
      </button>
    </div>

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

  <div v-else class="debug-mode live-debug-mode">
    <div class="debug-label">live debug</div>

    <div class="tool-backend-toggle">
      <div class="tool-backend-label">A/B testing</div>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: liveAgentPromptVariant === 'default', disabled: !canChangeLivePrompt }"
        :disabled="!canChangeLivePrompt"
        @click="setLiveAgentPromptVariant('default')"
      >
        Prompt A
      </button>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: liveAgentPromptVariant === 'latency_ux', disabled: !canChangeLivePrompt }"
        :disabled="!canChangeLivePrompt"
        @click="setLiveAgentPromptVariant('latency_ux')"
      >
        Prompt B
      </button>
    </div>

    <div class="tool-backend-toggle">
      <div class="tool-backend-label">Customer tools</div>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: toolBackendMode === 'local', disabled: !canChangeLivePrompt }"
        :disabled="!canChangeLivePrompt"
        @click="setToolBackendMode('local')"
      >
        Local demo
      </button>
      <button
        type="button"
        class="tool-backend-btn"
        :class="{ active: toolBackendMode === 'mcp', disabled: !canChangeLivePrompt }"
        :disabled="!canChangeLivePrompt"
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
  </div>

  <div class="app-shell">
    <AgentModeTabs v-model="agentMode" />

    <div class="app-layout">
      <PhoneFrame :session-id="sessionId" :title="phoneTitle">
        <StatusPill :state="displayCallState" />
        <Waveform :state="displayCallState" :level="displayAudioLevel" />
        <CallControls
          :call-active="callActive"
          :can-interrupt="canStop"
          @start="handleStartCall"
          @interrupt="handleInterruptCall"
          @reset="handleResetCall"
        />
        <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
      </PhoneFrame>

      <BackgroundPanel
        v-if="agentMode === 'classic'"
        :items="sessionLog"
        :execution="execution"
        :turn-profile="turnProfile"
        :expanded-ids="expandedIds"
        :tool-backend-mode="toolBackendMode"
        :agent-prompt-variant="agentPromptVariant"
        @toggle-expand="toggleExpanded"
        @focus-tool="focusToolCall"
      />

      <LiveBackgroundPanel
        v-else
        :items="sessionLog"
        :execution="liveExecution"
        :expanded-ids="expandedIds"
        :tool-backend-mode="toolBackendMode"
        :live-agent-prompt-variant="liveAgentPromptVariant"
        :system-prompt="liveSystemPrompt"
        @toggle-expand="toggleExpanded"
        @focus-tool="focusToolCall"
      />
    </div>
  </div>
</template>
