<script setup lang="ts">
// SHARED component (SA owns).
withDefaults(defineProps<{ icon?: string; title?: string }>(), { icon: '📭', title: '' })
const { t } = useI18n()
</script>

<template>
  <div class="rounded-2xl border border-dashed border-app bg-surface p-12 text-center">
    <div class="text-5xl">{{ icon }}</div>
    <p class="mt-3 font-semibold text-app">{{ title || t('common.empty') }}</p>
    <p v-if="$slots.default" class="mt-1 text-sm text-muted"><slot /></p>
  </div>
</template>
