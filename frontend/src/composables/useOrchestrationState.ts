import { ref } from "vue";
import type { SseEventName } from "../api/client";
import {
  createIdleExecution,
  createIdleLiveExecution,
  type ExecutionState,
  type LiveExecutionState,
  type McpToolId,
  type TimelineItem,
  type ToolNodeState,
} from "../types/orchestration";
import type { TurnProfile, TurnProfileBucket, TurnProfileSpan, ClientTurnTiming } from "../types/turnProfile";
import { mergeClientTurnTiming } from "../types/turnProfile";

const MCP_TOOLS = new Set<McpToolId>([
  "retrieve_information",
  "validate_customer",
  "get_customer_information",
]);

const TOOL_STATUS_HOLD_MS = 1000;

const AGENT_WORK_PHASES: ExecutionState["phase"][] = [
  "thinking",
  "waiting_mcp",
  "waiting_tool",
  "speaking",
];

function isMcpTool(name: string): name is McpToolId {
  return MCP_TOOLS.has(name as McpToolId);
}

function isEmitOutput(name: string): boolean {
  return name === "emit_output";
}

function refreshToolLocks(state: ExecutionState): void {
  state.toolStates.get_customer_information = state.customerValidated ? "idle" : "locked";
}

function idleToolState(state: ExecutionState, toolId: McpToolId): ToolNodeState {
  return toolId === "get_customer_information" && !state.customerValidated ? "locked" : "idle";
}

function refreshLiveToolLocks(state: LiveExecutionState): void {
  state.toolStates.get_customer_information = state.customerValidated ? "idle" : "locked";
}

function idleLiveToolState(state: LiveExecutionState, toolId: McpToolId): ToolNodeState {
  return toolId === "get_customer_information" && !state.customerValidated ? "locked" : "idle";
}

function syncLiveMcpHostActive(state: LiveExecutionState): void {
  const toolLit = [...MCP_TOOLS].some((id) => {
    const s = state.toolStates[id];
    return s === "active" || s === "success" || s === "error";
  });
  state.mcpHostActive = toolLit;
}

function syncMcpHostActive(state: ExecutionState): void {
  const toolLit = [...MCP_TOOLS].some((id) => {
    const s = state.toolStates[id];
    return s === "active" || s === "success" || s === "error";
  });
  state.mcpHostActive = toolLit || state.phase === "waiting_mcp";
}

function syncNodeHighlights(state: ExecutionState): void {
  const inactivePhase =
    state.paused ||
    state.phase === "idle" ||
    state.phase === "interrupted" ||
    state.phase === "error";

  if (inactivePhase) {
    state.callerActive = false;
    state.middlewareActive = false;
    state.agentActive = false;
    return;
  }

  const transcribing = state.phase === "transcribing";
  state.callerActive = transcribing;
  state.middlewareActive = transcribing;
  state.agentActive =
    !state.showWaiting &&
    (AGENT_WORK_PHASES.includes(state.phase) || state.emitOutputActive);
}

function syncAgentWaiting(state: ExecutionState): void {
  const turnInProgress =
    state.emitOutputActive ||
    state.phase === "transcribing" ||
    AGENT_WORK_PHASES.includes(state.phase);
  state.showWaiting = !state.paused && state.phase === "done" && !turnInProgress;
  syncNodeHighlights(state);
}

function setPhase(state: ExecutionState, phase: ExecutionState["phase"], waitingLabel = ""): void {
  state.phase = phase;
  state.waitingLabel = waitingLabel;
  syncMcpHostActive(state);
  syncAgentWaiting(state);
}

function parseTurnProfile(data: Record<string, unknown>): TurnProfile {
  const buckets = Array.isArray(data.buckets)
    ? (data.buckets as Record<string, unknown>[]).map((bucket) => ({
        key: String(bucket.key ?? "agent") as TurnProfileBucket["key"],
        label: String(bucket.label ?? bucket.key ?? "Step"),
        ms: Number(bucket.ms ?? 0),
      }))
    : [];

  const spans = Array.isArray(data.spans)
    ? (data.spans as Record<string, unknown>[]).map((span) => ({
        id: String(span.id ?? ""),
        kind: String(span.kind ?? "agent_llm") as TurnProfileSpan["kind"],
        label: String(span.label ?? "Step"),
        ms: Number(span.ms ?? 0),
        detail: span.detail ? String(span.detail) : undefined,
      }))
    : [];

  const firstResponseRaw = data.firstResponse as Record<string, unknown> | undefined;

  return {
    turnId: Number(data.turnId ?? 0),
    totalMs: Number(data.totalMs ?? 0),
    buckets,
    spans,
    firstResponse: firstResponseRaw
      ? {
          captionMs:
            firstResponseRaw.captionMs === null || firstResponseRaw.captionMs === undefined
              ? null
              : Number(firstResponseRaw.captionMs),
          audioMs:
            firstResponseRaw.audioMs === null || firstResponseRaw.audioMs === undefined
              ? null
              : Number(firstResponseRaw.audioMs),
          captionPreview: firstResponseRaw.captionPreview
            ? String(firstResponseRaw.captionPreview)
            : undefined,
        }
      : undefined,
  };
}

export function useOrchestrationState() {
  const sessionLog = ref<TimelineItem[]>([]);
  const execution = ref<ExecutionState>(createIdleExecution());
  const liveExecution = ref<LiveExecutionState>(createIdleLiveExecution());
  const turnProfile = ref<TurnProfile | null>(null);
  const expandedIds = ref<Set<string>>(new Set());
  const liveAssistantId = ref<string | null>(null);
  let pendingClientTurnTiming: ClientTurnTiming | null = null;
  let toolStatusTimer: ReturnType<typeof window.setTimeout> | null = null;
  let liveToolStatusTimer: ReturnType<typeof window.setTimeout> | null = null;

  function clearLiveToolStatusTimer(): void {
    if (liveToolStatusTimer !== null) {
      window.clearTimeout(liveToolStatusTimer);
      liveToolStatusTimer = null;
    }
  }

  function scheduleLiveToolStatusHold(): void {
    clearLiveToolStatusTimer();
    liveToolStatusTimer = window.setTimeout(() => {
      const state = liveExecution.value;
      for (const toolId of MCP_TOOLS) {
        const current = state.toolStates[toolId];
        if (current === "success" || current === "error") {
          state.toolStates[toolId] = idleLiveToolState(state, toolId);
        }
      }
      if (state.activeMcpTool && state.toolStates[state.activeMcpTool] !== "active") {
        state.activeMcpTool = null;
      }
      syncLiveMcpHostActive(state);
      liveToolStatusTimer = null;
    }, TOOL_STATUS_HOLD_MS);
  }

  function clearToolStatusTimer(): void {
    if (toolStatusTimer !== null) {
      window.clearTimeout(toolStatusTimer);
      toolStatusTimer = null;
    }
  }

  function scheduleToolStatusHold(): void {
    clearToolStatusTimer();
    toolStatusTimer = window.setTimeout(() => {
      const state = execution.value;
      for (const toolId of MCP_TOOLS) {
        const current = state.toolStates[toolId];
        if (current === "success" || current === "error") {
          state.toolStates[toolId] = idleToolState(state, toolId);
        }
      }
      if (
        state.activeMcpTool &&
        state.toolStates[state.activeMcpTool] !== "active"
      ) {
        state.activeMcpTool = null;
      }
      syncMcpHostActive(state);
      toolStatusTimer = null;
    }, TOOL_STATUS_HOLD_MS);
  }

  function addLogItem(item: Omit<TimelineItem, "id">): string {
    const id = crypto.randomUUID();
    sessionLog.value.push({ id, ...item });
    return id;
  }

  function setClientTurnTiming(timing: ClientTurnTiming | null): void {
    pendingClientTurnTiming = timing;
  }

  function clearSession(): void {
    clearToolStatusTimer();
    clearLiveToolStatusTimer();
    sessionLog.value = [];
    turnProfile.value = null;
    pendingClientTurnTiming = null;
    expandedIds.value = new Set();
    liveAssistantId.value = null;
    execution.value = createIdleExecution();
    liveExecution.value = createIdleLiveExecution();
  }

  function resetExecution(): void {
    clearToolStatusTimer();
    clearLiveToolStatusTimer();
    liveAssistantId.value = null;
    turnProfile.value = null;
    pendingClientTurnTiming = null;
    execution.value = createIdleExecution();
    liveExecution.value = createIdleLiveExecution();
  }

  function setGraphIdle(): void {
    clearToolStatusTimer();
    const state = execution.value;
    state.phase = "idle";
    state.paused = false;
    state.waitingLabel = "";
    state.showWaiting = false;
    state.emitOutputActive = false;
    state.mcpHostActive = false;
    state.activeMcpTool = null;
    for (const toolId of MCP_TOOLS) {
      state.toolStates[toolId] = idleToolState(state, toolId);
    }
    syncNodeHighlights(state);
  }

  function setLiveGraphIdle(): void {
    clearLiveToolStatusTimer();
    liveExecution.value = createIdleLiveExecution();
  }

  function setLiveAgentActive(active: boolean): void {
    const state = liveExecution.value;
    if (state.paused) {
      return;
    }
    state.agentActive = active || state.mcpHostActive;
  }

  function markLiveInterrupted(): void {
    clearLiveToolStatusTimer();
    const state = liveExecution.value;
    state.paused = true;
    state.agentActive = false;
    state.mcpHostActive = false;
    state.activeMcpTool = null;
  }

  function resumeLiveAfterInterrupt(): void {
    const state = liveExecution.value;
    state.paused = false;
    state.agentActive = true;
  }

  function onLiveToolCall(toolName: string, toolCallId: string): void {
    const state = liveExecution.value;
    state.paused = false;
    state.focusToolCallId = toolCallId;
    state.agentActive = true;

    if (isMcpTool(toolName)) {
      state.activeMcpTool = toolName;
      for (const key of MCP_TOOLS) {
        if (key === toolName) {
          state.toolStates[key] = "active";
        } else if (state.toolStates[key] !== "success") {
          state.toolStates[key] = idleLiveToolState(state, key);
        }
      }
      syncLiveMcpHostActive(state);
    }
  }

  function onLiveToolResult(
    toolName: string,
    status: "success" | "error",
    result: unknown,
  ): void {
    const state = liveExecution.value;

    if (isMcpTool(toolName)) {
      state.toolStates[toolName] = status === "error" ? "error" : "success";
      state.activeMcpTool = toolName;

      if (
        toolName === "validate_customer" &&
        status === "success" &&
        result &&
        typeof result === "object" &&
        (result as { valid?: boolean }).valid
      ) {
        state.customerValidated = true;
        refreshLiveToolLocks(state);
      }

      syncLiveMcpHostActive(state);
      scheduleLiveToolStatusHold();
    }
  }

  function setOutputPlaybackActive(active: boolean): void {
    execution.value.emitOutputActive = active;
    syncAgentWaiting(execution.value);
  }

  function onPlaybackEnded(): void {
    const state = execution.value;
    state.emitOutputActive = false;
    if (
      !state.paused &&
      (state.phase === "done" || state.phase === "speaking")
    ) {
      state.phase = "done";
      state.waitingLabel = "Listening…";
    }
    syncAgentWaiting(state);
  }

  function setAgentListening(): void {
    onPlaybackEnded();
  }

  function markInterrupted(): void {
    clearToolStatusTimer();
    const state = execution.value;
    state.paused = true;
    state.showWaiting = false;
    state.emitOutputActive = false;
    state.mcpHostActive = false;
    state.activeMcpTool = null;
    state.phase = "interrupted";
    syncAgentWaiting(state);
    if (liveAssistantId.value) {
      const message = sessionLog.value.find((item) => item.id === liveAssistantId.value);
      if (message) {
        message.live = false;
      }
      liveAssistantId.value = null;
    }
  }

  function toggleExpanded(id: string): void {
    const next = new Set(expandedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedIds.value = next;
  }

  function focusToolCall(toolCallId: string): void {
    execution.value.focusToolCallId = toolCallId;
  }

  function appendLiveAssistant(delta: string): void {
    if (!liveAssistantId.value) {
      liveAssistantId.value = addLogItem({
        kind: "assistant",
        text: delta,
        live: true,
      });
      return;
    }
    const message = sessionLog.value.find((item) => item.id === liveAssistantId.value);
    if (message) {
      message.text += delta;
    }
  }

  function finalizeLiveAssistant(finalText: string): void {
    if (liveAssistantId.value) {
      const message = sessionLog.value.find((item) => item.id === liveAssistantId.value);
      if (message) {
        message.text = finalText;
        message.live = false;
      }
      liveAssistantId.value = null;
      return;
    }
    if (finalText.trim()) {
      addLogItem({ kind: "assistant", text: finalText });
    }
  }

  function onToolCall(toolName: string, toolCallId: string): void {
    const state = execution.value;
    state.paused = false;
    state.focusToolCallId = toolCallId;

    if (isEmitOutput(toolName)) {
      state.emitOutputActive = true;
      setPhase(state, "speaking", "Speaking…");
      state.activeMcpTool = null;
      syncNodeHighlights(state);
      return;
    }

    if (isMcpTool(toolName)) {
      setPhase(state, "waiting_mcp", `MCP: ${toolName}…`);
      state.activeMcpTool = toolName;
      for (const key of MCP_TOOLS) {
        if (key === toolName) {
          state.toolStates[key] = "active";
        } else if (state.toolStates[key] !== "success") {
          state.toolStates[key] = idleToolState(state, key);
        }
      }
      syncMcpHostActive(state);
      return;
    }

    setPhase(state, "waiting_tool", `Calling ${toolName}…`);
  }

  function onToolResult(
    toolName: string,
    status: "success" | "error",
    result: unknown,
  ): void {
    const state = execution.value;

    if (isEmitOutput(toolName)) {
      state.emitOutputActive = true;
      syncNodeHighlights(state);
      return;
    }

    if (isMcpTool(toolName)) {
      state.toolStates[toolName] = status === "error" ? "error" : "success";
      state.activeMcpTool = toolName;

      if (
        toolName === "validate_customer" &&
        status === "success" &&
        result &&
        typeof result === "object" &&
        (result as { valid?: boolean }).valid
      ) {
        state.customerValidated = true;
        refreshToolLocks(state);
      }

      setPhase(state, "thinking", "Agent deciding…");
      syncMcpHostActive(state);
      scheduleToolStatusHold();
      return;
    }

    setPhase(state, "thinking", "Agent deciding…");
  }

  function handleSseEvent(event: SseEventName, data: Record<string, unknown>): string | null {
    const state = execution.value;

    switch (event) {
      case "status": {
        const status = String(data.state ?? "");
        if (status === "transcribing") {
          state.paused = false;
          setPhase(state, "transcribing", "Transcribing…");
        }
        if (status === "thinking") {
          state.paused = false;
          setPhase(state, "thinking", "Agent deciding…");
        }
        if (status === "speaking") {
          setPhase(state, "speaking", "Speaking…");
          state.emitOutputActive = true;
          syncNodeHighlights(state);
        }
        if (status === "done") {
          setPhase(state, "done", "Listening…");
          state.mcpHostActive = false;
          state.activeMcpTool = null;
          syncAgentWaiting(state);
        }
        if (status === "interrupted") {
          markInterrupted();
        }
        if (status === "error") {
          state.phase = "error";
          state.paused = true;
          state.showWaiting = false;
          syncNodeHighlights(state);
        }
        return null;
      }
      case "user_transcript":
        addLogItem({ kind: "user", text: String(data.text ?? "") });
        return null;
      case "assistant_caption_delta":
        state.emitOutputActive = true;
        syncNodeHighlights(state);
        appendLiveAssistant(String(data.delta ?? ""));
        return null;
      case "assistant_text_final":
        finalizeLiveAssistant(String(data.text ?? ""));
        return null;
      case "agent_trace":
        addLogItem({ kind: "agent_trace", text: String(data.text ?? "") });
        return null;
      case "tool_call": {
        const toolName = String(data.toolName ?? "tool");
        const toolCallId = String(data.toolCallId ?? "");
        onToolCall(toolName, toolCallId);
        addLogItem({
          kind: "tool_call",
          text: `Tool call: ${toolName}`,
          toolCallId,
          toolName,
          arguments: (data.arguments as Record<string, unknown>) ?? {},
          status: "running",
        });
        return toolCallId;
      }
      case "tool_result": {
        const toolName = String(data.toolName ?? "tool");
        const toolCallId = String(data.toolCallId ?? "");
        const status = data.status === "error" ? "error" : "success";
        onToolResult(toolName, status, data.result);
        addLogItem({
          kind: "tool_result",
          text: `Tool result: ${toolName}`,
          toolCallId,
          toolName,
          result: data.result,
          status,
        });
        return toolCallId;
      }
      case "turn_profile":
        turnProfile.value = mergeClientTurnTiming(
          parseTurnProfile(data),
          pendingClientTurnTiming,
        );
        pendingClientTurnTiming = null;
        return null;
      case "error": {
        const message = String(data.message ?? "Unexpected error");
        addLogItem({ kind: "error", text: message });
        state.phase = "error";
        state.paused = true;
        state.showWaiting = false;
        syncNodeHighlights(state);
        return message;
      }
      default:
        return null;
    }
  }

  function handleLiveEvent(eventType: string, data: Record<string, unknown>): string | null {
    switch (eventType) {
      case "user_transcript":
        addLogItem({ kind: "user", text: String(data.text ?? "") });
        return null;
      case "assistant_caption_delta":
        appendLiveAssistant(String(data.delta ?? ""));
        return null;
      case "assistant_text_final":
        finalizeLiveAssistant(String(data.text ?? ""));
        return null;
      case "tool_call": {
        const toolName = String(data.toolName ?? "tool");
        const toolCallId = String(data.toolCallId ?? "");
        onLiveToolCall(toolName, toolCallId);
        addLogItem({
          kind: "tool_call",
          text: `Tool call: ${toolName}`,
          toolCallId,
          toolName,
          arguments: (data.arguments as Record<string, unknown>) ?? {},
          status: "running",
        });
        return toolCallId;
      }
      case "tool_result": {
        const toolName = String(data.toolName ?? "tool");
        const toolCallId = String(data.toolCallId ?? "");
        const status = data.status === "error" ? "error" : "success";
        onLiveToolResult(toolName, status, data.result);
        addLogItem({
          kind: "tool_result",
          text: `Tool result: ${toolName}`,
          toolCallId,
          toolName,
          result: data.result,
          status,
        });
        return toolCallId;
      }
      case "error": {
        const message = String(data.message ?? "Unexpected error");
        addLogItem({ kind: "error", text: message });
        return message;
      }
      default:
        return null;
    }
  }

  return {
    sessionLog,
    execution,
    liveExecution,
    turnProfile,
    setClientTurnTiming,
    expandedIds,
    liveAssistantId,
    addLogItem,
    clearSession,
    resetExecution,
    setGraphIdle,
    setLiveGraphIdle,
    setLiveAgentActive,
    markLiveInterrupted,
    resumeLiveAfterInterrupt,
    markInterrupted,
    setOutputPlaybackActive,
    onPlaybackEnded,
    setAgentListening,
    toggleExpanded,
    focusToolCall,
    handleSseEvent,
    handleLiveEvent,
    appendLiveAssistant,
    finalizeLiveAssistant,
  };
}
