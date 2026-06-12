<script setup lang="ts">
// SHARED component (SA owns). KPI tile.
withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    tone?: 'default' | 'brand' | 'amber' | 'emerald' | 'sky' | 'rose'
  }>(),
  { tone: 'default', hint: '' },
)
const tones: Record<string, string> = {
  default: 'border-app bg-surface text-app',
  brand: 'border-brand-800 bg-brand-900/30 text-brand-300',
  amber: 'border-amber-900 bg-amber-950/40 text-amber-300',
  emerald: 'border-emerald-900 bg-emerald-950/40 text-emerald-300',
  sky: 'border-sky-900 bg-sky-950/40 text-sky-300',
  rose: 'border-rose-900 bg-rose-950/40 text-rose-300',
}
</script>

<template>
  <div class="rounded-xl border p-4" :class="tones[tone]">
    <p class="text-2xl font-bold leading-none">{{ value }}</p>
    <p class="mt-1.5 text-xs font-medium opacity-90">{{ label }}</p>
    <p v-if="hint" class="mt-0.5 text-[11px] opacity-70">{{ hint }}</p>
  </div>
</template>
