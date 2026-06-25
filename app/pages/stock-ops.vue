<script setup lang="ts">
// /stock-ops — Phase 5 (Stock-ops). Warehouse transfers + cycle counts for
// admin/warehouse. Two tabs toggled by a local ref:
//   • Transfers — request inter-warehouse moves; confirm to actually move stock.
//   • Counts    — record a physical count; confirm to reconcile inventory.
// Warehouse-level (not dealer-scoped); the APIs enforce the same role gate.
import { computed, ref } from 'vue'
import type { TransferRow } from '~/../server/api/stock-ops/transfers/index.get'
import type { CountRow } from '~/../server/api/stock-ops/counts/index.get'
import type { StockTransferStatus, CycleCountStatus } from '~/types'

const { t } = useI18n()

usePageTitle().set(t('page.stockOps.title'), t('page.stockOps.subtitle'))

// Seeded warehouses (inventory.warehouse values).
const WAREHOUSES = ['คลังกรุงเทพ', 'คลังเชียงใหม่']

type Tab = 'transfers' | 'counts'
const tab = ref<Tab>('transfers')

// ---- data ------------------------------------------------------------------
const { data: transferData, refresh: refreshTransfers } = await useFetch<{ transfers: TransferRow[] }>(
  '/api/stock-ops/transfers',
  { default: () => ({ transfers: [] }) },
)
const transfers = computed(() => transferData.value?.transfers ?? [])

const { data: countData, refresh: refreshCounts } = await useFetch<{ counts: CountRow[] }>(
  '/api/stock-ops/counts',
  { default: () => ({ counts: [] }) },
)
const counts = computed(() => countData.value?.counts ?? [])

interface PartLite {
  id: number
  sku: string
  name: string
}
const { data: partsData } = await useFetch<{ parts: PartLite[] }>('/api/parts', {
  default: () => ({ parts: [] }),
})
const parts = computed(() => partsData.value?.parts ?? [])

// ---- labels ----------------------------------------------------------------
function partLabel(sku: string | null, name: string | null, partId: number): string {
  if (sku && name) return `${sku} — ${name}`
  return sku ?? name ?? `#${partId}`
}

// ---- transfer create modal -------------------------------------------------
const showTransfer = ref(false)
const trPartId = ref<number | null>(null)
const trFrom = ref('')
const trTo = ref('')
const trQty = ref<number | null>(null)
const trNote = ref('')
const trSubmitting = ref(false)
const trError = ref<string | null>(null)
const busyTransferId = ref<number | null>(null)

function openTransfer() {
  trError.value = null
  trPartId.value = parts.value[0]?.id ?? null
  trFrom.value = WAREHOUSES[0] ?? ''
  trTo.value = WAREHOUSES[1] ?? WAREHOUSES[0] ?? ''
  trQty.value = null
  trNote.value = ''
  showTransfer.value = true
}

async function submitTransfer() {
  trError.value = null
  if (
    trPartId.value == null ||
    !trFrom.value.trim() ||
    !trTo.value.trim() ||
    trFrom.value === trTo.value ||
    !trQty.value ||
    trQty.value <= 0
  ) {
    trError.value = t('stockOps.error')
    return
  }
  trSubmitting.value = true
  try {
    await $fetch('/api/stock-ops/transfers', {
      method: 'POST',
      body: {
        partId: trPartId.value,
        fromWarehouse: trFrom.value.trim(),
        toWarehouse: trTo.value.trim(),
        qty: Math.trunc(trQty.value),
        note: trNote.value.trim() || null,
      },
    })
    showTransfer.value = false
    await refreshTransfers()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    trError.value = msg || t('stockOps.error')
  } finally {
    trSubmitting.value = false
  }
}

async function completeTransfer(row: TransferRow) {
  busyTransferId.value = row.id
  try {
    await $fetch(`/api/stock-ops/transfers/${row.id}/complete`, { method: 'POST' })
    await refreshTransfers()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    trError.value = msg || t('stockOps.error')
  } finally {
    busyTransferId.value = null
  }
}

// ---- count create modal ----------------------------------------------------
const showCount = ref(false)
const cnPartId = ref<number | null>(null)
const cnWarehouse = ref('')
const cnCountedQty = ref<number | null>(null)
const cnNote = ref('')
const cnSubmitting = ref(false)
const cnError = ref<string | null>(null)
const busyCountId = ref<number | null>(null)

function openCount() {
  cnError.value = null
  cnPartId.value = parts.value[0]?.id ?? null
  cnWarehouse.value = WAREHOUSES[0] ?? ''
  cnCountedQty.value = null
  cnNote.value = ''
  showCount.value = true
}

async function submitCount() {
  cnError.value = null
  if (
    cnPartId.value == null ||
    !cnWarehouse.value.trim() ||
    cnCountedQty.value == null ||
    cnCountedQty.value < 0
  ) {
    cnError.value = t('stockOps.error')
    return
  }
  cnSubmitting.value = true
  try {
    await $fetch('/api/stock-ops/counts', {
      method: 'POST',
      body: {
        partId: cnPartId.value,
        warehouse: cnWarehouse.value.trim(),
        countedQty: Math.trunc(cnCountedQty.value),
        note: cnNote.value.trim() || null,
      },
    })
    showCount.value = false
    await refreshCounts()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    cnError.value = msg || t('stockOps.error')
  } finally {
    cnSubmitting.value = false
  }
}

async function postCount(row: CountRow) {
  busyCountId.value = row.id
  try {
    await $fetch(`/api/stock-ops/counts/${row.id}/post`, { method: 'POST' })
    await refreshCounts()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    cnError.value = msg || t('stockOps.error')
  } finally {
    busyCountId.value = null
  }
}

function tStatusLabel(s: StockTransferStatus): string {
  return t(`stockOps.tStatus.${s}`)
}
function cStatusLabel(s: CycleCountStatus): string {
  return t(`stockOps.cStatus.${s}`)
}

const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
const tabBtn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors'

// DataTable column defs.
const transferColumns = computed(() => [
  { key: 'transferNo', label: t('stockOps.transferNo'), mono: true },
  { key: 'part', label: t('stockOps.part') },
  { key: 'fromWarehouse', label: t('stockOps.from') },
  { key: 'toWarehouse', label: t('stockOps.to') },
  { key: 'qty', label: t('stockOps.qty'), align: 'right' as const },
  { key: 'status', label: t('stockOps.status') },
  { key: 'actions', label: '', align: 'right' as const },
])
const countColumns = computed(() => [
  { key: 'countNo', label: t('stockOps.countNo'), mono: true },
  { key: 'part', label: t('stockOps.part') },
  { key: 'warehouse', label: t('stockOps.warehouse') },
  { key: 'systemQty', label: t('stockOps.systemQty'), align: 'right' as const },
  { key: 'countedQty', label: t('stockOps.countedQty'), align: 'right' as const },
  { key: 'variance', label: t('stockOps.variance'), align: 'right' as const },
  { key: 'status', label: t('stockOps.status') },
  { key: 'actions', label: '', align: 'right' as const },
])
</script>

<template>
  <div class="space-y-5">
    <!-- tabs -->
    <div class="flex gap-2">
      <button
        :class="[tabBtn, tab === 'transfers' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-app']"
        @click="tab = 'transfers'"
      >
        {{ t('stockOps.tab.transfers') }}
      </button>
      <button
        :class="[tabBtn, tab === 'counts' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-app']"
        @click="tab = 'counts'"
      >
        {{ t('stockOps.tab.counts') }}
      </button>
    </div>

    <!-- ===== TRANSFERS TAB ===== -->
    <AppCard v-if="tab === 'transfers'" :title="t('stockOps.tab.transfers')">
      <template #actions>
        <AppButton size="sm" @click="openTransfer">{{ t('stockOps.createTransfer') }}</AppButton>
      </template>

      <p v-if="trError" class="mb-3 text-xs text-rose-400">{{ trError }}</p>

      <EmptyState v-if="!transfers.length" icon="🔁" :title="t('stockOps.empty')" />
      <DataTable v-else :columns="transferColumns" :rows="transfers">
        <template #cell-part="{ row }">{{ partLabel(row.partSku, row.partName, row.partId) }}</template>
        <template #cell-qty="{ row }"><span class="font-semibold">{{ row.qty }}</span></template>
        <template #cell-status="{ row }">
          <StatusBadge :status="row.status" :label="tStatusLabel(row.status)" />
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            v-if="row.status === 'requested'"
            size="sm"
            :disabled="busyTransferId === row.id"
            @click="completeTransfer(row)"
          >
            {{ t('stockOps.complete') }}
          </AppButton>
        </template>
      </DataTable>
    </AppCard>

    <!-- ===== COUNTS TAB ===== -->
    <AppCard v-if="tab === 'counts'" :title="t('stockOps.tab.counts')">
      <template #actions>
        <AppButton size="sm" @click="openCount">{{ t('stockOps.createCount') }}</AppButton>
      </template>

      <p v-if="cnError" class="mb-3 text-xs text-rose-400">{{ cnError }}</p>

      <EmptyState v-if="!counts.length" icon="📋" :title="t('stockOps.empty')" />
      <DataTable v-else :columns="countColumns" :rows="counts">
        <template #cell-part="{ row }">{{ partLabel(row.partSku, row.partName, row.partId) }}</template>
        <template #cell-variance="{ row }">
          <span
            class="font-semibold"
            :class="row.variance > 0 ? 'text-emerald-400' : row.variance < 0 ? 'text-rose-400' : 'text-muted'"
          >
            {{ row.variance > 0 ? `+${row.variance}` : row.variance }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <StatusBadge :status="row.status" :label="cStatusLabel(row.status)" />
        </template>
        <template #cell-actions="{ row }">
          <AppButton
            v-if="row.status === 'open'"
            size="sm"
            :disabled="busyCountId === row.id"
            @click="postCount(row)"
          >
            {{ t('stockOps.post') }}
          </AppButton>
        </template>
      </DataTable>
    </AppCard>

    <!-- transfer create modal -->
    <AppModal :open="showTransfer" :title="t('stockOps.createTransfer')" @close="showTransfer = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.part') }}</label>
          <select v-model.number="trPartId" :class="fld">
            <option v-for="p in parts" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.from') }}</label>
          <select v-model="trFrom" :class="fld">
            <option v-for="w in WAREHOUSES" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.to') }}</label>
          <select v-model="trTo" :class="fld">
            <option v-for="w in WAREHOUSES" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.qty') }}</label>
          <input v-model.number="trQty" type="number" min="1" :class="fld">
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.note') }}</label>
          <input v-model="trNote" type="text" :class="fld">
        </div>

        <p v-if="trError" class="text-xs text-rose-400">{{ trError }}</p>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" :disabled="trSubmitting" @click="showTransfer = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton size="sm" :disabled="trSubmitting" @click="submitTransfer">
          {{ t('common.save') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- count create modal -->
    <AppModal :open="showCount" :title="t('stockOps.createCount')" @close="showCount = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.part') }}</label>
          <select v-model.number="cnPartId" :class="fld">
            <option v-for="p in parts" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.warehouse') }}</label>
          <select v-model="cnWarehouse" :class="fld">
            <option v-for="w in WAREHOUSES" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('stockOps.countedQty') }}</label>
          <input v-model.number="cnCountedQty" type="number" min="0" :class="fld">
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.note') }}</label>
          <input v-model="cnNote" type="text" :class="fld">
        </div>

        <p v-if="cnError" class="text-xs text-rose-400">{{ cnError }}</p>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" :disabled="cnSubmitting" @click="showCount = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton size="sm" :disabled="cnSubmitting" @click="submitCount">
          {{ t('common.save') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
