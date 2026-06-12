<script setup lang="ts">
// /reports — Reporting & Analytics (Phase D). Admin-only.
// Tabbed, read-only views over the GET /api/reports/* endpoints. Each report
// declares the array field to table-render plus its columns + formatting; a few
// also surface scalar summary chips. Charts / Excel-PDF export are future work.
import { thb } from '~/utils/labels'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.reports.title'), t('page.reports.subtitle'))

if (import.meta.client && !can(['admin'])) {
  await navigateTo('/dashboard')
}

type Fmt = 'text' | 'money' | 'pct' | 'num'
interface RColumn {
  key: string
  labelKey: string
  fmt?: Fmt
  mono?: boolean
}
interface ReportDef {
  key: string
  labelKey: string
  group: 'sales' | 'inventory' | 'finance' | 'claims' | 'exec'
  path: string
  dataKey: string // which array field of the response to table-render
  columns: RColumn[]
  summary?: (data: Record<string, unknown>) => { labelKey: string; value: string }[]
}

const REPORTS: ReportDef[] = [
  // ---- sales ----
  {
    key: 'sales-by-dealer', labelKey: 'reports.r.salesByDealer', group: 'sales',
    path: '/api/reports/sales-by-dealer', dataKey: 'rows',
    columns: [
      { key: 'code', labelKey: 'reports.col.code', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'province', labelKey: 'reports.col.province' },
      { key: 'grade', labelKey: 'reports.col.grade' },
      { key: 'orderCount', labelKey: 'reports.col.orderCount', fmt: 'num' },
      { key: 'totalSales', labelKey: 'reports.col.totalSales', fmt: 'money' },
    ],
  },
  {
    key: 'sales-by-category', labelKey: 'reports.r.salesByCategory', group: 'sales',
    path: '/api/reports/sales-by-category', dataKey: 'rows',
    columns: [
      { key: 'category', labelKey: 'reports.col.category' },
      { key: 'qty', labelKey: 'reports.col.qty', fmt: 'num' },
      { key: 'revenue', labelKey: 'reports.col.revenue', fmt: 'money' },
    ],
  },
  {
    key: 'sales-by-region', labelKey: 'reports.r.salesByRegion', group: 'sales',
    path: '/api/reports/sales-by-region', dataKey: 'rows',
    columns: [
      { key: 'region', labelKey: 'reports.col.region' },
      { key: 'orderCount', labelKey: 'reports.col.orderCount', fmt: 'num' },
      { key: 'totalSales', labelKey: 'reports.col.totalSales', fmt: 'money' },
    ],
  },
  {
    key: 'open-orders-aging', labelKey: 'reports.r.openOrdersAging', group: 'sales',
    path: '/api/reports/open-orders-aging', dataKey: 'rows',
    columns: [
      { key: 'poNumber', labelKey: 'reports.col.po', mono: true },
      { key: 'status', labelKey: 'reports.col.status' },
      { key: 'daysOpen', labelKey: 'reports.col.daysOpen', fmt: 'num' },
      { key: 'totalValue', labelKey: 'reports.col.totalSales', fmt: 'money' },
    ],
    summary: (d) => (d.buckets as { bucket: string; count: number }[] ?? []).map((b) => ({
      labelKey: '', value: `${b.bucket}: ${b.count}`,
    })),
  },
  {
    key: 'top-parts', labelKey: 'reports.r.topParts', group: 'sales',
    path: '/api/reports/top-parts', dataKey: 'topByRevenue',
    columns: [
      { key: 'sku', labelKey: 'reports.col.sku', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'qty', labelKey: 'reports.col.qty', fmt: 'num' },
      { key: 'revenue', labelKey: 'reports.col.revenue', fmt: 'money' },
    ],
  },
  // ---- inventory ----
  {
    key: 'stock-on-hand', labelKey: 'reports.r.stockOnHand', group: 'inventory',
    path: '/api/reports/stock-on-hand', dataKey: 'rows',
    columns: [
      { key: 'sku', labelKey: 'reports.col.sku', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'warehouse', labelKey: 'reports.col.warehouse' },
      { key: 'qtyOnHand', labelKey: 'reports.col.qtyOnHand', fmt: 'num' },
      { key: 'reorderPoint', labelKey: 'reports.col.reorderPoint', fmt: 'num' },
    ],
  },
  {
    key: 'low-stock', labelKey: 'reports.r.lowStock', group: 'inventory',
    path: '/api/reports/low-stock', dataKey: 'rows',
    columns: [
      { key: 'sku', labelKey: 'reports.col.sku', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'warehouse', labelKey: 'reports.col.warehouse' },
      { key: 'qtyOnHand', labelKey: 'reports.col.qtyOnHand', fmt: 'num' },
      { key: 'reorderPoint', labelKey: 'reports.col.reorderPoint', fmt: 'num' },
      { key: 'deficit', labelKey: 'reports.col.deficit', fmt: 'num' },
    ],
  },
  {
    key: 'inventory-valuation', labelKey: 'reports.r.inventoryValuation', group: 'inventory',
    path: '/api/reports/inventory-valuation', dataKey: 'rows',
    columns: [
      { key: 'sku', labelKey: 'reports.col.sku', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'totalQty', labelKey: 'reports.col.qty', fmt: 'num' },
      { key: 'price', labelKey: 'reports.col.price', fmt: 'money' },
      { key: 'value', labelKey: 'reports.col.value', fmt: 'money' },
    ],
    summary: (d) => [{ labelKey: 'reports.col.value', value: thb(Number(d.grandTotal ?? 0)) }],
  },
  // ---- finance ----
  {
    key: 'credit-utilization', labelKey: 'reports.r.creditUtilization', group: 'finance',
    path: '/api/reports/credit-utilization', dataKey: 'rows',
    columns: [
      { key: 'code', labelKey: 'reports.col.code', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'grade', labelKey: 'reports.col.grade' },
      { key: 'creditLimit', labelKey: 'reports.col.creditLimit', fmt: 'money' },
      { key: 'creditUsed', labelKey: 'reports.col.creditUsed', fmt: 'money' },
      { key: 'utilizationPct', labelKey: 'reports.col.utilizationPct', fmt: 'pct' },
    ],
  },
  {
    key: 'credit-risk', labelKey: 'reports.r.creditRisk', group: 'finance',
    path: '/api/reports/credit-risk', dataKey: 'rows',
    columns: [
      { key: 'code', labelKey: 'reports.col.code', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'grade', labelKey: 'reports.col.grade' },
      { key: 'creditLimit', labelKey: 'reports.col.creditLimit', fmt: 'money' },
      { key: 'creditUsed', labelKey: 'reports.col.creditUsed', fmt: 'money' },
      { key: 'utilizationPct', labelKey: 'reports.col.utilizationPct', fmt: 'pct' },
    ],
    summary: (d) => [{ labelKey: 'reports.col.utilizationPct', value: `> ${Number(d.threshold ?? 80)}%` }],
  },
  // ---- claims ----
  {
    key: 'claims-by-status', labelKey: 'reports.r.claimsByStatus', group: 'claims',
    path: '/api/reports/claims-by-status', dataKey: 'rows',
    columns: [
      { key: 'status', labelKey: 'reports.col.status' },
      { key: 'count', labelKey: 'reports.col.count', fmt: 'num' },
      { key: 'totalAmount', labelKey: 'reports.col.totalAmount', fmt: 'money' },
    ],
  },
  {
    key: 'claim-rate-by-part', labelKey: 'reports.r.claimRateByPart', group: 'claims',
    path: '/api/reports/claim-rate-by-part', dataKey: 'rows',
    columns: [
      { key: 'sku', labelKey: 'reports.col.sku', mono: true },
      { key: 'name', labelKey: 'reports.col.name' },
      { key: 'claimCount', labelKey: 'reports.col.claimCount', fmt: 'num' },
      { key: 'qtySold', labelKey: 'reports.col.qtySold', fmt: 'num' },
      { key: 'ratePct', labelKey: 'reports.col.ratePct', fmt: 'pct' },
    ],
  },
  {
    key: 'claims-by-model', labelKey: 'reports.r.claimsByModel', group: 'claims',
    path: '/api/reports/claims-by-model', dataKey: 'rows',
    columns: [
      { key: 'model', labelKey: 'reports.col.model' },
      { key: 'claimCount', labelKey: 'reports.col.claimCount', fmt: 'num' },
    ],
  },
  // ---- executive ----
  {
    key: 'dealer-mix-by-grade', labelKey: 'reports.r.dealerMixByGrade', group: 'exec',
    path: '/api/reports/dealer-mix-by-grade', dataKey: 'rows',
    columns: [
      { key: 'grade', labelKey: 'reports.col.grade' },
      { key: 'dealerCount', labelKey: 'reports.col.dealerCount', fmt: 'num' },
      { key: 'sumCreditLimit', labelKey: 'reports.col.creditLimit', fmt: 'money' },
      { key: 'totalSales', labelKey: 'reports.col.totalSales', fmt: 'money' },
    ],
  },
  {
    key: 'autologic-install', labelKey: 'reports.r.autologicInstall', group: 'exec',
    path: '/api/reports/autologic-install', dataKey: 'opportunities',
    columns: [
      { key: 'vin', labelKey: 'reports.col.vin', mono: true },
      { key: 'model', labelKey: 'reports.col.model' },
      { key: 'status', labelKey: 'reports.col.status' },
    ],
    summary: (d) => {
      const s = (d.summary ?? {}) as Record<string, number>
      return [
        { labelKey: 'reports.col.installed', value: String(s.installed ?? 0) },
        { labelKey: 'reports.col.notInstalled', value: String(s.notInstalled ?? 0) },
        { labelKey: 'reports.col.installRate', value: `${s.installRatePct ?? 0}%` },
      ]
    },
  },
]

const GROUPS: { key: ReportDef['group']; labelKey: string }[] = [
  { key: 'sales', labelKey: 'reports.group.sales' },
  { key: 'inventory', labelKey: 'reports.group.inventory' },
  { key: 'finance', labelKey: 'reports.group.finance' },
  { key: 'claims', labelKey: 'reports.group.claims' },
  { key: 'exec', labelKey: 'reports.group.exec' },
]

const activeKey = ref<string>(REPORTS[0]!.key)
const activeReport = computed(() => REPORTS.find((r) => r.key === activeKey.value)!)
function reportsOf(group: ReportDef['group']) {
  return REPORTS.filter((r) => r.group === group)
}

const data = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const error = ref(false)

async function load() {
  loading.value = true
  error.value = false
  try {
    data.value = await $fetch<Record<string, unknown>>(activeReport.value.path)
  } catch {
    error.value = true
    data.value = null
  } finally {
    loading.value = false
  }
}
watch(activeKey, load, { immediate: true })

const columns = computed(() =>
  activeReport.value.columns.map((c) => ({
    key: c.key,
    label: t(c.labelKey),
    mono: c.mono,
    align: c.fmt && c.fmt !== 'text' ? ('right' as const) : ('left' as const),
  })),
)

function fmtCell(value: unknown, fmt?: Fmt): string {
  if (value == null) return '—'
  if (fmt === 'money') return thb(Number(value))
  if (fmt === 'pct') return `${value}%`
  if (fmt === 'num') return Number(value).toLocaleString('th-TH')
  return String(value)
}

const tableRows = computed<Record<string, string>[]>(() => {
  const arr = (data.value?.[activeReport.value.dataKey] as Record<string, unknown>[]) ?? []
  return arr.map((row) => {
    const out: Record<string, string> = {}
    for (const c of activeReport.value.columns) out[c.key] = fmtCell(row[c.key], c.fmt)
    return out
  })
})

const summaryChips = computed(() => {
  if (!data.value || !activeReport.value.summary) return []
  return activeReport.value.summary(data.value)
})
</script>

<template>
  <div class="space-y-5">
    <!-- report picker, grouped -->
    <AppCard>
      <div class="space-y-3">
        <div v-for="g in GROUPS" :key="g.key">
          <p class="mb-1.5 text-[11px] uppercase tracking-wide text-muted">{{ t(g.labelKey) }}</p>
          <div class="flex flex-wrap gap-2">
            <CategoryChip
              v-for="r in reportsOf(g.key)"
              :key="r.key"
              :active="r.key === activeKey"
              @click="activeKey = r.key"
            >
              {{ t(r.labelKey) }}
            </CategoryChip>
          </div>
        </div>
      </div>
    </AppCard>

    <AppCard :title="t(activeReport.labelKey)">
      <div v-if="summaryChips.length" class="mb-4 flex flex-wrap gap-2">
        <span
          v-for="(chip, i) in summaryChips"
          :key="i"
          class="rounded-full bg-surface-2 px-3 py-1 text-xs text-app"
        >
          <span v-if="chip.labelKey" class="text-muted">{{ t(chip.labelKey) }}: </span>{{ chip.value }}
        </span>
      </div>

      <div v-if="error" class="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-2.5 text-sm text-rose-300">
        {{ t('reports.error') }}
      </div>
      <p v-else-if="loading" class="py-8 text-center text-sm text-muted">{{ t('reports.loading') }}</p>
      <DataTable v-else :columns="columns" :rows="tableRows" />
    </AppCard>
  </div>
</template>
