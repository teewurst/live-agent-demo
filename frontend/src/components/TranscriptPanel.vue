<script setup lang="ts">
export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  live?: boolean;
};

defineProps<{
  messages: TranscriptMessage[];
}>();
</script>

<template>
  <div class="transcript-panel">
    <div
      v-for="message in messages"
      :key="message.id"
      class="message"
      :class="[message.role, { live: message.live }]"
    >
      {{ message.text }}
    </div>
  </div>
</template>
