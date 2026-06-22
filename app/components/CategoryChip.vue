<script setup lang="ts">
// SHARED component (SA owns). Selectable part-category chip.
withDefaults(defineProps<{ active?: boolean }>(), { active: false })
</script>

<template>
  <button
    class="rounded-full border px-3 py-1 text-xs font-medium transition"
    :class="active
      ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
      : 'border-app text-muted hover:bg-surface-2 hover:text-app'"
  >
    <slot />
  </button>
</template>
