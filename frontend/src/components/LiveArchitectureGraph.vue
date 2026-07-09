<script setup lang="ts">
import { VueFlow, type Edge, type Node } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import { computed, markRaw, provide } from "vue";
import type { ToolBackendMode } from "../api/liveClient";
import {
  createIdleExecution,
  type LiveExecutionState,
  type McpToolId,
  type ToolNodeState,
} from "../types/orchestration";
import ArchNode, { type ArchNodeData } from "./graph/ArchNode.vue";

const props = defineProps<{
  execution: LiveExecutionState;
  toolBackendMode: ToolBackendMode;
}>();

const emit = defineEmits<{
  focusTool: [toolName: string];
}>();

const archExecutionAdapter = computed(() => {
  const live = props.execution;
  return {
    ...createIdleExecution(),
    agentActive: live.agentActive,
    mcpHostActive: live.mcpHostActive,
    activeMcpTool: live.activeMcpTool,
    toolStates: live.toolStates,
    customerValidated: live.customerValidated,
    paused: live.paused,
    focusToolCallId: live.focusToolCallId,
  };
});

provide("archFocusTool", (toolName: string) => {
  emit("focusTool", toolName);
});

provide("archExecution", archExecutionAdapter);

const nodeTypes = { arch: markRaw(ArchNode) };

const mcpTools: { id: McpToolId; label: string }[] = [
  { id: "retrieve_information", label: "retrieve_information" },
  { id: "validate_customer", label: "validate_customer" },
  { id: "get_customer_information", label: "get_customer_information" },
];

const hostLabel = computed(() =>
  props.toolBackendMode === "mcp" ? "MCP Server" : "Local tools",
);

const IDLE_EDGE = "rgba(148, 163, 184, 0.62)";
const IDLE_EDGE_WIDTH = 2.5;

const AGENT_Y = 8;
const TOOLS_Y = 100;

function toolIsLit(state: ToolNodeState): boolean {
  return state === "active" || state === "success" || state === "error";
}

const nodes = computed<Node<ArchNodeData>[]>(() => {
  const { execution } = props;
  const focusTool = execution.activeMcpTool;
  const hasToolFocus =
    focusTool !== null || mcpTools.some((tool) => toolIsLit(execution.toolStates[tool.id]));

  return [
    {
      id: "agent",
      type: "arch",
      position: { x: 120, y: AGENT_Y },
      data: {
        kind: "agent",
        label: "AI Agent",
        icon: "✦",
        active: execution.agentActive,
      },
    },
    {
      id: "mcp-host",
      type: "arch",
      position: { x: 16, y: TOOLS_Y },
      data: {
        kind: "mcp-host",
        label: hostLabel.value,
        hostLabel: hostLabel.value,
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
  ];
});

const edges = computed<Edge[]>(() => {
  const { execution } = props;
  return [
    {
      id: "agent-mcp",
      source: "agent",
      target: "mcp-host",
      sourceHandle: "down-mcp",
      targetHandle: "in",
      type: "step",
      animated: execution.mcpHostActive,
      style: {
        stroke: execution.mcpHostActive ? "#60a5fa" : IDLE_EDGE,
        strokeWidth: execution.mcpHostActive ? 2 : IDLE_EDGE_WIDTH,
      },
    },
  ];
});
</script>

<template>
  <div
    class="architecture-graph live-architecture-graph"
    :class="{ 'architecture-graph--paused': execution.paused }"
  >
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
