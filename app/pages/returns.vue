<script setup lang="ts">
// /returns — Phase C (deferred RMA). Dealers (owner/sales) request returns
// against their own DELIVERED orders; admins approve/reject. Approval restocks
// the goods and releases the dealer's credit (handled server-side).
import { computed, reactive, ref } from 'vue'
import { thb, RETURN_STATUS_LABELS } from '~/utils/labels'
import type { OrderRow } from '~/../server/api/orders/index.get'
import type { OrderDetail, OrderLineRow } from '~/../server/api/orders/[id].get'
import type { ReturnRow } from '~/../server/api/returns/index.get'
import type { ReturnStatus } from '~/types'

const { t } = useI18n()
const { role } = useAuth()

usePageTitle().set(t('page.returns.title'), t('page.returns.subtitle'))

const isDealer = computed(() => role.value === 'owner' || role.value === 'sales')
const isAdmin = computed(() => role.value === 'admin')

// ---- returns list ----------------------------------------------------------
const { data: listData, refresh } = await useFetch<{ returns: ReturnRow[] }>('/api/returns', {
  default: () => ({ returns: [] }),
})
const returns = computed(() => listData.value?.returns ?? [])

const columns = computed(() => {
  const base = [
    { key: 'rmaNumber', label: t('returns.col.rma'), mono: true },
    { key: 'poNumber', label: t('returns.col.po'), mono: true },
    { key: 'dealerName', label: t('returns.col.dealer') },
    { key: 'itemsCount', label: t('returns.col.items'), align: 'right' as const },
    { key: 'refundAmount', label: t('returns.col.refund'), align: 'right' as const },
    { key: 'status', label: t('returns.col.status') },
    { key: 'createdAt', label: t('returns.col.date') },
  ]
  if (isAdmin.value) base.push({ key: 'actions', label: t('returns.col.actions'), align: 'right' as const })
  return base
})

const rows = computed(() =>
  returns.value.map((r) => ({
    ...r,
    itemsCount: r.items.reduce((s, it) => s + it.qty, 0),
  })),
)

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
function statusLabelFor(s: string): string {
  return RETURN_STATUS_LABELS[s as ReturnStatus] ?? s
}

// ---- admin decision --------------------------------------------------------
const deciding = ref<number | null>(null)
const decisionError = ref<string | null>(null)
async function decide(id: number, decision: 'approve' | 'reject') {
  deciding.value = id
  decisionError.value = null
  try {
    await $fetch(`/api/returns/${id}/decision`, { method: 'POST', body: { decision } })
    await refresh()
  } catch {
    decisionError.value = t('returns.decision.error')
  } finally {
    deciding.value = null
  }
}

// ---- dealer: new return request --------------------------------------------
const { data: ordersData } = await useFetch<{ orders: OrderRow[] }>('/api/orders', {
  default: () => ({ orders: [] }),
  immediate: isDealer.value,
})
const deliveredOrders = computed(() =>
  (ordersData.value?.orders ?? []).filter((o) => o.status === 'delivered'),
)

const selectedOrderId = ref<number | null>(null)
const detail = ref<OrderDetail | null>(null)
const qty = reactive<Record<number, number>>({})
const reason = ref('')
const submitting = ref(false)
const toast = ref<string | null>(null)
const formError = ref<string | null>(null)

async function onSelectOrder() {
  detail.value = null
  // Clear stale per-part quantities from the previously selected order. Deleting
  // computed keys off a Vue reactive() is intentional and reactivity-safe here.
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  for (const k of Object.keys(qty)) delete qty[Number(k)]
  if (!selectedOrderId.value) return
  detail.value = await $fetch<OrderDetail>(`/api/orders/${selectedOrderId.value}`)
  for (const it of detail.value.items) qty[it.partId] = 0
}

function clampQty(it: OrderLineRow) {
  const v = Math.max(0, Math.min(it.qty, Math.floor(qty[it.partId] || 0)))
  qty[it.partId] = v
}

// Mirror the server's refund math (computeOrderMoney with the order's own
// effective discount % and VAT %) so the estimate matches the booked refund.
const estRefund = computed(() => {
  if (!detail.value) return 0
  const o = detail.value.order
  const sub = detail.value.items.reduce((s, it) => s + it.unitPrice * (qty[it.partId] || 0), 0)
  if (sub <= 0) return 0
  const net0 = o.subtotal - o.discount
  const discountPct = o.subtotal > 0 ? (o.discount / o.subtotal) * 100 : 0
  const vatRate = net0 > 0 ? (o.vat / net0) * 100 : 0
  const discount = Math.round((sub * discountPct) / 100)
  const net = sub - discount
  const vat = Math.round((net * vatRate) / 100)
  return Math.min(net + vat, o.totalValue)
})

const selectedLines = computed(() =>
  Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([partId, q]) => ({ partId: Number(partId), qty: q })),
)

async function submitRequest() {
  formError.value = null
  if (!selectedOrderId.value || !selectedLines.value.length) {
    formError.value = t('returns.request.pickAtLeastOne')
    return
  }
  if (!reason.value.trim()) return
  submitting.value = true
  try {
    const res = await $fetch<{ rmaNumber: string }>('/api/returns', {
      method: 'POST',
      body: {
        orderId: selectedOrderId.value,
        reason: reason.value.trim(),
        items: selectedLines.value,
      },
    })
    toast.value = `${t('returns.request.success')} ${res.rmaNumber}`
    // reset
    selectedOrderId.value = null
    detail.value = null
    reason.value = ''
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    for (const k of Object.keys(qty)) delete qty[Number(k)]
    await refresh()
    setTimeout(() => (toast.value = null), 4000)
  } catch {
    formError.value = t('returns.request.error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- dealer: request form -->
    <AppCard v-if="isDealer" :title="t('returns.request.title')">
      <EmptyState
        v-if="!deliveredOrders.length"
        icon="📦"
        :title="t('returns.request.noDelivered')"
      />
      <div v-else class="space-y-4">
        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('returns.request.selectOrder') }}</span>
          <select
            v-model.number="selectedOrderId"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            @change="onSelectOrder"
          >
            <option :value="null">{{ t('returns.request.orderPlaceholder') }}</option>
            <option v-for="o in deliveredOrders" :key="o.id" :value="o.id">
              {{ o.poNumber }} — {{ thb(o.totalValue) }}
            </option>
          </select>
        </label>

        <div v-if="detail" class="space-y-3">
          <p class="text-sm font-semibold text-app">{{ t('returns.request.items') }}</p>
          <div
            v-for="it in detail.items"
            :key="it.partId"
            class="flex items-center justify-between gap-3 rounded-xl border border-app bg-surface-2/40 p-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-app">{{ it.name }}</p>
              <p class="code text-xs text-muted">{{ it.sku }} · {{ thb(it.unitPrice) }}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-muted">{{ t('returns.request.ordered') }} {{ it.qty }}</span>
              <input
                v-model.number="qty[it.partId]"
                type="number"
                min="0"
                :max="it.qty"
                class="w-20 rounded-lg border border-app bg-surface px-2 py-1 text-right text-sm text-app"
                @input="clampQty(it)"
              >
            </div>
          </div>

          <label class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('returns.request.reason') }}</span>
            <textarea
              v-model="reason"
              rows="2"
              :placeholder="t('returns.request.reasonPlaceholder')"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            />
          </label>

          <div class="flex items-center justify-between border-t border-app pt-3">
            <span class="text-sm text-muted">{{ t('returns.request.estRefund') }}</span>
            <span class="text-lg font-bold text-app">{{ thb(estRefund) }}</span>
          </div>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <AppButton
            class="w-full"
            :disabled="submitting || !selectedLines.length || !reason.trim()"
            @click="submitRequest"
          >
            {{ t('returns.request.submit') }}
          </AppButton>
        </div>
      </div>
    </AppCard>

    <!-- returns list -->
    <AppCard :title="t('returns.list.title')">
      <template #actions>
        <DataPorter :export-url="'/api/returns/export'" :export-filename="'returns.xlsx'" />
      </template>
      <EmptyState v-if="!rows.length" icon="↩" :title="t('returns.list.empty')" />
      <template v-else>
        <p v-if="decisionError" class="mb-3 text-xs text-rose-400">{{ decisionError }}</p>
        <DataTable :columns="columns" :rows="rows">
          <template #cell-status="{ value }">
            <StatusBadge :status="value" :label="statusLabelFor(value)" />
          </template>
          <template #cell-refundAmount="{ value }">{{ thb(value) }}</template>
          <template #cell-createdAt="{ value }">{{ thaiDate(value) }}</template>
          <template #cell-poNumber="{ value }">{{ value ?? '—' }}</template>
          <template #cell-dealerName="{ value }">{{ value ?? '—' }}</template>
          <template v-if="isAdmin" #cell-actions="{ row }">
            <div v-if="row.status === 'requested'" class="flex justify-end gap-2">
              <AppButton
                size="sm"
                :disabled="deciding === row.id"
                @click="decide(row.id, 'approve')"
              >
                {{ t('returns.action.approve') }}
              </AppButton>
              <AppButton
                size="sm"
                variant="outline"
                :disabled="deciding === row.id"
                @click="decide(row.id, 'reject')"
              >
                {{ t('returns.action.reject') }}
              </AppButton>
            </div>
            <span v-else class="text-muted">—</span>
          </template>
        </DataTable>
      </template>
    </AppCard>

    <!-- success toast -->
    <AppToast :message="toast" />
  </div>
</template>
