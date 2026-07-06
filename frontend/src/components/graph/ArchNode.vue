<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed, inject, type ComputedRef } from "vue";
import type { ExecutionState, McpToolId, ToolNodeState } from "../../types/orchestration";

export type ArchNodeData = {
  kind: "caller" | "middleware" | "agent" | "waiting" | "emit" | "mcp-host";
  label: string;
  sublabel?: string;
  icon?: string;
  active?: boolean;
  pulse?: boolean;
  glow?: boolean;
  idle?: boolean;
  hostLabel?: string;
  tools?: {
    id: McpToolId;
    label: string;
    state: ToolNodeState;
    pulse: boolean;
    highlighted?: boolean;
    dimmed?: boolean;
  }[];
};

const props = defineProps<NodeProps<ArchNodeData>>();

const focusTool = inject<(name: string) => void>("archFocusTool");
const execution = inject<ComputedRef<ExecutionState>>("archExecution");

const nodeActive = computed(() => {
  const ex = execution?.value;
  if (!ex) {
    return Boolean(props.data.active);
  }
  switch (props.data.kind) {
    case "caller":
      return ex.callerActive;
    case "middleware":
      return ex.middlewareActive;
    case "agent":
      return ex.agentActive;
    case "waiting":
      return ex.showWaiting;
    case "emit":
      return ex.emitOutputActive;
    case "mcp-host":
      return ex.mcpHostActive;
    default:
      return Boolean(props.data.active);
  }
});

const nodePulse = computed(() => {
  const ex = execution?.value;
  if (props.data.kind === "waiting") {
    return ex?.showWaiting ?? Boolean(props.data.pulse);
  }
  if (props.data.kind === "mcp-host") {
    return Boolean(ex?.activeMcpTool);
  }
  if (
    props.data.kind === "caller" ||
    props.data.kind === "middleware" ||
    props.data.kind === "agent"
  ) {
    return nodeActive.value;
  }
  return Boolean(props.data.pulse);
});

const nodeGlow = computed(() => {
  if (props.data.kind === "emit") {
    return execution?.value.emitOutputActive ?? Boolean(props.data.glow);
  }
  return Boolean(props.data.glow);
});

function toolClass(
  state: ToolNodeState,
  pulse: boolean,
  highlighted?: boolean,
  dimmed?: boolean,
): string[] {
  const classes = ["arch-node", "arch-node--tool", `arch-node--${state}`];
  if (pulse) {
    classes.push("arch-node--pulse");
  }
  if (highlighted) {
    classes.push("arch-node--tool-highlight");
  }
  if (dimmed) {
    classes.push("arch-node--tool-dimmed");
  }
  return classes;
}

function onToolClick(toolId: McpToolId, state: ToolNodeState): void {
  if (state === "locked") {
    return;
  }
  focusTool?.(toolId);
}
</script>

<template>
  <div
    class="arch-flow-node"
    :class="[
      `arch-flow-node--${data.kind}`,
      {
        'arch-node--active': nodeActive,
        'arch-node--pulse': nodePulse,
        'arch-node--glow': nodeGlow,
      },
    ]"
  >
    <Handle
      v-if="data.kind === 'middleware' || data.kind === 'agent' || data.kind === 'waiting'"
      id="in"
      type="target"
      :position="Position.Left"
      class="arch-handle"
    />
    <Handle
      v-if="data.kind === 'mcp-host'"
      id="in"
      type="target"
      :position="Position.Top"
      class="arch-handle arch-handle--mcp-in-top"
    />
    <Handle
      v-if="data.kind === 'emit'"
      id="in"
      type="target"
      :position="Position.Top"
      class="arch-handle arch-handle--emit-in-top"
    />
    <Handle
      v-if="data.kind !== 'waiting' && data.kind !== 'emit' && data.kind !== 'mcp-host'"
      id="out"
      type="source"
      :position="Position.Right"
      class="arch-handle"
    />
    <Handle
      v-if="data.kind === 'agent'"
      id="down-mcp"
      type="source"
      :position="Position.Bottom"
      class="arch-handle arch-handle--down-mcp"
    />
    <Handle
      v-if="data.kind === 'agent'"
      id="down-emit"
      type="source"
      :position="Position.Bottom"
      class="arch-handle arch-handle--down-emit"
    />

    <template v-if="data.kind === 'mcp-host'">
      <span class="arch-node-label">{{ data.hostLabel }}</span>
      <div class="arch-mcp-tools arch-mcp-tools--row">
        <button
          v-for="tool in data.tools"
          :key="tool.id"
          type="button"
          :class="toolClass(tool.state, tool.pulse, tool.highlighted, tool.dimmed)"
          :disabled="tool.state === 'locked'"
          @click="onToolClick(tool.id, tool.state)"
        >
          {{ tool.label }}
        </button>
      </div>
    </template>

    <template v-else>
      <span v-if="data.icon" class="arch-node-icon">{{ data.icon }}</span>
      <span class="arch-node-label">{{ data.label }}</span>
      <span v-if="data.sublabel && data.kind === 'emit'" class="arch-node-sub">{{ data.sublabel }}</span>
    </template>
  </div>
</template>
