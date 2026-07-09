<script setup lang="ts">
defineProps<{
  sessionId: string | null;
  title?: string;
}>();
</script>

<template>
  <div class="phone">
    <div class="phone-notch" />
    <div class="phone-screen">
      <div class="avatar">🎙️</div>
      <div class="assistant-name">{{ title ?? "Local Voice Assistant" }}</div>
      <div class="session-id" v-if="sessionId">Session {{ sessionId.slice(0, 8) }}</div>
      <slot />
    </div>
  </div>
</template>
