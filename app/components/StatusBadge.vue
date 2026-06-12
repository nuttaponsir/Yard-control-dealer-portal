<script setup lang="ts">
// SHARED component (SA owns). Renders a status pill with Thai label + tone,
// resolved from app/utils/labels.ts. Pass a raw status string.
import { statusLabel, statusTone } from '~/utils/labels'
const props = defineProps<{ status: string; label?: string }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
    :class="statusTone(props.status)"
  >
    <span class="h-1.5 w-1.5 rounded-full bg-current" />
    {{ label ?? statusLabel(props.status) }}
  </span>
</template>
