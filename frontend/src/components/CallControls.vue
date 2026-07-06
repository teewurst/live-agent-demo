<script setup lang="ts">
defineProps<{
  callActive: boolean;
  canInterrupt: boolean;
}>();

defineEmits<{
  start: [];
  interrupt: [];
  reset: [];
}>();
</script>

<template>
  <div class="controls">
    <button
      class="control-btn start"
      :disabled="callActive"
      aria-label="Start call"
      @click="$emit('start')"
    >
      📞
    </button>
    <button
      class="control-btn end"
      :disabled="!canInterrupt"
      aria-label="Stop playback and listening"
      @click="$emit('interrupt')"
    >
      ✕
    </button>
    <button class="control-btn reset" aria-label="Reset session" @click="$emit('reset')">
      Reset
    </button>
  </div>
</template>
