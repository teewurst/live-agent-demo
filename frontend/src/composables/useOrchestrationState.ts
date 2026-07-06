import { ref } from "vue";
import type { SseEventName } from "../api/client";
import {
  createIdleExecution,
  type ExecutionState,
  type McpToolId,
  type TimelineItem,
  type ToolNodeState,
} from "../types/orchestration";

const MCP_TOOLS = new Set<McpToolId>([
  "retrieve_information",
  "validate_customer",
  "get_customer_information",
]);

const TOOL_STATUS_HOLD_MS = 1000;

const AGENT_BUSY_PHASES: ExecutionState["phase"][] = [
  "transcribing",
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

function syncMcpHostActive(state: ExecutionState): void {
  const toolLit = [...MCP_TOOLS].some((id) => {
    const s = state.toolStates[id];
    return s === "active" || s === "success" || s === "error";
  });
  state.mcpHostActive = toolLit || state.phase === "waiting_mcp";
}

function syncAgentWaiting(state: ExecutionState): void {
  const agentBusy =
    state.emitOutputActive || AGENT_BUSY_PHASES.includes(state.phase);
  state.showWaiting = !state.paused && state.phase === "done" && !agentBusy;
}

function setPhase(state: ExecutionState, phase: ExecutionState["phase"], waitingLabel = ""): void {
  state.phase = phase;
  state.waitingLabel = waitingLabel;
  state.callerActive = phase === "transcribing";
  state.middlewareActive = !state.paused && phase !== "idle";
  state.agentActive = ["thinking", "waiting_mcp", "waiting_tool", "speaking"].includes(phase);
  syncMcpHostActive(state);
  syncAgentWaiting(state);
}

export function useOrchestrationState() {
  const sessionLog = ref<TimelineItem[]>([]);
  const execution = ref<ExecutionState>(createIdleExecution());
  const expandedIds = ref<Set<string>>(new Set());
  const liveAssistantId = ref<string | null>(null);
  let toolStatusTimer: ReturnType<typeof window.setTimeout> | null = null;

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

  function clearSession(): void {
    clearToolStatusTimer();
    sessionLog.value = [];
    expandedIds.value = new Set();
    liveAssistantId.value = null;
    execution.value = createIdleExecution();
  }

  function resetExecution(): void {
    clearToolStatusTimer();
    liveAssistantId.value = null;
    execution.value = createIdleExecution();
  }

  function setOutputPlaybackActive(active: boolean): void {
    execution.value.emitOutputActive = active;
    syncAgentWaiting(execution.value);
  }

  function setAgentListening(): void {
    const state = execution.value;
    if (state.paused) {
      return;
    }
    if (AGENT_BUSY_PHASES.includes(state.phase)) {
      return;
    }
    state.phase = "done";
    state.waitingLabel = "Listening…";
    state.agentActive = false;
    syncAgentWaiting(state);
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
      setPhase(state, "speaking", "Speaking…");
      state.activeMcpTool = null;
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
      if (!state.emitOutputActive) {
        setPhase(state, "thinking", "Agent deciding…");
      }
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
        }
        return null;
      }
      case "user_transcript":
        addLogItem({ kind: "user", text: String(data.text ?? "") });
        return null;
      case "assistant_caption_delta":
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
      case "error": {
        const message = String(data.message ?? "Unexpected error");
        addLogItem({ kind: "error", text: message });
        state.phase = "error";
        state.paused = true;
        state.showWaiting = false;
        return message;
      }
      default:
        return null;
    }
  }

  return {
    sessionLog,
    execution,
    expandedIds,
    liveAssistantId,
    addLogItem,
    clearSession,
    resetExecution,
    markInterrupted,
    setOutputPlaybackActive,
    setAgentListening,
    toggleExpanded,
    focusToolCall,
    handleSseEvent,
    appendLiveAssistant,
    finalizeLiveAssistant,
  };
}
