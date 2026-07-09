<script setup lang="ts">
import { computed } from "vue";
import type { TurnProfile, TurnProfileBucketKey, TurnProfileSpanKind } from "../types/turnProfile";
import { formatProfileMs, spanShareOfBucket } from "../types/turnProfile";

const props = defineProps<{
  profile: TurnProfile | null;
}>();

const BUCKET_COLORS: Record<TurnProfileBucketKey, string> = {
  transcribing: "rgba(96, 165, 250, 0.85)",
  agent: "rgba(56, 189, 248, 0.8)",
  tools: "rgba(52, 211, 153, 0.8)",
  tts: "rgba(167, 139, 250, 0.85)",
};

function spanKindToBucket(kind: TurnProfileSpanKind): TurnProfileBucketKey {
  switch (kind) {
    case "network":
    case "transcribing":
      return "transcribing";
    case "agent_llm":
      return "agent";
    case "tool":
      return "tools";
    case "tts":
      return "tts";
  }
}

const bucketRows = computed(() => {
  if (!props.profile) {
    return [];
  }
  const total = Math.max(props.profile.totalMs, 1);
  const spans = props.profile.spans;

  return props.profile.buckets.map((bucket) => {
    const children = spans
      .filter((span) => spanKindToBucket(span.kind) === bucket.key)
      .map((span) => ({
        ...span,
        share: spanShareOfBucket(span.ms, bucket.ms),
      }));

    return {
      ...bucket,
      pct: Math.max(4, Math.round((bucket.ms / total) * 100)),
      color: BUCKET_COLORS[bucket.key],
      children,
    };
  });
});
</script>

<template>
  <section v-if="profile" class="turn-profile">
    <div class="turn-profile-header">
      <span>Turn timing</span>
      <span class="turn-profile-total">#{{ profile.turnId }} · {{ formatProfileMs(profile.totalMs) }}</span>
    </div>

    <p v-if="profile.firstResponse?.captionMs != null" class="turn-profile-first-response">
      First response:
      caption {{ formatProfileMs(profile.firstResponse.captionMs) }}
      <template v-if="profile.firstResponse.audioMs != null">
        · audio {{ formatProfileMs(profile.firstResponse.audioMs) }}
      </template>
    </p>

    <div class="turn-profile-bars">
      <div v-for="bucket in bucketRows" :key="bucket.key" class="turn-profile-bucket">
        <div class="turn-profile-row">
          <span class="turn-profile-label">{{ bucket.label }}</span>
          <div class="turn-profile-track">
            <div
              class="turn-profile-fill"
              :style="{ width: `${bucket.pct}%`, background: bucket.color }"
            />
          </div>
          <span class="turn-profile-ms">{{ formatProfileMs(bucket.ms) }}</span>
        </div>

        <ul v-if="bucket.children.length" class="turn-profile-breakdown">
          <li v-for="child in bucket.children" :key="child.id">
            <span class="turn-profile-breakdown-label">{{ child.label }}</span>
            <span v-if="child.detail" class="turn-profile-breakdown-detail">{{ child.detail }}</span>
            <span class="turn-profile-breakdown-ms">
              {{ formatProfileMs(child.ms) }}
              <em v-if="bucket.children.length > 1">({{ child.share }}%)</em>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
