<script setup lang="ts">
defineProps<{
  state: string;
}>();
</script>

<template>
  <div class="status-row">
    <div class="status-pill">{{ state }}</div>
  </div>
</template>
