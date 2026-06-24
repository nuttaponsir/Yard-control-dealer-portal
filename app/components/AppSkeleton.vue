<script setup lang="ts">
// Lightweight loading placeholder. Render while a lazy fetch is `pending` so
// the app shell (sidebar/header) paints instantly and the user sees animated
// placeholders instead of a blank or empty-state flash. `rows` cards, each a
// pulsing bar block, theme-aware via the surface tokens.
withDefaults(defineProps<{ rows?: number; cards?: number }>(), { rows: 4, cards: 0 })
const { t } = useI18n()
</script>

<template>
  <div class="space-y-4" aria-busy="true" aria-live="polite">
    <span class="sr-only">{{ t('common.loadingEllipsis') }}</span>

    <!-- KPI / stat card grid (optional) -->
    <div v-if="cards > 0" class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div
        v-for="c in cards"
        :key="`c${c}`"
        class="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
      />
    </div>

    <!-- row blocks -->
    <div class="space-y-3">
      <div
        v-for="r in rows"
        :key="`r${r}`"
        class="h-12 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
        :style="{ opacity: 1 - r * 0.04 }"
      />
    </div>
  </div>
</template>
