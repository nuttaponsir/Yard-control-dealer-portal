<script setup lang="ts">
// Phase E — carrier tracking timeline for one order. Lazily fetches the mock
// Flash/SCG timeline from /api/orders/[id]/tracking and renders it as a vertical
// step list.
import { computed, onMounted, ref } from 'vue'
import type { TrackingResult } from '~/../server/utils/carriers'

const props = defineProps<{ orderId: number }>()
const { t } = useI18n()

const data = ref<TrackingResult | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    data.value = await $fetch<TrackingResult>(`/api/orders/${props.orderId}/tracking`)
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}
onMounted(load)

const statusLabel = computed(() => t(`tracking.status.${data.value?.status ?? 'pending'}`))

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <div class="mt-2 rounded-lg border border-app bg-app p-3">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[11px] font-semibold text-muted">{{ t('tracking.title') }}</span>
      <span class="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
        {{ statusLabel }}
      </span>
    </div>

    <p v-if="loading" class="text-[11px] text-muted">…</p>
    <p v-else-if="!data || !data.events.length" class="text-[11px] text-muted">
      {{ t('tracking.pending') }}
    </p>
    <ol v-else class="space-y-2">
      <li v-for="(ev, i) in data.events" :key="ev.code" class="flex gap-2">
        <div class="flex flex-col items-center">
          <span
            class="h-2 w-2 rounded-full"
            :class="i === data.events.length - 1 ? 'bg-brand-500' : 'bg-brand-700'"
          />
          <span v-if="i < data.events.length - 1" class="w-px flex-1 bg-app" />
        </div>
        <div class="min-w-0 flex-1 pb-1">
          <p class="text-xs font-semibold text-app">{{ ev.label }}</p>
          <p class="text-[10px] text-muted">{{ ev.location }} · {{ fmt(ev.at) }}</p>
        </div>
      </li>
    </ol>
  </div>
</template>
