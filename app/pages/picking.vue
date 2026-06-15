<script setup lang="ts">
// /picking — Phase 3 (WMS). Warehouse pick-task console. admin/warehouse list
// pick tasks, expand one to load its lines, then assign (รับงาน) or complete
// (จัดเสร็จ). A small generate control creates a pick task from an order id.
import type { PickTask, PickTaskStatus } from '~/types'

const { t } = useI18n()
const { user } = useAuth()

usePageTitle().set(t('page.picking.title'), t('page.picking.subtitle'))

// ---- list rows (mirror server PickTaskRow) ---------------------------------
interface PickTaskRow extends PickTask {
  poNumber: string
  itemCount: number
}
interface PickTaskItemRow {
  id: number
  partId: number
  qty: number
  locationId: number | null
  pickedQty: number
  status: 'pending' | 'picked'
  partSku: string
  partName: string
  locationCode: string | null
}

const tasks = ref<PickTaskRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

function readErr(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage || err?.statusMessage || t('picking.error')
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ pickTasks: PickTaskRow[] }>('/api/wms/pick-tasks')
    tasks.value = res.pickTasks
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- expand / detail -------------------------------------------------------
const expandedId = ref<number | null>(null)
const items = ref<PickTaskItemRow[]>([])
const detailLoading = ref(false)

async function toggle(task: PickTaskRow) {
  if (expandedId.value === task.id) {
    expandedId.value = null
    items.value = []
    return
  }
  expandedId.value = task.id
  items.value = []
  detailLoading.value = true
  try {
    const res = await $fetch<{ items: PickTaskItemRow[] }>(`/api/wms/pick-tasks/${task.id}`)
    items.value = res.items
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    detailLoading.value = false
  }
}

// ---- actions ---------------------------------------------------------------
const busyId = ref<number | null>(null)

const canAssign = (s: PickTaskStatus) => s === 'open' || s === 'assigned'
const canComplete = (s: PickTaskStatus) => s !== 'picked' && s !== 'cancelled'

async function assign(task: PickTaskRow) {
  busyId.value = task.id
  error.value = null
  try {
    await $fetch(`/api/wms/pick-tasks/${task.id}/assign`, { method: 'POST', body: {} })
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    busyId.value = null
  }
}

async function complete(task: PickTaskRow) {
  busyId.value = task.id
  error.value = null
  try {
    await $fetch(`/api/wms/pick-tasks/${task.id}/complete`, { method: 'POST', body: {} })
    if (expandedId.value === task.id) {
      const res = await $fetch<{ items: PickTaskItemRow[] }>(`/api/wms/pick-tasks/${task.id}`)
      items.value = res.items
    }
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    busyId.value = null
  }
}

// ---- generate --------------------------------------------------------------
const genOrderId = ref<string>('')
const generating = ref(false)

async function generate() {
  const orderId = Number(genOrderId.value)
  if (!Number.isInteger(orderId) || orderId <= 0) return
  generating.value = true
  error.value = null
  try {
    await $fetch('/api/wms/pick-tasks', { method: 'POST', body: { orderId } })
    genOrderId.value = ''
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    generating.value = false
  }
}

// ---- display helpers -------------------------------------------------------
// Thai/EN label via i18n; the tone comes from the shared StatusBadge map.
const statusLabel = (s: PickTaskStatus) => t(`picking.status.${s}`)
const assignedLabel = (task: PickTaskRow) =>
  task.assignedTo == null
    ? '—'
    : task.assignedTo === user.value?.id
      ? user.value?.email ?? `#${task.assignedTo}`
      : `#${task.assignedTo}`

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-32 rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
</script>

<template>
  <div class="space-y-5">
    <!-- generate control -->
    <div class="flex flex-wrap items-end justify-end gap-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-muted">{{ t('picking.order') }}</label>
        <input v-model="genOrderId" type="number" min="1" :class="fld">
      </div>
      <AppButton size="sm" :disabled="generating || genOrderId.trim() === ''" @click="generate">
        + {{ t('picking.generate') }}
      </AppButton>
    </div>

    <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

    <EmptyState v-if="!loading && tasks.length === 0" icon="📦" :title="t('picking.empty')">
      {{ t('picking.emptyHint') }}
    </EmptyState>

    <!-- pick-task cards -->
    <div class="space-y-3">
      <AppCard v-for="task in tasks" :key="task.id">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <button class="min-w-0 flex-1 text-left" @click="toggle(task)">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-app">{{ task.pickNumber }}</p>
              <StatusBadge :status="task.status" :label="statusLabel(task.status)" />
            </div>
            <p class="mt-1 text-xs text-muted">
              {{ t('picking.order') }}: {{ task.poNumber }}
              · {{ t('picking.warehouse') }}: {{ task.warehouse }}
              · {{ t('picking.items') }}: {{ task.itemCount }}
              · {{ t('picking.assignedTo') }}: {{ assignedLabel(task) }}
            </p>
          </button>
          <div class="flex shrink-0 gap-1.5">
            <AppButton
              v-if="canAssign(task.status)"
              variant="outline"
              size="sm"
              :disabled="busyId === task.id"
              @click="assign(task)"
            >
              {{ t('picking.assign') }}
            </AppButton>
            <AppButton
              v-if="canComplete(task.status)"
              size="sm"
              :disabled="busyId === task.id"
              @click="complete(task)"
            >
              {{ t('picking.complete') }}
            </AppButton>
          </div>
        </div>

        <!-- expanded line items -->
        <div v-if="expandedId === task.id" class="mt-3 border-t border-app pt-3">
          <p v-if="detailLoading" class="text-xs text-muted">…</p>
          <table v-else class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-muted">
                <th class="pb-1 font-medium">{{ t('picking.part') }}</th>
                <th class="pb-1 text-right font-medium">{{ t('picking.qty') }}</th>
                <th class="pb-1 text-right font-medium">{{ t('picking.picked') }}</th>
                <th class="pb-1 text-right font-medium">{{ t('picking.location') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id" class="border-t border-app/50">
                <td class="py-1.5 text-app">{{ it.partSku }} — {{ it.partName }}</td>
                <td class="py-1.5 text-right text-app">{{ it.qty }}</td>
                <td class="py-1.5 text-right text-app">{{ it.pickedQty }}</td>
                <td class="py-1.5 text-right text-muted">{{ it.locationCode ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </div>
  </div>
</template>
