<script setup lang="ts">
// /orders — Dev2 owns. Purchase-order list table (dealer-scoped on the server).
import { computed } from 'vue'
import { thb } from '~/utils/labels'
import type { OrderRow } from '~/../server/api/orders/index.get'

const { t } = useI18n()

usePageTitle().set(t('page.orders.title'), t('page.orders.subtitle'))

const columns = computed(() => [
  { key: 'poNumber', label: t('orders.col.po'), mono: true },
  { key: 'dealerName', label: t('th.dealer') },
  { key: 'vin', label: t('th.vin'), mono: true },
  { key: 'status', label: t('th.status') },
  { key: 'tracking', label: t('orders.col.tracking') },
  { key: 'totalValue', label: t('th.value'), align: 'right' as const },
  { key: 'createdAt', label: t('orders.col.date') },
])

const { data } = await useFetch<{ orders: OrderRow[] }>('/api/orders', {
  default: () => ({ orders: [] }),
})
const rows = computed(() => data.value?.orders ?? [])

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <AppCard :title="t('page.orders.title')" :subtitle="t('page.orders.subtitle')">
    <template #actions>
      <DataPorter :export-url="'/api/orders/export'" :export-filename="'orders.xlsx'" />
    </template>
    <DataTable :columns="columns" :rows="rows">
      <template #cell-status="{ value }">
        <StatusBadge :status="value" />
      </template>
      <template #cell-tracking="{ row }">
        <span v-if="row.trackingNo" class="code text-sm">
          {{ row.trackingNo }}<span v-if="row.carrier" class="text-muted"> · {{ row.carrier }}</span>
        </span>
        <span v-else class="text-muted">-</span>
      </template>
      <template #cell-totalValue="{ value }">{{ thb(value) }}</template>
      <template #cell-vin="{ value }">{{ value ?? '-' }}</template>
      <template #cell-createdAt="{ value }">{{ thaiDate(value) }}</template>
    </DataTable>
  </AppCard>
</template>
