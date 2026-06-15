<script setup lang="ts">
// /movements — Phase 3 (WMS). Stock-movement ledger for admin/warehouse.
// A read-only ledger table with kind + warehouse filters, plus a manual
// stock-adjust modal that POSTs to /api/wms/movements and refreshes the list.
// Warehouse-level (not dealer-scoped); the API enforces the same.
import { computed, ref } from 'vue'
import type { MovementRow } from '~/../server/api/wms/movements/index.get'
import type { StockMovementKind } from '~/types'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.movements.title'), t('page.movements.subtitle'))

const canManage = computed(() => can(['admin', 'warehouse']))

const KINDS: StockMovementKind[] = [
  'receipt',
  'issue',
  'transfer',
  'adjust',
  'return',
  'external_dispatch',
]

// ---- ledger list -----------------------------------------------------------
const { data: listData, refresh } = await useFetch<{ movements: MovementRow[] }>(
  '/api/wms/movements',
  { default: () => ({ movements: [] }) },
)
const movements = computed(() => listData.value?.movements ?? [])

// ---- parts (populate the adjust <select>) ----------------------------------
interface PartLite {
  id: number
  sku: string
  name: string
}
const { data: partsData } = await useFetch<{ parts: PartLite[] }>('/api/parts', {
  default: () => ({ parts: [] }),
})
const parts = computed(() => partsData.value?.parts ?? [])

// ---- filters ---------------------------------------------------------------
const filterKind = ref<StockMovementKind | ''>('')
const filterWarehouse = ref('')

// Distinct warehouses derived from the loaded rows.
const warehouses = computed(() => {
  const set = new Set<string>()
  for (const m of movements.value) set.add(m.warehouse)
  return [...set].sort((a, b) => a.localeCompare(b))
})

const filtered = computed(() =>
  movements.value.filter(
    (m) =>
      (filterKind.value === '' || m.kind === filterKind.value) &&
      (filterWarehouse.value === '' || m.warehouse === filterWarehouse.value),
  ),
)

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
function partLabel(m: MovementRow): string {
  if (m.partSku && m.partName) return `${m.partSku} — ${m.partName}`
  return m.partSku ?? m.partName ?? `#${m.partId}`
}
function refLabel(m: MovementRow): string {
  if (!m.refType && !m.refId) return '—'
  return [m.refType, m.refId].filter(Boolean).join('/')
}

// ---- adjust modal ----------------------------------------------------------
const showAdjust = ref(false)
const adjPartId = ref<number | null>(null)
const adjWarehouse = ref('')
const adjQty = ref<number | null>(null)
const adjNote = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)

function openAdjust() {
  formError.value = null
  adjPartId.value = parts.value[0]?.id ?? null
  adjWarehouse.value = warehouses.value[0] ?? ''
  adjQty.value = null
  adjNote.value = ''
  showAdjust.value = true
}
function closeAdjust() {
  showAdjust.value = false
}

async function submit() {
  formError.value = null
  if (adjPartId.value == null || !adjWarehouse.value.trim() || !adjQty.value || adjQty.value === 0) {
    formError.value = t('movements.error')
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/wms/movements', {
      method: 'POST',
      body: {
        partId: adjPartId.value,
        warehouse: adjWarehouse.value.trim(),
        qty: Math.trunc(adjQty.value),
        note: adjNote.value.trim() || null,
      },
    })
    closeAdjust()
    await refresh()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    formError.value = msg || t('movements.error')
  } finally {
    submitting.value = false
  }
}

const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
</script>

<template>
  <div class="space-y-5">
    <AppCard :title="t('page.movements.title')">
      <template #actions>
        <AppButton v-if="canManage" size="sm" @click="openAdjust">
          {{ t('movements.adjustTitle') }}
        </AppButton>
      </template>

      <!-- filters -->
      <div class="mb-4 grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-muted">{{ t('movements.filterKind') }}</span>
          <select v-model="filterKind" :class="fld">
            <option value="">—</option>
            <option v-for="k in KINDS" :key="k" :value="k">{{ t(`movements.kind.${k}`) }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-muted">{{ t('movements.filterWarehouse') }}</span>
          <select v-model="filterWarehouse" :class="fld">
            <option value="">—</option>
            <option v-for="w in warehouses" :key="w" :value="w">{{ w }}</option>
          </select>
        </label>
      </div>

      <EmptyState v-if="!filtered.length" icon="📦" :title="t('movements.empty')" />
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-app text-xs text-muted">
              <th class="px-3 py-2 font-medium">{{ t('movements.date') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.part') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.warehouse') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.kind') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('movements.qty') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.ref') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.note') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('movements.by') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filtered" :key="m.id" class="border-b border-app/60">
              <td class="px-3 py-2 text-muted">{{ thaiDate(m.createdAt) }}</td>
              <td class="px-3 py-2 text-app">{{ partLabel(m) }}</td>
              <td class="px-3 py-2 text-app">{{ m.warehouse }}</td>
              <td class="px-3 py-2 text-app">{{ t(`movements.kind.${m.kind}`) }}</td>
              <td
                class="px-3 py-2 text-right font-semibold"
                :class="m.qty > 0 ? 'text-emerald-400' : 'text-rose-400'"
              >
                {{ m.qty > 0 ? `+${m.qty}` : m.qty }}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-muted">{{ refLabel(m) }}</td>
              <td class="px-3 py-2 text-muted">{{ m.note ?? '—' }}</td>
              <td class="px-3 py-2 text-muted">{{ m.createdBy ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- adjust modal -->
    <div
      v-if="showAdjust"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeAdjust"
    >
      <div class="w-full max-w-md rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">{{ t('movements.adjustTitle') }}</h2>
          <button class="text-muted hover:text-app" @click="closeAdjust">✕</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.part') }}</label>
            <select v-model.number="adjPartId" :class="fld">
              <option v-for="p in parts" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.warehouse') }}</label>
            <select v-if="warehouses.length" v-model="adjWarehouse" :class="fld">
              <option v-for="w in warehouses" :key="w" :value="w">{{ w }}</option>
            </select>
            <input v-else v-model="adjWarehouse" type="text" :class="fld">
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.adjustQty') }}</label>
            <input v-model.number="adjQty" type="number" :class="fld">
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('movements.adjustReason') }}</label>
            <input v-model="adjNote" type="text" :class="fld">
          </div>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="submitting" @click="closeAdjust">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="submitting" @click="submit">
              {{ submitting ? t('movements.posting') : t('movements.post') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
