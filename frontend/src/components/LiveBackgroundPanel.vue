<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { LiveAgentPromptVariant, ToolBackendMode } from "../api/liveClient";
import { LIVE_AGENT_PROMPT_LABELS } from "../api/liveClient";
import type { LiveExecutionState, TimelineItem } from "../types/orchestration";
import { formatJson, summarizeTimelineLine } from "../utils/timelineSummary";
import LiveArchitectureGraph from "./LiveArchitectureGraph.vue";

const props = defineProps<{
  items: TimelineItem[];
  execution: LiveExecutionState;
  expandedIds: Set<string>;
  toolBackendMode: ToolBackendMode;
  liveAgentPromptVariant: LiveAgentPromptVariant;
  systemPrompt: string;
}>();

const emit = defineEmits<{
  toggleExpand: [id: string];
  focusTool: [toolCallId: string];
}>();

const feedEl = ref<HTMLElement | null>(null);
const followNewest = ref(true);
const promptExpanded = ref(false);
const SCROLL_PIN_THRESHOLD = 32;

const displayItems = computed(() =>
  [...props.items].filter(
    (item) =>
      item.kind === "user" ||
      item.kind === "assistant" ||
      item.kind === "tool_call" ||
      item.kind === "tool_result" ||
      item.kind === "error",
  ),
);

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
  const el = feedEl.value;
  if (!el) {
    return true;
  }
  return el.scrollTop <= SCROLL_PIN_THRESHOLD;
}

function scrollToNewest(behavior: ScrollBehavior = "smooth"): void {
  feedEl.value?.scrollTo({ top: 0, behavior });
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
  const el = feedEl.value?.querySelector(`[data-tool-call-id="${toolCallId}"]`);
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
  <aside class="background-panel live-background-panel">
    <div class="background-panel-header">
      <h2>Live tool activity</h2>
      <p>
        OpenAI Realtime · {{ LIVE_AGENT_PROMPT_LABELS[liveAgentPromptVariant] }} ·
        {{ toolBackendMode === "mcp" ? "MCP mock" : "Local demo" }}
      </p>
    </div>

    <div class="background-panel-body">
      <LiveArchitectureGraph
        :execution="execution"
        :tool-backend-mode="toolBackendMode"
        @focus-tool="onGraphFocusTool"
      />

      <div class="live-prompt-section">
        <div class="live-prompt-header">
          <span>System prompt (read-only)</span>
          <button
            type="button"
            class="timeline-expand-btn"
            @click="promptExpanded = !promptExpanded"
          >
            {{ promptExpanded ? "Hide" : "Show" }}
          </button>
        </div>
        <pre v-if="promptExpanded" class="live-prompt-text">{{ systemPrompt }}</pre>
      </div>

      <div class="timeline-section live-activity-section">
        <div class="timeline-section-header">
          <span>Transcript & tools</span>
          <button
            v-if="displayItems.length && !followNewest"
            type="button"
            class="timeline-jump-latest"
            @click="jumpToNewest"
          >
            Jump to latest
          </button>
        </div>

        <div v-if="!displayItems.length" class="background-empty">
          Start a Live call. New speech and tool activity appears at the top.
        </div>

        <div
          v-else
          ref="feedEl"
          class="timeline-feed timeline-feed--compact"
          @scroll="onFeedScroll"
        >
          <TransitionGroup name="timeline-slide" tag="div">
            <div
              v-for="item in [...displayItems].reverse()"
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
