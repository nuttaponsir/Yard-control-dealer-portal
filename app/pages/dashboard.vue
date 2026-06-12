<script setup lang="ts">
// /dashboard — Dev1 owns. Role-scoped overview: 4 KPI cards, daily-orders bar
// chart (CSS), low-stock table (red when qtyOnHand < reorderPoint), and a
// dealer-credit panel for owner/sales.
import { computed } from 'vue'
import { thb } from '~/utils/labels'

const { t } = useI18n()

usePageTitle().set(t('page.dashboard.title'), t('dashboard.subtitle'))

interface DashboardData {
  kpis: { totalOrders: number; pending: number; shipped: number; delivered: number }
  dailyOrders: { date: string; count: number }[]
  lowStock: { sku: string; name: string; warehouse: string; qtyOnHand: number; reorderPoint: number }[]
  credit: null | { dealerName: string; grade: string; limit: number; used: number }
}

const { data } = await useFetch<DashboardData>('/api/dashboard')

const kpis = computed(() => data.value?.kpis ?? { totalOrders: 0, pending: 0, shipped: 0, delivered: 0 })
const dailyOrders = computed(() => data.value?.dailyOrders ?? [])
const lowStock = computed(() => data.value?.lowStock ?? [])
const credit = computed(() => data.value?.credit ?? null)

// chart scaling — keep a non-zero max so bars always render visibly.
const maxCount = computed(() => Math.max(1, ...dailyOrders.value.map((d) => d.count)))
function barHeight(count: number) {
  return Math.round((count / maxCount.value) * 100)
}
function shortDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const creditPct = computed(() => {
  if (!credit.value || credit.value.limit <= 0) return 0
  return Math.min(100, Math.round((credit.value.used / credit.value.limit) * 100))
})

const lowStockColumns = computed(() => [
  { key: 'sku', label: t('th.sku'), mono: true },
  { key: 'name', label: t('dashboard.col.part') },
  { key: 'warehouse', label: t('th.warehouse') },
  { key: 'qtyOnHand', label: t('th.qtyOnHand'), align: 'right' as const },
  { key: 'reorderPoint', label: t('dashboard.col.reorderPoint'), align: 'right' as const },
])
</script>

<template>
  <div class="space-y-5">
    <!-- KPI cards -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard :label="t('dashboard.kpi.totalOrders')" :value="kpis.totalOrders" tone="brand" />
      <StatCard :label="t('dashboard.kpi.pending')" :value="kpis.pending" tone="amber" />
      <StatCard :label="t('dashboard.kpi.shipped')" :value="kpis.shipped" tone="sky" />
      <StatCard :label="t('dashboard.kpi.delivered')" :value="kpis.delivered" tone="emerald" />
    </div>

    <!-- Credit panel (owner/sales only) -->
    <AppCard v-if="credit" :title="t('dashboard.credit.title')" :subtitle="credit.dealerName">
      <div class="flex items-end justify-between text-sm">
        <span class="text-muted">{{ t('dashboard.credit.grade') }} {{ credit.grade }}</span>
        <span class="text-app">
          {{ t('dashboard.credit.used') }} <span class="font-semibold">{{ thb(credit.used) }}</span>
          / {{ t('dashboard.credit.limit') }} <span class="font-semibold">{{ thb(credit.limit) }}</span>
        </span>
      </div>
      <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          class="h-full rounded-full bg-brand-600 transition-all"
          :style="{ width: creditPct + '%' }"
        />
      </div>
      <p class="mt-1 text-right text-[11px] text-muted">{{ creditPct }}%</p>
    </AppCard>

    <!-- Daily-orders chart -->
    <AppCard :title="t('dashboard.chart.title')" :subtitle="t('dashboard.chart.subtitle')">
      <div class="flex h-44 items-end gap-1.5">
        <div
          v-for="d in dailyOrders"
          :key="d.date"
          class="flex flex-1 flex-col items-center justify-end gap-1"
        >
          <span class="text-[10px] font-semibold text-muted">{{ d.count }}</span>
          <div
            class="w-full rounded-t bg-brand-600"
            :style="{ height: barHeight(d.count) + '%', minHeight: '2px' }"
            :title="`${d.date}: ${d.count}`"
          />
          <span class="text-[9px] text-muted">{{ shortDate(d.date) }}</span>
        </div>
      </div>
    </AppCard>

    <!-- Low-stock table -->
    <AppCard :title="t('dashboard.lowStock.title')" :subtitle="t('dashboard.lowStock.subtitle')">
      <DataTable :columns="lowStockColumns" :rows="lowStock">
        <template #cell-qtyOnHand="{ row }">
          <span :class="row.qtyOnHand < row.reorderPoint ? 'font-bold text-rose-400' : 'text-app'">
            {{ row.qtyOnHand }}
          </span>
        </template>
      </DataTable>
    </AppCard>
  </div>
</template>
