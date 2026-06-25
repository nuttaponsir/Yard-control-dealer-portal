<script setup lang="ts">
// /issues — Phase H (auto error capture). Admin-only triage board for errors
// filed automatically by app/plugins/error-capture.client.ts. Route is gated
// by the global auth middleware via useNav (roles: ['admin']).
import { computed, ref } from 'vue'
import type { IssueListRow } from '~/../server/api/issues/index.get'
import type { Issue, IssueStatus } from '~/types'

const { t } = useI18n()
usePageTitle().set(t('page.issues.title'), t('page.issues.subtitle'))

const STATUSES: IssueStatus[] = ['draft', 'open', 'in_progress', 'resolved', 'closed']

const STATUS_LABEL: Record<IssueStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

// ---- data ------------------------------------------------------------------
const statusFilter = ref<IssueStatus | null>(null)
const { data, refresh, pending } = await useFetch<{
  issues: IssueListRow[]
  counts: Record<string, number>
  total: number
}>('/api/issues', {
  query: computed(() => (statusFilter.value ? { status: statusFilter.value } : {})),
  default: () => ({ issues: [], counts: {}, total: 0 }),
})

const issues = computed(() => data.value?.issues ?? [])
const counts = computed(() => data.value?.counts ?? {})
const total = computed(() => data.value?.total ?? 0)

const columns = [
  { key: 'issueNumber', label: t('issues.col.number'), mono: true },
  { key: 'title', label: t('issues.col.title') },
  { key: 'module', label: t('issues.col.module') },
  { key: 'action', label: t('issues.col.action') },
  { key: 'userEmail', label: t('issues.col.user') },
  { key: 'severity', label: t('issues.col.severity') },
  { key: 'status', label: t('issues.col.status') },
  { key: 'createdAt', label: t('issues.col.createdAt') },
  { key: 'actions', label: '', align: 'right' as const },
]

function thaiTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function errMsg(err: unknown): string {
  return (err as { data?: { statusMessage?: string } })?.data?.statusMessage || t('issues.toast.error')
}

const toast = ref<string | null>(null)
function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = null), 3500)
}

// ---- detail drawer ---------------------------------------------------------
const detail = ref<Issue | null>(null)
const detailLoading = ref(false)
async function openDetail(id: number) {
  detailLoading.value = true
  detail.value = null
  try {
    const res = await $fetch<{ issue: Issue }>(`/api/issues/${id}`)
    detail.value = res.issue
  } catch (err) {
    showToast(errMsg(err))
  } finally {
    detailLoading.value = false
  }
}

const savingStatus = ref(false)
async function changeStatus(id: number, status: IssueStatus) {
  savingStatus.value = true
  try {
    await $fetch(`/api/issues/${id}`, { method: 'PATCH', body: { status } })
    if (detail.value && detail.value.id === id) detail.value.status = status
    showToast(t('issues.toast.updated'))
    await refresh()
  } catch (err) {
    showToast(errMsg(err))
  } finally {
    savingStatus.value = false
  }
}

const prettyDetail = computed(() => {
  if (!detail.value?.detail) return null
  try {
    return JSON.stringify(JSON.parse(detail.value.detail), null, 2)
  } catch {
    return detail.value.detail
  }
})
</script>

<template>
  <div class="space-y-5">
    <!-- KPIs -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard :label="t('issues.kpi.draft')" :value="counts.draft ?? 0" tone="amber" />
      <StatCard :label="t('issues.kpi.open')" :value="counts.open ?? 0" tone="sky" />
      <StatCard :label="t('issues.kpi.inProgress')" :value="counts.in_progress ?? 0" tone="brand" />
      <StatCard :label="t('issues.kpi.total')" :value="total" tone="default" />
    </div>

    <AppCard :title="t('issues.list.title')">
      <template #actions>
        <div class="flex flex-wrap items-center gap-1.5">
          <DataPorter :export-url="'/api/issues/export'" :export-filename="'issues.xlsx'" />
          <button
            class="rounded-lg px-2.5 py-1 text-xs font-semibold transition"
            :class="statusFilter === null ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-app'"
            @click="statusFilter = null"
          >
            {{ t('issues.filter.all') }}
          </button>
          <button
            v-for="s in STATUSES"
            :key="s"
            class="rounded-lg px-2.5 py-1 text-xs font-semibold transition"
            :class="statusFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-app'"
            @click="statusFilter = s"
          >
            {{ STATUS_LABEL[s] }} ({{ counts[s] ?? 0 }})
          </button>
        </div>
      </template>

      <EmptyState v-if="!pending && !issues.length" icon="🐞" :title="t('issues.list.empty')" />
      <DataTable v-else :columns="columns" :rows="issues">
        <template #cell-module="{ value }">
          <span class="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">{{ value ?? '—' }}</span>
        </template>
        <template #cell-action="{ value }">
          <span class="block max-w-[220px] truncate text-xs text-muted" :title="value ?? ''">{{ value ?? '—' }}</span>
        </template>
        <template #cell-userEmail="{ value }">{{ value ?? '—' }}</template>
        <template #cell-severity="{ value }">
          <StatusBadge :status="value" :label="value" />
        </template>
        <template #cell-status="{ value }">
          <StatusBadge :status="value" :label="STATUS_LABEL[value as IssueStatus]" />
        </template>
        <template #cell-createdAt="{ value }">
          <span class="text-xs text-muted">{{ thaiTime(value) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton size="sm" variant="outline" @click="openDetail(row.id)">
            {{ t('issues.action.view') }}
            <span v-if="row.hasShot" class="ml-1">📷</span>
          </AppButton>
        </template>
      </DataTable>
    </AppCard>

    <!-- detail drawer -->
    <div
      v-if="detail || detailLoading"
      class="fixed inset-0 z-50 flex justify-end bg-black/50"
      @click.self="detail = null"
    >
      <div class="h-full w-full max-w-2xl overflow-y-auto border-l border-app bg-surface p-5 shadow-2xl">
        <div v-if="detailLoading" class="text-sm text-muted">…</div>
        <div v-else-if="detail" class="space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-mono text-xs text-muted">{{ detail.issueNumber }}</p>
              <h2 class="mt-0.5 text-lg font-bold text-app">{{ detail.title }}</h2>
            </div>
            <button class="rounded-lg p-1 text-muted hover:bg-surface-2" @click="detail = null">✕</button>
          </div>

          <!-- meta grid -->
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-[11px] uppercase text-muted">{{ t('issues.col.module') }}</p>
              <p class="text-app">{{ detail.module ?? '—' }}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase text-muted">{{ t('issues.detail.source') }}</p>
              <p class="text-app">{{ detail.source }}</p>
            </div>
            <div class="col-span-2">
              <p class="text-[11px] uppercase text-muted">{{ t('issues.col.page') }}</p>
              <p class="break-all text-app">{{ detail.page ?? '—' }}</p>
            </div>
            <div class="col-span-2">
              <p class="text-[11px] uppercase text-muted">{{ t('issues.col.action') }}</p>
              <p class="break-all text-app">{{ detail.action ?? '—' }}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase text-muted">{{ t('issues.col.user') }}</p>
              <p class="text-app">{{ detail.userEmail ?? '—' }}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase text-muted">{{ t('issues.col.createdAt') }}</p>
              <p class="text-app">{{ thaiTime(detail.createdAt) }}</p>
            </div>
          </div>

          <!-- status changer -->
          <div>
            <p class="mb-1 text-[11px] uppercase text-muted">{{ t('issues.action.changeStatus') }}</p>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="s in STATUSES"
                :key="s"
                :disabled="savingStatus"
                class="rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50"
                :class="detail.status === s ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-app'"
                @click="changeStatus(detail.id, s)"
              >
                {{ STATUS_LABEL[s] }}
              </button>
            </div>
          </div>

          <!-- message -->
          <div>
            <p class="mb-1 text-[11px] uppercase text-muted">{{ t('issues.detail.message') }}</p>
            <pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-rose-300 whitespace-pre-wrap">{{ detail.message }}</pre>
          </div>

          <!-- screenshot -->
          <div>
            <p class="mb-1 text-[11px] uppercase text-muted">{{ t('issues.detail.screenshot') }}</p>
            <img
              v-if="detail.screenshot"
              :src="detail.screenshot"
              alt="screenshot"
              class="w-full rounded-lg border border-app"
            >
            <p v-else class="text-xs text-muted">{{ t('issues.detail.noShot') }}</p>
          </div>

          <!-- detail json -->
          <div v-if="prettyDetail">
            <p class="mb-1 text-[11px] uppercase text-muted">{{ t('issues.detail.detail') }}</p>
            <pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11px] text-muted whitespace-pre-wrap">{{ prettyDetail }}</pre>
          </div>

          <!-- stack -->
          <div v-if="detail.stack">
            <p class="mb-1 text-[11px] uppercase text-muted">{{ t('issues.detail.stack') }}</p>
            <pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[11px] text-muted whitespace-pre-wrap">{{ detail.stack }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- toast -->
    <AppToast :message="toast" />
  </div>
</template>
