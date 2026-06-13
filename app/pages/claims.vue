<script setup lang="ts">
// /claims — Dev3 owns. Left: scan VIN → purchase history → file claim.
//           Right: recent claims list with status badges.
import { statusLabel, thb } from '~/utils/labels'
import type { Claim } from '~/types'

const { t } = useI18n()

usePageTitle().set(t('page.claims.title'), t('claims.subtitle'))

interface PurchaseHistoryItem {
  orderId: number
  poNumber: string
  partId: number
  sku: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  createdAt: string
}
type ClaimRow = Claim & { partName?: string }

// ---- recent claims ---------------------------------------------------------
const { data: claimsData, refresh: refreshClaims } =
  await useFetch<{ claims: ClaimRow[] }>('/api/claims')
const claims = computed(() => claimsData.value?.claims ?? [])

// ---- VIN scan + purchase history ------------------------------------------
const vinInput = ref('')
const history = ref<PurchaseHistoryItem[] | null>(null)
const scanning = ref(false)
const scannedVin = ref('')

async function scan() {
  const vin = vinInput.value.trim()
  if (!vin) return
  scanning.value = true
  try {
    const res = await $fetch<{ vin: string; history: PurchaseHistoryItem[] }>('/api/claims', {
      query: { vin },
    })
    history.value = res.history
    scannedVin.value = vin
    selected.value = null
  } finally {
    scanning.value = false
  }
}

// ---- file-claim form -------------------------------------------------------
const selected = ref<PurchaseHistoryItem | null>(null)
const reason = ref('')
const submitting = ref(false)

async function fileClaim() {
  if (!selected.value || !reason.value.trim() || !scannedVin.value) return
  submitting.value = true
  try {
    await $fetch('/api/claims', {
      method: 'POST',
      body: { vin: scannedVin.value, partSku: selected.value.sku, reason: reason.value.trim() },
    })
    reason.value = ''
    selected.value = null
    await refreshClaims()
  } finally {
    submitting.value = false
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
}
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-2">
    <!-- LEFT: scan VIN → history → file claim -->
    <div class="space-y-5">
      <AppCard :title="t('claims.scan.title')">
        <form class="flex gap-2" @submit.prevent="scan">
          <input
            v-model="vinInput"
            :placeholder="t('claims.scan.placeholder')"
            class="code w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app outline-none focus:border-brand-600"
          >
          <AppButton type="submit" :disabled="scanning">{{ t('claims.scan.button') }}</AppButton>
        </form>

        <div v-if="history !== null" class="mt-4">
          <EmptyState
            v-if="!history.length"
            icon="🔍"
            :title="t('claims.scan.noHistory')"
          />
          <ul v-else class="space-y-2">
            <li
              v-for="item in history"
              :key="`${item.orderId}-${item.partId}`"
              class="cursor-pointer rounded-lg border bg-app p-3 transition"
              :class="selected?.partId === item.partId && selected?.orderId === item.orderId
                ? 'border-brand-600'
                : 'border-app hover:border-brand-600/50'"
              @click="selected = item"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-sm font-semibold text-app">{{ item.name }}</p>
                  <p class="code mt-0.5 text-xs text-muted">{{ item.sku }}</p>
                </div>
                <span class="text-sm font-semibold text-app">{{ thb(item.unitPrice) }}</span>
              </div>
              <p class="code mt-1 text-[11px] text-muted">
                {{ item.poNumber }} · {{ t('claims.history.qty') }} {{ item.qty }} · {{ fmtDate(item.createdAt) }}
              </p>
            </li>
          </ul>
        </div>
      </AppCard>

      <AppCard v-if="selected" :title="t('claims.file.title')" :subtitle="selected.name">
        <form class="space-y-3" @submit.prevent="fileClaim">
          <div class="rounded-lg border border-app bg-app p-3 text-sm">
            <p class="code text-xs text-muted">{{ selected.sku }} · {{ scannedVin }}</p>
            <p class="mt-1 font-semibold text-app">{{ selected.name }}</p>
          </div>
          <textarea
            v-model="reason"
            rows="3"
            :placeholder="t('claims.file.reason')"
            class="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app outline-none focus:border-brand-600"
          />
          <AppButton type="submit" :disabled="submitting || !reason.trim()" class="w-full">
            {{ t('claims.file.submit') }}
          </AppButton>
        </form>
      </AppCard>
    </div>

    <!-- RIGHT: recent claims -->
    <AppCard :title="t('claims.recent.title')">
      <template #actions>
        <DataPorter :export-url="'/api/claims/export'" :export-filename="'claims.xlsx'" />
      </template>
      <EmptyState v-if="!claims.length" icon="🛡" :title="t('claims.recent.empty')" />
      <div v-else class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <article
          v-for="c in claims"
          :key="c.id"
          class="rounded-xl border border-app bg-app p-4"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="code text-sm font-semibold text-app">{{ c.claimNumber }}</p>
              <p class="mt-0.5 text-sm text-app">
                {{ c.partName ?? c.partSku }}
                <span class="code text-xs text-muted">({{ c.partSku }})</span>
              </p>
            </div>
            <StatusBadge :status="c.status" :label="statusLabel(c.status)" />
          </div>
          <p class="mt-2 text-sm text-muted">{{ c.reason }}</p>
          <div class="mt-2 flex items-center justify-between text-xs">
            <span class="text-muted">{{ fmtDate(c.createdAt) }}</span>
            <span class="font-semibold text-app">{{ thb(c.amount) }}</span>
          </div>
        </article>
      </div>
    </AppCard>
  </div>
</template>
