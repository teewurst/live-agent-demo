<script setup lang="ts">
defineProps<{
  modelValue: "classic" | "live";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: "classic" | "live"];
}>();
</script>

<template>
  <div class="agent-mode-tabs">
    <button
      type="button"
      class="agent-mode-tab"
      :class="{ active: modelValue === 'classic' }"
      @click="emit('update:modelValue', 'classic')"
    >
      Classic Agent
    </button>
    <button
      type="button"
      class="agent-mode-tab"
      :class="{ active: modelValue === 'live' }"
      @click="emit('update:modelValue', 'live')"
    >
      Live Agent
    </button>
  </div>
</template>
