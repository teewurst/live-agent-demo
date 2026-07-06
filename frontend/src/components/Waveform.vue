<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  state: string;
  level: number;
}>();

const orbClass = computed(() => {
  if (props.state === "speaking") return "speaking";
  if (props.state === "recording") return "recording";
  if (props.state === "listening" || props.state === "connecting") return "listening";
  return "";
});

const bars = computed(() => {
  const scaled = Math.min(1, props.level * 18);
  return Array.from({ length: 7 }, (_, index) => {
    const wave = Math.sin((index + 1) * 1.2 + scaled * 8) * 0.5 + 0.5;
    return 12 + wave * 36 * (scaled + 0.15);
  });
});
</script>

<template>
  <div class="waveform-wrap">
    <div class="orb" :class="orbClass">
      <div class="bars">
        <span
          v-for="(height, index) in bars"
          :key="index"
          class="bar"
          :style="{ height: `${height}px` }"
        />
      </div>
    </div>
  </div>
</template>
