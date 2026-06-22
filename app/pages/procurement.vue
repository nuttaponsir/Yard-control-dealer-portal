<script setup lang="ts">
// /procurement — Phase 5. Procurement / goods-receipt board (admin/warehouse).
// List purchase orders, create a new PO to a supplier, and receive goods into
// the destination warehouse. UI text is Thai via i18n keys.
import { thb } from '~/utils/labels'
import type { PurchaseOrder, PurchaseOrderStatus, PurchaseOrderItem } from '~/types'

const { t } = useI18n()
usePageTitle().set(t('page.procurement.title'), t('page.procurement.subtitle'))

interface PoListRow extends PurchaseOrder {
  supplierName: string
  itemCount: number
}
interface PoItemRow extends PurchaseOrderItem {
  partSku: string
  partName: string
}
interface SupplierLite {
  id: number
  code: string
  name: string
}
interface PartLite {
  id: number
  sku: string
  name: string
  price: number
}

// ---- list ------------------------------------------------------------------
const orders = ref<PoListRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

function readErr(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage || err?.statusMessage || t('procurement.error')
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ purchaseOrders: PoListRow[] }>('/api/procurement')
    orders.value = res.purchaseOrders
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    loading.value = false
  }
}

// ---- reference data (suppliers + parts) ------------------------------------
const suppliers = ref<SupplierLite[]>([])
const parts = ref<PartLite[]>([])

async function loadRefs() {
  try {
    // Dedicated procurement endpoint (admin + warehouse), not the admin-only master.
    const res = await $fetch<{ suppliers: SupplierLite[] }>('/api/procurement/suppliers')
    suppliers.value = res.suppliers ?? []
  } catch {
    suppliers.value = []
  }
  try {
    const res = await $fetch<{ parts: PartLite[] }>('/api/parts')
    parts.value = res.parts ?? []
  } catch {
    parts.value = []
  }
}

onMounted(() => {
  load()
  loadRefs()
})

const statusLabel = (s: PurchaseOrderStatus) => t(`procurement.status.${s}`)

// ---- create modal ----------------------------------------------------------
interface ItemRow {
  partId: number | null
  qtyOrdered: number | null
  unitCost: number | null
}
function emptyItem(): ItemRow {
  return { partId: null, qtyOrdered: 1, unitCost: 0 }
}
const form = reactive<{
  supplierId: number | null
  warehouse: string
  note: string
  expectedAt: string
  items: ItemRow[]
}>({
  supplierId: null,
  warehouse: '',
  note: '',
  expectedAt: '',
  items: [emptyItem()],
})
const showForm = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

function openCreate() {
  form.supplierId = suppliers.value[0]?.id ?? null
  form.warehouse = ''
  form.note = ''
  form.expectedAt = ''
  form.items = [emptyItem()]
  formError.value = null
  showForm.value = true
}
function closeForm() {
  showForm.value = false
}
const WAREHOUSES = ['คลังกรุงเทพ', 'คลังเชียงใหม่']

function addItem() {
  form.items.push(emptyItem())
}

// #6 — prefill the item list from parts below their reorder point in the
// selected warehouse (suggested top-up qty + part price as cost proxy).
async function fillFromLowStock() {
  formError.value = null
  if (!form.warehouse.trim()) {
    formError.value = t('procurement.pickWarehouseFirst')
    return
  }
  try {
    const res = await $fetch<{ items: { partId: number; suggestedQty: number; unitCost: number }[] }>(
      `/api/procurement/reorder?warehouse=${encodeURIComponent(form.warehouse.trim())}`,
    )
    if (!res.items.length) {
      formError.value = t('procurement.noLowStock')
      return
    }
    form.items = res.items.map((it) => ({
      partId: it.partId,
      qtyOrdered: it.suggestedQty,
      unitCost: it.unitCost,
    }))
  } catch (e: unknown) {
    formError.value = readErr(e)
  }
}
function removeItem(i: number) {
  if (form.items.length > 1) form.items.splice(i, 1)
}

const formTotal = computed(() =>
  form.items.reduce((sum, it) => sum + (it.qtyOrdered ?? 0) * (it.unitCost ?? 0), 0),
)

async function save() {
  saving.value = true
  formError.value = null
  try {
    const items = form.items
      .filter((it) => it.partId != null)
      .map((it) => ({
        partId: Number(it.partId),
        qtyOrdered: Number(it.qtyOrdered ?? 0),
        unitCost: Number(it.unitCost ?? 0),
      }))
    const body = {
      supplierId: Number(form.supplierId),
      warehouse: form.warehouse.trim(),
      note: form.note.trim() === '' ? null : form.note.trim(),
      expectedAt: form.expectedAt.trim() === '' ? null : form.expectedAt.trim(),
      items,
    }
    await $fetch('/api/procurement', { method: 'POST', body })
    showForm.value = false
    await load()
  } catch (e: unknown) {
    formError.value = readErr(e)
  } finally {
    saving.value = false
  }
}

// ---- detail / receive ------------------------------------------------------
const showDetail = ref(false)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const receiving = ref(false)
interface PoDetail {
  purchaseOrder: PurchaseOrder
  supplierName: string
  items: PoItemRow[]
}
const detail = ref<PoDetail | null>(null)

async function openDetail(po: PoListRow) {
  showDetail.value = true
  detailLoading.value = true
  detailError.value = null
  detail.value = null
  try {
    detail.value = await $fetch<PoDetail>(`/api/procurement/${po.id}`)
  } catch (e: unknown) {
    detailError.value = readErr(e)
  } finally {
    detailLoading.value = false
  }
}
function closeDetail() {
  showDetail.value = false
  detail.value = null
}

const canReceive = computed(() => {
  const s = detail.value?.purchaseOrder.status
  return s != null && s !== 'received' && s !== 'cancelled'
})

async function receiveAll() {
  if (!detail.value) return
  receiving.value = true
  detailError.value = null
  try {
    await $fetch(`/api/procurement/${detail.value.purchaseOrder.id}/receive`, { method: 'POST' })
    // refresh both the detail and the list
    detail.value = await $fetch<PoDetail>(`/api/procurement/${detail.value.purchaseOrder.id}`)
    await load()
  } catch (e: unknown) {
    detailError.value = readErr(e)
  } finally {
    receiving.value = false
  }
}

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'

const statusClass = (s: PurchaseOrderStatus) => {
  switch (s) {
    case 'received':
      return 'bg-emerald-600/20 text-emerald-300'
    case 'partial':
      return 'bg-amber-600/20 text-amber-300'
    case 'cancelled':
      return 'bg-rose-600/20 text-rose-300'
    case 'ordered':
      return 'bg-brand-600/20 text-brand-300'
    default:
      return 'bg-surface-2 text-muted'
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- toolbar -->
    <div class="flex items-center justify-end">
      <AppButton size="sm" @click="openCreate">+ {{ t('procurement.create') }}</AppButton>
    </div>

    <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

    <EmptyState v-if="!loading && orders.length === 0" icon="🚚" :title="t('procurement.empty')" />

    <!-- PO list -->
    <div v-else class="overflow-x-auto rounded-2xl border border-app bg-surface">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-muted">
          <tr class="border-b border-app">
            <th class="px-4 py-2.5">{{ t('procurement.poNumber') }}</th>
            <th class="px-4 py-2.5">{{ t('procurement.supplier') }}</th>
            <th class="px-4 py-2.5">{{ t('procurement.warehouse') }}</th>
            <th class="px-4 py-2.5">{{ t('procurement.status') }}</th>
            <th class="px-4 py-2.5 text-right">{{ t('procurement.total') }}</th>
            <th class="px-4 py-2.5 text-right">{{ t('procurement.items') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="po in orders"
            :key="po.id"
            class="cursor-pointer border-b border-app/60 hover:bg-surface-2"
            @click="openDetail(po)"
          >
            <td class="px-4 py-2.5 font-medium text-app">{{ po.poNumber }}</td>
            <td class="px-4 py-2.5 text-app">{{ po.supplierName }}</td>
            <td class="px-4 py-2.5 text-muted">{{ po.warehouse }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded-full px-2 py-0.5 text-[11px]" :class="statusClass(po.status)">
                {{ statusLabel(po.status) }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-right text-app">{{ thb(po.totalCost) }}</td>
            <td class="px-4 py-2.5 text-right text-muted">{{ po.itemCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- create drawer -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeForm"
    >
      <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">{{ t('procurement.create') }}</h2>
          <button class="text-muted hover:text-app" @click="closeForm">✕</button>
        </div>

        <div class="space-y-3">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('procurement.supplier') }}</label>
              <select v-model.number="form.supplierId" :class="fld">
                <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('procurement.warehouse') }}</label>
              <select v-model="form.warehouse" :class="fld">
                <option value="" disabled>—</option>
                <option v-for="w in WAREHOUSES" :key="w" :value="w">{{ w }}</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('procurement.expected') }}</label>
              <input v-model="form.expectedAt" type="date" :class="fld">
            </div>
          </div>

          <!-- item rows -->
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('procurement.items') }}</label>
            <div class="space-y-2">
              <div v-for="(it, i) in form.items" :key="i" class="flex items-center gap-2">
                <select v-model.number="it.partId" :class="fld" class="flex-1">
                  <option :value="null" disabled>{{ t('procurement.part') }}</option>
                  <option v-for="p in parts" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
                </select>
                <input
                  v-model.number="it.qtyOrdered"
                  type="number"
                  min="1"
                  :placeholder="t('procurement.qtyOrdered')"
                  :class="fld"
                  class="w-24"
                >
                <input
                  v-model.number="it.unitCost"
                  type="number"
                  min="0"
                  :placeholder="t('procurement.unitCost')"
                  :class="fld"
                  class="w-32"
                >
                <button
                  class="shrink-0 text-muted hover:text-rose-400"
                  :disabled="form.items.length <= 1"
                  @click="removeItem(i)"
                >
                  ✕
                </button>
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <AppButton variant="outline" size="sm" @click="addItem">+ {{ t('procurement.items') }}</AppButton>
              <AppButton variant="outline" size="sm" @click="fillFromLowStock">📉 {{ t('procurement.fromLowStock') }}</AppButton>
            </div>
          </div>

          <div class="flex justify-between border-t border-app pt-2 text-sm">
            <span class="text-muted">{{ t('procurement.total') }}</span>
            <span class="font-semibold text-app">{{ thb(formTotal) }}</span>
          </div>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="saving" @click="closeForm">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="saving" @click="save">{{ t('common.save') }}</AppButton>
          </div>
        </div>
      </div>
    </div>

    <!-- detail drawer -->
    <div
      v-if="showDetail"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeDetail"
    >
      <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">
            {{ detail?.purchaseOrder.poNumber ?? t('procurement.poNumber') }}
          </h2>
          <button class="text-muted hover:text-app" @click="closeDetail">✕</button>
        </div>

        <p v-if="detailLoading" class="text-sm text-muted">…</p>
        <p v-if="detailError" class="text-xs text-rose-400">{{ detailError }}</p>

        <div v-if="detail" class="space-y-4">
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div><span class="text-muted">{{ t('procurement.supplier') }}: </span><span class="text-app">{{ detail.supplierName }}</span></div>
            <div><span class="text-muted">{{ t('procurement.warehouse') }}: </span><span class="text-app">{{ detail.purchaseOrder.warehouse }}</span></div>
            <div>
              <span class="text-muted">{{ t('procurement.status') }}: </span>
              <span class="rounded-full px-2 py-0.5 text-[11px]" :class="statusClass(detail.purchaseOrder.status)">
                {{ statusLabel(detail.purchaseOrder.status) }}
              </span>
            </div>
            <div><span class="text-muted">{{ t('procurement.total') }}: </span><span class="text-app">{{ thb(detail.purchaseOrder.totalCost) }}</span></div>
          </div>

          <div class="overflow-x-auto rounded-xl border border-app">
            <table class="w-full text-sm">
              <thead class="text-left text-xs text-muted">
                <tr class="border-b border-app">
                  <th class="px-3 py-2">{{ t('procurement.part') }}</th>
                  <th class="px-3 py-2 text-right">{{ t('procurement.qtyOrdered') }}</th>
                  <th class="px-3 py-2 text-right">{{ t('procurement.qtyReceived') }}</th>
                  <th class="px-3 py-2 text-right">{{ t('procurement.unitCost') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in detail.items" :key="it.id" class="border-b border-app/60">
                  <td class="px-3 py-2 text-app">{{ it.partSku }} — {{ it.partName }}</td>
                  <td class="px-3 py-2 text-right text-app">{{ it.qtyOrdered }}</td>
                  <td class="px-3 py-2 text-right text-app">{{ it.qtyReceived }}</td>
                  <td class="px-3 py-2 text-right text-muted">{{ thb(it.unitCost) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="canReceive" class="flex justify-end">
            <AppButton size="sm" :disabled="receiving" @click="receiveAll">
              {{ t('procurement.receiveAll') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
