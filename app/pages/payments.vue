<script setup lang="ts">
// /payments — Phase G (Accounts Receivable). admin/owner record money received
// from a dealer; posting a payment releases the dealer's credit (server-side)
// and, when applied to an order, advances that order's payment status.
// owner/sales are scoped to their own dealer by the API; admin sees all.
import { computed, ref } from 'vue'
import { thb } from '~/utils/labels'
import type { PaymentRow } from '~/../server/api/payments/index.get'
import type { OrderRow } from '~/../server/api/orders/index.get'
import type { Dealer, PaymentMethod } from '~/types'

const { t } = useI18n()
const { role, user } = useAuth()

usePageTitle().set(t('page.payments.title'), t('page.payments.subtitle'))

const isAdmin = computed(() => role.value === 'admin')
// admin + owner may post payments; sales is read-only.
const canRecord = computed(() => role.value === 'admin' || role.value === 'owner')

// ---- payments list ---------------------------------------------------------
const { data: listData, refresh } = await useFetch<{ payments: PaymentRow[] }>('/api/payments', {
  default: () => ({ payments: [] }),
})
const payments = computed(() => listData.value?.payments ?? [])

const columns = computed(() => {
  const base = [
    { key: 'receiptNo', label: t('payments.col.receipt'), mono: true },
    { key: 'dealerName', label: t('payments.col.dealer') },
    { key: 'poNumber', label: t('payments.col.po'), mono: true },
    { key: 'amount', label: t('payments.col.amount'), align: 'right' as const },
    { key: 'method', label: t('payments.col.method') },
    { key: 'reference', label: t('payments.col.reference'), mono: true },
    { key: 'receivedAt', label: t('payments.col.date') },
  ]
  return base
})

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
function methodLabel(m: string): string {
  return t(`payments.method.${m}`)
}

// ---- dealers (admin chooses; owner is pinned to its own) -------------------
const { data: dealersData } = await useFetch<{ dealers: Dealer[] }>('/api/dealers', {
  default: () => ({ dealers: [] }),
  immediate: isAdmin.value,
})
const dealers = computed(() => dealersData.value?.dealers ?? [])

// ---- record-payment form ---------------------------------------------------
const formDealerId = ref<number | null>(isAdmin.value ? null : (user.value?.dealerId ?? null))
const formOrderId = ref<number | null>(null)
const amount = ref<number | null>(null)
const method = ref<PaymentMethod>('transfer')
const reference = ref('')
const note = ref('')
const submitting = ref(false)
const toast = ref<string | null>(null)
const formError = ref<string | null>(null)

const METHODS: PaymentMethod[] = ['transfer', 'cash', 'cheque', 'card']

// Outstanding orders for the chosen dealer (to optionally apply against).
const { data: ordersData } = await useFetch<{ orders: OrderRow[] }>('/api/orders', {
  default: () => ({ orders: [] }),
})
const outstandingOrders = computed(() => {
  const did = formDealerId.value
  if (did == null) return []
  return (ordersData.value?.orders ?? []).filter(
    (o) => o.dealerId === did && o.status !== 'cancelled' && o.totalValue - o.amountPaid > 0,
  )
})

function outstandingOf(o: OrderRow): number {
  return o.totalValue - o.amountPaid
}

async function submit() {
  formError.value = null
  if (formDealerId.value == null || !amount.value || amount.value <= 0) {
    formError.value = t('payments.record.error')
    return
  }
  submitting.value = true
  try {
    const res = await $fetch<{ receiptNo: string }>('/api/payments', {
      method: 'POST',
      body: {
        dealerId: formDealerId.value,
        orderId: formOrderId.value,
        amount: Math.floor(amount.value),
        method: method.value,
        reference: reference.value.trim() || null,
        note: note.value.trim() || null,
      },
    })
    toast.value = `${t('payments.record.success')} ${res.receiptNo}`
    // reset (keep dealer for admins posting several receipts)
    formOrderId.value = null
    amount.value = null
    reference.value = ''
    note.value = ''
    await refresh()
    setTimeout(() => (toast.value = null), 4000)
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    formError.value = msg || t('payments.record.error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- record payment form -->
    <AppCard v-if="canRecord" :title="t('payments.record.title')">
      <div class="grid gap-4 md:grid-cols-2">
        <label v-if="isAdmin" class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.dealer') }}</span>
          <select
            v-model.number="formDealerId"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            @change="formOrderId = null"
          >
            <option :value="null">{{ t('payments.record.dealerPlaceholder') }}</option>
            <option v-for="d in dealers" :key="d.id" :value="d.id">
              {{ d.code }} — {{ d.name }}
            </option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.order') }}</span>
          <select
            v-model.number="formOrderId"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
          >
            <option :value="null">{{ t('payments.record.orderPlaceholder') }}</option>
            <option v-for="o in outstandingOrders" :key="o.id" :value="o.id">
              {{ o.poNumber }} — {{ t('payments.col.amount') }} {{ thb(outstandingOf(o)) }}
            </option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.amount') }}</span>
          <input
            v-model.number="amount"
            type="number"
            min="1"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-right text-sm text-app"
          >
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.method') }}</span>
          <select
            v-model="method"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
          >
            <option v-for="m in METHODS" :key="m" :value="m">{{ t(`payments.method.${m}`) }}</option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.reference') }}</span>
          <input
            v-model="reference"
            type="text"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
          >
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-muted">{{ t('payments.record.note') }}</span>
          <input
            v-model="note"
            type="text"
            class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
          >
        </label>
      </div>

      <p v-if="formError" class="mt-3 text-xs text-rose-400">{{ formError }}</p>

      <AppButton
        class="mt-4"
        :disabled="submitting || formDealerId == null || !amount || amount <= 0"
        @click="submit"
      >
        {{ t('payments.record.submit') }}
      </AppButton>
    </AppCard>

    <!-- payments list -->
    <AppCard :title="t('payments.list.title')">
      <template #actions>
        <DataPorter :export-url="'/api/payments/export'" :export-filename="'payments.xlsx'" />
      </template>
      <EmptyState v-if="!payments.length" icon="💰" :title="t('payments.list.empty')" />
      <DataTable v-else :columns="columns" :rows="payments">
        <template #cell-amount="{ value }">{{ thb(value) }}</template>
        <template #cell-method="{ value }">{{ methodLabel(value) }}</template>
        <template #cell-receivedAt="{ value }">{{ thaiDate(value) }}</template>
        <template #cell-poNumber="{ value }">{{ value ?? '—' }}</template>
        <template #cell-dealerName="{ value }">{{ value ?? '—' }}</template>
        <template #cell-reference="{ value }">{{ value ?? '—' }}</template>
      </DataTable>
    </AppCard>

    <!-- success toast -->
    <div
      v-if="toast"
      class="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
