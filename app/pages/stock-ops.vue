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
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-app text-xs text-muted">
              <th class="px-3 py-2 font-medium">{{ t('stockOps.transferNo') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.part') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.from') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.to') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('stockOps.qty') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.status') }}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tr in transfers" :key="tr.id" class="border-b border-app/60">
              <td class="px-3 py-2 font-mono text-xs text-app">{{ tr.transferNo }}</td>
              <td class="px-3 py-2 text-app">{{ partLabel(tr.partSku, tr.partName, tr.partId) }}</td>
              <td class="px-3 py-2 text-muted">{{ tr.fromWarehouse }}</td>
              <td class="px-3 py-2 text-muted">{{ tr.toWarehouse }}</td>
              <td class="px-3 py-2 text-right font-semibold text-app">{{ tr.qty }}</td>
              <td class="px-3 py-2 text-app">{{ tStatusLabel(tr.status) }}</td>
              <td class="px-3 py-2 text-right">
                <AppButton
                  v-if="tr.status === 'requested'"
                  size="sm"
                  :disabled="busyTransferId === tr.id"
                  @click="completeTransfer(tr)"
                >
                  {{ t('stockOps.complete') }}
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- ===== COUNTS TAB ===== -->
    <AppCard v-if="tab === 'counts'" :title="t('stockOps.tab.counts')">
      <template #actions>
        <AppButton size="sm" @click="openCount">{{ t('stockOps.createCount') }}</AppButton>
      </template>

      <p v-if="cnError" class="mb-3 text-xs text-rose-400">{{ cnError }}</p>

      <EmptyState v-if="!counts.length" icon="📋" :title="t('stockOps.empty')" />
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-app text-xs text-muted">
              <th class="px-3 py-2 font-medium">{{ t('stockOps.countNo') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.part') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.warehouse') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('stockOps.systemQty') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('stockOps.countedQty') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('stockOps.variance') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('stockOps.status') }}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in counts" :key="c.id" class="border-b border-app/60">
              <td class="px-3 py-2 font-mono text-xs text-app">{{ c.countNo }}</td>
              <td class="px-3 py-2 text-app">{{ partLabel(c.partSku, c.partName, c.partId) }}</td>
              <td class="px-3 py-2 text-muted">{{ c.warehouse }}</td>
              <td class="px-3 py-2 text-right text-app">{{ c.systemQty }}</td>
              <td class="px-3 py-2 text-right text-app">{{ c.countedQty }}</td>
              <td
                class="px-3 py-2 text-right font-semibold"
                :class="c.variance > 0 ? 'text-emerald-400' : c.variance < 0 ? 'text-rose-400' : 'text-muted'"
              >
                {{ c.variance > 0 ? `+${c.variance}` : c.variance }}
              </td>
              <td class="px-3 py-2 text-app">{{ cStatusLabel(c.status) }}</td>
              <td class="px-3 py-2 text-right">
                <AppButton
                  v-if="c.status === 'open'"
                  size="sm"
                  :disabled="busyCountId === c.id"
                  @click="postCount(c)"
                >
                  {{ t('stockOps.post') }}
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- transfer create modal -->
    <div
      v-if="showTransfer"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="showTransfer = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">{{ t('stockOps.createTransfer') }}</h2>
          <button class="text-muted hover:text-app" @click="showTransfer = false">✕</button>
        </div>

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

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="trSubmitting" @click="showTransfer = false">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="trSubmitting" @click="submitTransfer">
              {{ t('common.save') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>

    <!-- count create modal -->
    <div
      v-if="showCount"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="showCount = false"
    >
      <div class="w-full max-w-md rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">{{ t('stockOps.createCount') }}</h2>
          <button class="text-muted hover:text-app" @click="showCount = false">✕</button>
        </div>

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

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="cnSubmitting" @click="showCount = false">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="cnSubmitting" @click="submitCount">
              {{ t('common.save') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
