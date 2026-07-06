<script setup lang="ts">
import { VueFlow, type Edge, type Node } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import { computed, markRaw, provide } from "vue";
import type { ToolBackendMode } from "../api/client";
import type { ExecutionState, McpToolId, ToolNodeState } from "../types/orchestration";
import ArchNode, { type ArchNodeData } from "./graph/ArchNode.vue";

const props = defineProps<{
  execution: ExecutionState;
  toolBackendMode: ToolBackendMode;
}>();

const emit = defineEmits<{
  focusTool: [toolName: string];
}>();

provide("archFocusTool", (toolName: string) => {
  emit("focusTool", toolName);
});

const nodeTypes = { arch: markRaw(ArchNode) };

const mcpTools: { id: McpToolId; label: string }[] = [
  { id: "retrieve_information", label: "retrieve_information" },
  { id: "validate_customer", label: "validate_customer" },
  { id: "get_customer_information", label: "get_customer_information" },
];

const hostLabel = "MCP Server";

const IDLE_EDGE = "rgba(148, 163, 184, 0.62)";
const IDLE_EDGE_WIDTH = 2.5;

const TOP_ROW_Y = 8;
const BRANCH_ROW_Y = 100;

function toolIsLit(state: ToolNodeState): boolean {
  return state === "active" || state === "success" || state === "error";
}

const nodes = computed<Node<ArchNodeData>[]>(() => {
  const { execution } = props;
  const focusTool = execution.activeMcpTool;
  const hasToolFocus =
    focusTool !== null ||
    mcpTools.some((tool) => toolIsLit(execution.toolStates[tool.id]));

  return [
    {
      id: "caller",
      type: "arch",
      position: { x: 0, y: TOP_ROW_Y },
      data: {
        kind: "caller",
        label: "Caller",
        icon: "📱",
        active: execution.callerActive,
      },
    },
    {
      id: "middleware",
      type: "arch",
      position: { x: 92, y: TOP_ROW_Y },
      data: {
        kind: "middleware",
        label: "Middleware",
        icon: "🎧",
        active: execution.middlewareActive,
      },
    },
    {
      id: "agent",
      type: "arch",
      position: { x: 214, y: TOP_ROW_Y },
      data: {
        kind: "agent",
        label: "AI Agent",
        icon: "✦",
        active: execution.agentActive,
      },
    },
    {
      id: "waiting",
      type: "arch",
      position: { x: 368, y: TOP_ROW_Y },
      data: {
        kind: "waiting",
        label: "Waiting",
        icon: "⏳",
        active: execution.showWaiting,
        pulse: execution.showWaiting,
      },
    },
    {
      id: "mcp-host",
      type: "arch",
      position: { x: 16, y: BRANCH_ROW_Y },
      data: {
        kind: "mcp-host",
        label: hostLabel,
        hostLabel,
        active: execution.mcpHostActive,
        tools: mcpTools.map((tool) => {
          const state = execution.toolStates[tool.id];
          const isFocus = focusTool === tool.id;
          return {
            id: tool.id,
            label: tool.label,
            state,
            pulse: isFocus && state === "active",
            highlighted: isFocus && toolIsLit(state),
            dimmed: hasToolFocus && !isFocus,
          };
        }),
      },
    },
    {
      id: "emit",
      type: "arch",
      position: { x: 500, y: BRANCH_ROW_Y },
      data: {
        kind: "emit",
        label: "emit_output",
        sublabel: "→ TTS",
        icon: "🔊",
        active: execution.emitOutputActive,
        glow: execution.emitOutputActive,
      },
    },
  ];
});

function idleEdgeStyle(active: boolean, activeColor = "#60a5fa") {
  return {
    stroke: active ? activeColor : IDLE_EDGE,
    strokeWidth: active ? 2 : IDLE_EDGE_WIDTH,
  };
}

const edges = computed<Edge[]>(() => {
  const { execution } = props;
  return [
    {
      id: "caller-middleware",
      source: "caller",
      target: "middleware",
      sourceHandle: "out",
      targetHandle: "in",
      type: "straight",
      animated: execution.middlewareActive,
      style: idleEdgeStyle(execution.middlewareActive),
    },
    {
      id: "middleware-agent",
      source: "middleware",
      target: "agent",
      sourceHandle: "out",
      targetHandle: "in",
      type: "straight",
      animated: execution.agentActive,
      style: idleEdgeStyle(execution.agentActive),
    },
    {
      id: "agent-waiting",
      source: "agent",
      target: "waiting",
      sourceHandle: "out",
      targetHandle: "in",
      type: "straight",
      animated: execution.showWaiting,
      style: idleEdgeStyle(execution.showWaiting),
    },
    {
      id: "agent-mcp",
      source: "agent",
      target: "mcp-host",
      sourceHandle: "down-mcp",
      targetHandle: "in",
      type: "step",
      animated: execution.mcpHostActive,
      style: idleEdgeStyle(execution.mcpHostActive),
    },
    {
      id: "agent-emit",
      source: "agent",
      target: "emit",
      sourceHandle: "down-emit",
      targetHandle: "in",
      type: "step",
      animated: execution.emitOutputActive,
      style: idleEdgeStyle(
        execution.emitOutputActive,
        execution.emitOutputActive ? "#a78bfa" : IDLE_EDGE,
      ),
    },
  ];
});
</script>

<template>
  <div class="architecture-graph" :class="{ 'architecture-graph--paused': execution.paused }">
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :pan-on-drag="false"
      :zoom-on-scroll="false"
      :zoom-on-pinch="false"
      :zoom-on-double-click="false"
      :prevent-scrolling="true"
      :min-zoom="1"
      :max-zoom="1"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      class="arch-flow"
    />

    <div class="arch-legend">
      <span><i class="arch-dot arch-dot--active" /> active</span>
      <span><i class="arch-dot arch-dot--success" /> success</span>
      <span><i class="arch-dot arch-dot--error" /> error</span>
      <span><i class="arch-dot arch-dot--locked" /> locked</span>
    </div>
  </div>
</template>
