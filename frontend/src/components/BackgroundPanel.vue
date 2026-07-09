<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { AgentPromptVariant, ToolBackendMode } from "../api/client";
import { AGENT_PROMPT_LABELS } from "../api/client";
import type { ExecutionState, TimelineItem } from "../types/orchestration";
import type { TurnProfile } from "../types/turnProfile";
import { formatJson, summarizeTimelineLine } from "../utils/timelineSummary";
import ArchitectureGraph from "./ArchitectureGraph.vue";
import TurnProfilePanel from "./TurnProfilePanel.vue";

const props = defineProps<{
  items: TimelineItem[];
  execution: ExecutionState;
  turnProfile: TurnProfile | null;
  expandedIds: Set<string>;
  toolBackendMode: ToolBackendMode;
  agentPromptVariant: AgentPromptVariant;
}>();

const emit = defineEmits<{
  toggleExpand: [id: string];
  focusTool: [toolCallId: string];
}>();

const feedEl = ref<HTMLElement | null>(null);
const followNewest = ref(true);
const SCROLL_PIN_THRESHOLD = 32;

function feedContainer(): HTMLElement | null {
  const el = feedEl.value;
  return el instanceof HTMLElement ? el : null;
}

const displayItems = computed(() => [...props.items].reverse());

function isExpanded(id: string): boolean {
  return props.expandedIds.has(id);
}

function hasFullDetail(item: TimelineItem): boolean {
  return Boolean(
    item.arguments ||
      item.result !== undefined ||
      (item.text && item.text.length > 96),
  );
}

function isPinnedToNewest(): boolean {
  const el = feedContainer();
  if (!el) {
    return true;
  }
  return el.scrollTop <= SCROLL_PIN_THRESHOLD;
}

function scrollToNewest(behavior: ScrollBehavior = "smooth"): void {
  feedContainer()?.scrollTo({ top: 0, behavior });
}

function jumpToNewest(): void {
  followNewest.value = true;
  scrollToNewest();
}

function onFeedScroll(): void {
  followNewest.value = isPinnedToNewest();
}

async function scrollToToolCall(toolCallId: string): Promise<void> {
  await nextTick();
  const el = feedContainer()?.querySelector(`[data-tool-call-id="${toolCallId}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.add("timeline-item--highlight");
    window.setTimeout(() => el.classList.remove("timeline-item--highlight"), 1400);
  }
}

function onGraphFocusTool(toolName: string): void {
  const match = [...props.items]
    .reverse()
    .find((item) => item.toolName === toolName && item.toolCallId);
  if (match?.toolCallId) {
    emit("focusTool", match.toolCallId);
    void scrollToToolCall(match.toolCallId);
  }
}

watch(
  () => props.execution.focusToolCallId,
  (toolCallId) => {
    if (toolCallId) {
      void scrollToToolCall(toolCallId);
    }
  },
);

watch(
  () => props.items.length,
  async (length, previousLength) => {
    if (!followNewest.value || length <= previousLength) {
      return;
    }
    await nextTick();
    scrollToNewest(length === 1 ? "auto" : "smooth");
  },
);
</script>

<template>
  <aside class="background-panel">
    <div class="background-panel-header">
      <h2>Running in the background</h2>
      <p>
        Architecture view — live activity ·
        {{ AGENT_PROMPT_LABELS[agentPromptVariant] }}
      </p>
    </div>

    <div class="background-panel-body">
      <ArchitectureGraph
        :execution="execution"
        :tool-backend-mode="toolBackendMode"
        @focus-tool="onGraphFocusTool"
      />

      <TurnProfilePanel :profile="turnProfile" />

      <div class="timeline-section">
        <div class="timeline-section-header">
          <span>Session log</span>
          <button
            v-if="items.length && !followNewest"
            type="button"
            class="timeline-jump-latest"
            @click="jumpToNewest"
          >
            Jump to latest
          </button>
        </div>

        <div v-if="!items.length" class="background-empty">
          No activity yet. Start a call or use debug mode.
        </div>

        <div
          v-else
          ref="feedEl"
          class="timeline-feed timeline-feed--compact"
          @scroll="onFeedScroll"
        >
          <TransitionGroup name="timeline-slide" tag="div">
          <div
            v-for="item in displayItems"
            :key="item.id"
            class="timeline-item timeline-item--compact"
            :class="[item.kind, { live: item.live }]"
            :data-tool-call-id="item.toolCallId"
            :data-tool-name="item.toolName"
          >
            <div class="timeline-compact-row">
              <span class="timeline-label">{{ item.kind }}</span>
              <span class="timeline-compact-text">{{ summarizeTimelineLine(item) }}</span>
              <button
                v-if="hasFullDetail(item)"
                type="button"
                class="timeline-expand-btn"
                :aria-expanded="isExpanded(item.id)"
                @click="emit('toggleExpand', item.id)"
              >
                {{ isExpanded(item.id) ? "Less" : "More" }}
              </button>
            </div>

            <div v-if="isExpanded(item.id)" class="timeline-expanded">
              <div v-if="item.text" class="timeline-text">{{ item.text }}</div>
              <pre v-if="item.arguments" class="timeline-code">{{ formatJson(item.arguments) }}</pre>
              <pre v-if="item.result !== undefined" class="timeline-code">{{ formatJson(item.result) }}</pre>
              <div v-if="item.status" class="timeline-status">Status: {{ item.status }}</div>
            </div>
          </div>
          </TransitionGroup>
        </div>
      </div>
    </div>
  </aside>
</template>
