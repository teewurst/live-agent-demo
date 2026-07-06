<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { inject } from "vue";
import type { McpToolId, ToolNodeState } from "../../types/orchestration";

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

defineProps<NodeProps<ArchNodeData>>();

const focusTool = inject<(name: string) => void>("archFocusTool");

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
        'arch-node--active': data.active,
        'arch-node--pulse': data.pulse,
        'arch-node--glow': data.glow,
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
