<script setup lang="ts">
// /dashboard — Dev1 owns. Role-scoped overview: 4 KPI cards, daily-orders bar
// chart (CSS), low-stock table (red when qtyOnHand < reorderPoint), and a
// dealer-credit panel for owner/sales.
import { computed } from 'vue'
import { thb } from '~/utils/labels'

const { t } = useI18n()

usePageTitle().set(t('page.dashboard.title'), t('dashboard.subtitle'))

interface WmsSummary {
  picks: { open: number; inProgress: number; picked: number }
  activeLocations: number
  openPurchaseOrders: number
  expiringWarranties: number
  deviceAlerts: number
  recentMovements: { partSku: string | null; warehouse: string; kind: string; qty: number; createdAt: string }[]
}
interface DashboardData {
  kpis: { totalOrders: number; pending: number; shipped: number; delivered: number }
  dailyOrders: { date: string; count: number }[]
  lowStock: { sku: string; name: string; warehouse: string; qtyOnHand: number; reorderPoint: number }[]
  credit: null | { dealerName: string; grade: string; limit: number; used: number }
  wms: null | WmsSummary
}

// Lazy + client-only: the app shell paints instantly with a skeleton instead
// of blocking SSR on the (remote-DB) aggregate queries; data fills in after.
const { data, status } = useFetch<DashboardData>('/api/dashboard', { lazy: true, server: false })

const kpis = computed(() => data.value?.kpis ?? { totalOrders: 0, pending: 0, shipped: 0, delivered: 0 })
const dailyOrders = computed(() => data.value?.dailyOrders ?? [])
const lowStock = computed(() => data.value?.lowStock ?? [])
const credit = computed(() => data.value?.credit ?? null)
const wms = computed(() => data.value?.wms ?? null)

function shortDateTime(iso: string) {
  return iso.slice(0, 10)
}
const moveKindLabel = (k: string) => t(`movements.kind.${k}`)

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
    <AppSkeleton v-if="status !== 'success'" :cards="4" :rows="5" />
    <template v-else>
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

    <!-- WMS summary (admin/warehouse only) -->
    <template v-if="wms">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard :label="t('dashboard.wms.openPicks')" :value="wms.picks.open" tone="amber" />
        <StatCard :label="t('dashboard.wms.inProgressPicks')" :value="wms.picks.inProgress" tone="sky" />
        <StatCard :label="t('dashboard.wms.pickedPicks')" :value="wms.picks.picked" tone="emerald" />
        <StatCard :label="t('dashboard.wms.activeLocations')" :value="wms.activeLocations" tone="brand" />
      </div>

      <!-- Phase 5 module tiles — clickable, jump to the module -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NuxtLink to="/procurement" class="block transition hover:opacity-80">
          <StatCard :label="t('dashboard.wms.openPOs')" :value="wms.openPurchaseOrders" tone="amber" />
        </NuxtLink>
        <NuxtLink to="/warranty" class="block transition hover:opacity-80">
          <StatCard :label="t('dashboard.wms.expiringWarranties')" :value="wms.expiringWarranties" tone="sky" />
        </NuxtLink>
        <NuxtLink to="/telematics" class="block transition hover:opacity-80">
          <StatCard :label="t('dashboard.wms.deviceAlerts')" :value="wms.deviceAlerts" tone="brand" />
        </NuxtLink>
      </div>
    </template>

    <!-- Daily-orders chart — full width (30 daily bars use the space) -->
    <AppCard :title="t('dashboard.chart.title')" :subtitle="t('dashboard.chart.subtitle')">
      <div class="flex h-56 gap-1.5">
        <div
          v-for="d in dailyOrders"
          :key="d.date"
          class="flex flex-1 flex-col items-center gap-1"
        >
          <span class="text-[10px] font-semibold text-muted">{{ d.count }}</span>
          <!-- bar track: flex-1 gives a definite height so the bar's % resolves -->
          <div class="flex w-full flex-1 items-end">
            <div
              class="w-full rounded-t bg-brand-600"
              :style="{ height: barHeight(d.count) + '%', minHeight: d.count > 0 ? '4px' : '0' }"
              :title="`${d.date}: ${d.count}`"
            />
          </div>
          <span class="text-[9px] text-muted">{{ shortDate(d.date) }}</span>
        </div>
      </div>
    </AppCard>

    <!-- Lower row: low-stock table beside recent movements (admin/warehouse).
         For dealer roles (no WMS) the table fills the full width. -->
    <div class="grid gap-5" :class="wms ? 'lg:grid-cols-3' : ''">
      <AppCard
        :title="t('dashboard.lowStock.title')"
        :subtitle="t('dashboard.lowStock.subtitle')"
        :class="wms ? 'lg:col-span-2' : ''"
      >
        <DataTable :columns="lowStockColumns" :rows="lowStock">
          <template #cell-qtyOnHand="{ row }">
            <span :class="row.qtyOnHand < row.reorderPoint ? 'font-bold text-rose-400' : 'text-app'">
              {{ row.qtyOnHand }}
            </span>
          </template>
        </DataTable>
      </AppCard>

      <AppCard v-if="wms" :title="t('dashboard.wms.recentTitle')" :subtitle="t('dashboard.wms.recentSubtitle')">
        <EmptyState v-if="wms.recentMovements.length === 0" icon="📈" :title="t('movements.empty')" />
        <ul v-else class="divide-y divide-app">
          <li
            v-for="(m, i) in wms.recentMovements"
            :key="i"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <div class="min-w-0">
              <span class="font-medium text-app">{{ m.partSku ?? '—' }}</span>
              <span class="ml-2 text-xs text-muted">{{ m.warehouse }} · {{ moveKindLabel(m.kind) }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <span :class="m.qty < 0 ? 'font-semibold text-rose-400' : 'font-semibold text-emerald-400'">
                {{ m.qty > 0 ? '+' : '' }}{{ m.qty }}
              </span>
              <span class="text-[11px] text-muted">{{ shortDateTime(m.createdAt) }}</span>
            </div>
          </li>
        </ul>
      </AppCard>
    </div>
    </template>
  </div>
</template>
