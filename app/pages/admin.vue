<script setup lang="ts">
// /admin — Dev4 owns. Dealer directory + grade KPIs + credit usage bars.
// Admin-only (route is role-gated by middleware via useNav; we also guard here).
import { thb } from '~/utils/labels'
import type { Dealer, Grade } from '~/types'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.admin.title'), t('page.admin.subtitle'))

// Defensive client gate (middleware already blocks non-admins).
if (import.meta.client && !can(['admin'])) {
  await navigateTo('/dashboard')
}

interface DealersResponse {
  dealers: Dealer[]
  summary: { total: number; gradeA: number; gradeB: number; gradeC: number }
}

const { data } = await useFetch<DealersResponse>('/api/dealers')

const query = ref('')
const dealers = computed(() => data.value?.dealers ?? [])
const summary = computed(
  () => data.value?.summary ?? { total: 0, gradeA: 0, gradeB: 0, gradeC: 0 },
)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return dealers.value
  return dealers.value.filter(
    (d) =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.province.toLowerCase().includes(q),
  )
})

const columns = computed(() => [
  { key: 'code', label: t('th.code'), mono: true },
  { key: 'name', label: t('th.dealerName') },
  { key: 'province', label: t('th.province') },
  { key: 'grade', label: t('th.grade') },
  { key: 'phone', label: t('th.phone'), mono: true },
  { key: 'credit', label: t('th.credit') },
])

// Grade badge tone.
const gradeTone: Record<Grade, string> = {
  A: 'bg-emerald-500/15 text-emerald-400',
  B: 'bg-sky-500/15 text-sky-400',
  C: 'bg-zinc-700/40 text-zinc-300',
}

// ---- Phase E: scheduled jobs ----------------------------------------------
const { refresh: refreshNotifications } = useNotifications()
const jobDefs = computed(() => [
  { name: 'low-stock', label: t('jobs.lowStock') },
  { name: 'credit-risk', label: t('jobs.creditRisk') },
  { name: 'daily-summary', label: t('jobs.dailySummary') },
])
const jobRunning = ref<string | null>(null)
const jobResult = reactive<Record<string, string>>({})
const jobError = ref<string | null>(null)
async function runJob(name: string) {
  jobRunning.value = name
  jobError.value = null
  try {
    const res = await $fetch<{ job: string; result: Record<string, number> }>(
      `/api/jobs/${name}/run`,
      { method: 'POST' },
    )
    jobResult[name] = JSON.stringify(res.result)
    await refreshNotifications()
  } catch {
    jobError.value = t('jobs.error')
  } finally {
    jobRunning.value = null
  }
}

// Credit bar fill colour ramps amber → red as usage approaches the limit.
function creditPct(d: Dealer): number {
  if (!d.creditLimit) return 0
  return Math.min(100, Math.round((d.creditUsed / d.creditLimit) * 100))
}
function creditBarClass(pct: number): string {
  if (pct >= 90) return 'bg-rose-500'
  if (pct >= 75) return 'bg-amber-500'
  return 'bg-brand-600'
}
</script>

<template>
  <div class="space-y-5">
    <!-- KPI cards -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard :label="t('admin.kpi.totalDealers')" :value="summary.total" tone="brand" />
      <StatCard :label="t('admin.kpi.gradeA')" :value="summary.gradeA" tone="emerald" />
      <StatCard :label="t('admin.kpi.gradeB')" :value="summary.gradeB" tone="sky" />
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <p class="flex items-center gap-2 text-2xl font-bold leading-none">
          <span class="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          {{ t('common.online') }}
        </p>
        <p class="mt-1.5 text-xs font-medium opacity-90">{{ t('admin.kpi.system') }}</p>
      </div>
    </div>

    <!-- Dealer directory -->
    <AppCard :title="t('admin.directory.title')" :subtitle="t('admin.directory.subtitle')">
      <template #actions>
        <input
          v-model="query"
          type="search"
          :placeholder="t('admin.search.placeholder')"
          class="w-56 rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app placeholder:text-muted focus:border-brand-600 focus:outline-none"
        >
      </template>

      <DataTable :columns="columns" :rows="filtered">
        <template #cell-grade="{ row }">
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold"
            :class="gradeTone[(row as Dealer).grade]"
          >
            {{ (row as Dealer).grade }}
          </span>
        </template>

        <template #cell-credit="{ row }">
          <div class="min-w-44">
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="code text-app">{{ thb((row as Dealer).creditUsed) }}</span>
              <span class="text-muted">/ {{ thb((row as Dealer).creditLimit) }}</span>
            </div>
            <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                class="h-full rounded-full transition-all"
                :class="creditBarClass(creditPct(row as Dealer))"
                :style="{ width: creditPct(row as Dealer) + '%' }"
              />
            </div>
          </div>
        </template>
      </DataTable>
    </AppCard>

    <!-- Scheduled jobs -->
    <AppCard :title="t('jobs.title')" :subtitle="t('jobs.subtitle')">
      <ul class="divide-y divide-app">
        <li
          v-for="def in jobDefs"
          :key="def.name"
          class="flex items-center justify-between gap-4 py-3"
        >
          <div class="min-w-0">
            <p class="text-sm font-semibold text-app">{{ def.label }}</p>
            <p v-if="jobResult[def.name]" class="code mt-0.5 truncate text-[11px] text-muted">
              {{ t('jobs.lastResult') }}: {{ jobResult[def.name] }}
            </p>
          </div>
          <AppButton
            size="sm"
            variant="outline"
            :disabled="jobRunning === def.name"
            @click="runJob(def.name)"
          >
            {{ jobRunning === def.name ? t('jobs.running') : t('jobs.run') }}
          </AppButton>
        </li>
      </ul>
      <p v-if="jobError" class="mt-3 text-xs text-rose-400">{{ jobError }}</p>
    </AppCard>
  </div>
</template>
