<script setup lang="ts">
// SHARED component (SA owns). Generic rounded card with optional header.
defineProps<{ title?: string; subtitle?: string }>()
</script>

<template>
  <section class="rounded-2xl border border-app bg-surface p-5">
    <header
      v-if="title || $slots.header || $slots.actions"
      class="mb-4 flex items-start justify-between gap-3"
    >
      <div v-if="title || subtitle">
        <h2 class="text-base font-bold text-app">{{ title }}</h2>
        <p v-if="subtitle" class="mt-0.5 text-xs text-muted">{{ subtitle }}</p>
      </div>
      <slot name="header" />
      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>
