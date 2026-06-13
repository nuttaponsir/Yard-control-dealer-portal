<script setup lang="ts">
// /warehouse — Dev3 owns. Warehouse fulfillment board (Kanban) + summary tabs.
import { ORDER_STATUS_ORDER, ORDER_STATUS_LABELS, statusLabel, thb } from '~/utils/labels'
import type { OrderStatus } from '~/types'

const { t } = useI18n()

usePageTitle().set(t('page.warehouse.title'), t('warehouse.subtitle'))

interface FulfillmentCard {
  id: number
  poNumber: string
  dealerName: string
  vin: string | null
  status: OrderStatus
  totalValue: number
  trackingNo: string | null
  carrier: string | null
  createdAt: string
}
interface Column {
  status: OrderStatus
  orders: FulfillmentCard[]
}

const { data, refresh, pending } = await useFetch<{ columns: Column[] }>('/api/warehouse')
const columns = computed(() => data.value?.columns ?? [])

// next status + its action label per column (none for the final 'delivered')
const NEXT_ACTION = computed<Partial<Record<OrderStatus, string | null>>>(() => ({
  pending: t('warehouse.action.confirm'),
  confirming: t('warehouse.action.startPack'),
  packing: t('warehouse.action.ship'),
  shipped: t('warehouse.action.confirmReceive'),
  delivered: null,
}))
function nextStatus(s: OrderStatus): OrderStatus | null {
  const i = ORDER_STATUS_ORDER.indexOf(s)
  return i >= 0 && i < ORDER_STATUS_ORDER.length - 1 ? ORDER_STATUS_ORDER[i + 1]! : null
}

const moving = ref<number | null>(null)
const trackingOpen = ref<number | null>(null)
function toggleTracking(id: number) {
  trackingOpen.value = trackingOpen.value === id ? null : id
}
async function advance(card: FulfillmentCard) {
  const next = nextStatus(card.status)
  if (!next) return
  moving.value = card.id
  try {
    await $fetch(`/api/warehouse/${card.id}`, { method: 'PATCH', body: { status: next } })
    await refresh()
  } finally {
    moving.value = null
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
}

// ---- tabs ------------------------------------------------------------------
type TabKey = 'board' | 'dashboard' | 'pick' | 'pack' | 'stock'
const tabs = computed<{ key: TabKey; label: string }[]>(() => [
  { key: 'board', label: t('warehouse.tab.board') },
  { key: 'dashboard', label: t('warehouse.tab.dashboard') },
  { key: 'pick', label: t('warehouse.tab.pick') },
  { key: 'pack', label: t('warehouse.tab.pack') },
  { key: 'stock', label: t('warehouse.tab.stock') },
])
const tab = ref<TabKey>('board')

const allCards = computed(() => columns.value.flatMap((c) => c.orders))
function countOf(s: OrderStatus) {
  return columns.value.find((c) => c.status === s)?.orders.length ?? 0
}
const totalValueAll = computed(() => allCards.value.reduce((s, c) => s + c.totalValue, 0))
const pickList = computed(() => allCards.value.filter((c) => c.status === 'confirming' || c.status === 'packing'))
const packShip = computed(() => allCards.value.filter((c) => c.status === 'packing' || c.status === 'shipped'))
</script>

<template>
  <div class="space-y-5">
    <!-- tab bar -->
    <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-app bg-surface p-1.5">
      <button
        v-for="tb in tabs"
        :key="tb.key"
        class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
        :class="tab === tb.key ? 'bg-brand-600 text-white' : 'text-muted hover:bg-surface-2 hover:text-app'"
        @click="tab = tb.key"
      >
        {{ tb.label }}
      </button>
      <div class="ml-auto">
        <DataPorter :export-url="'/api/warehouse/export'" :export-filename="'warehouse.xlsx'" />
      </div>
    </div>

    <!-- BOARD -->
    <div v-if="tab === 'board'" class="grid gap-3 md:grid-cols-5">
      <div
        v-for="col in columns"
        :key="col.status"
        class="rounded-xl border border-app bg-app p-3"
      >
        <div class="mb-3 flex items-center justify-between">
          <p class="text-xs font-semibold text-muted">{{ ORDER_STATUS_LABELS[col.status] }}</p>
          <span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-app">
            {{ col.orders.length }}
          </span>
        </div>

        <div class="space-y-2">
          <article
            v-for="card in col.orders"
            :key="card.id"
            class="rounded-lg border border-app bg-surface p-3"
          >
            <p class="code text-sm font-semibold text-app">{{ card.poNumber }}</p>
            <p class="mt-0.5 truncate text-xs text-muted">{{ card.dealerName }}</p>
            <div class="mt-2 flex items-center justify-between text-xs">
              <span class="text-muted">{{ fmtDate(card.createdAt) }}</span>
              <span class="font-semibold text-app">{{ thb(card.totalValue) }}</span>
            </div>
            <p v-if="card.trackingNo" class="code mt-1 text-[11px] text-muted">
              {{ card.carrier }} · {{ card.trackingNo }}
            </p>
            <button
              v-if="card.trackingNo"
              class="mt-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200"
              @click="toggleTracking(card.id)"
            >
              {{ trackingOpen === card.id ? t('tracking.hide') : t('tracking.view') }}
            </button>
            <OrderTracking v-if="trackingOpen === card.id" :order-id="card.id" />
            <AppButton
              v-if="NEXT_ACTION[col.status]"
              size="sm"
              class="mt-3 w-full"
              :disabled="moving === card.id"
              @click="advance(card)"
            >
              {{ NEXT_ACTION[col.status] }}
            </AppButton>
            <!-- NEXT_ACTION is a computed ref; auto-unwrapped in template -->
          </article>

          <div
            v-if="!col.orders.length"
            class="grid place-items-center rounded-lg border border-dashed border-app py-8 text-xs text-muted"
          >
            {{ t('warehouse.empty') }}
          </div>
        </div>
      </div>
    </div>

    <!-- WAREHOUSE DASHBOARD -->
    <div v-else-if="tab === 'dashboard'" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <AppCard v-for="s in ORDER_STATUS_ORDER" :key="s" :title="ORDER_STATUS_LABELS[s]">
        <p class="text-3xl font-bold text-app">{{ countOf(s) }}</p>
        <p class="mt-1 text-xs text-muted">{{ t('warehouse.orders') }}</p>
      </AppCard>
      <AppCard :title="t('warehouse.totalValue.title')">
        <p class="text-3xl font-bold text-app">{{ thb(totalValueAll) }}</p>
        <p class="mt-1 text-xs text-muted">{{ allCards.length }} {{ t('warehouse.orders') }}</p>
      </AppCard>
    </div>

    <!-- PICK LIST -->
    <AppCard v-else-if="tab === 'pick'" :title="t('warehouse.pick.title')" :subtitle="t('warehouse.pick.subtitle')">
      <DataTable
        :columns="[
          { key: 'poNumber', label: t('th.po'), mono: true },
          { key: 'dealerName', label: t('th.dealer') },
          { key: 'status', label: t('th.status') },
          { key: 'totalValue', label: t('th.value'), align: 'right' },
        ]"
        :rows="pickList"
      >
        <template #cell-status="{ value }"><StatusBadge :status="value" /></template>
        <template #cell-totalValue="{ value }">{{ thb(value) }}</template>
      </DataTable>
    </AppCard>

    <!-- PACK & SHIP -->
    <AppCard v-else-if="tab === 'pack'" :title="t('warehouse.pack.title')" :subtitle="t('warehouse.pack.subtitle')">
      <DataTable
        :columns="[
          { key: 'poNumber', label: t('th.po'), mono: true },
          { key: 'dealerName', label: t('th.dealer') },
          { key: 'carrier', label: t('warehouse.col.carrier') },
          { key: 'trackingNo', label: t('th.tracking'), mono: true },
          { key: 'status', label: t('th.status') },
        ]"
        :rows="packShip"
      >
        <template #cell-status="{ value }"><StatusBadge :status="value" /></template>
        <template #cell-trackingNo="{ value }">{{ value ?? '—' }}</template>
        <template #cell-carrier="{ value }">{{ value ?? '—' }}</template>
      </DataTable>
    </AppCard>

    <!-- STOCK / BIN -->
    <AppCard v-else :title="t('warehouse.stock.title')" :subtitle="t('warehouse.stock.subtitle')">
      <ul class="divide-y divide-app">
        <li
          v-for="s in ORDER_STATUS_ORDER"
          :key="s"
          class="flex items-center justify-between py-2.5 text-sm"
        >
          <span class="text-app">{{ statusLabel(s) }}</span>
          <span class="font-semibold text-app">{{ countOf(s) }}</span>
        </li>
      </ul>
    </AppCard>

    <p v-if="pending" class="text-center text-xs text-muted">{{ t('common.loadingEllipsis') }}</p>
  </div>
</template>
