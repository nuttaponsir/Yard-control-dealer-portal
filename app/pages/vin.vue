<script setup lang="ts">
// /vin — Dev1 owns. Autologic install check (the ordering gate).
// Looks up GET /api/vin/:vin. If installed → green OK card + Autologic detail
// grid + "สั่งซื้อทันที" CTA that routes to /catalog carrying the active VIN.
// If not installed → blocked state with no order CTA.
import { ref } from 'vue'
import type { Vin } from '~/types'

const { setActiveVin } = useCart()
const { t } = useI18n()

usePageTitle().set(t('vin.title'), t('vin.subtitle'))

const SAMPLE_VINS = [
  'MMTJNKB40NH000001',
  'MMBJNKS50PH000003',
  'MMOJNPEV2RH000006',
  'MMAJNATG1NH000008',
  'MMTJNKB40NH000002',
  'MMAJNATG1NH000009',
]

const input = ref('')
const error = ref('')
const busy = ref(false)
const searched = ref(false)
const result = ref<Vin | null>(null)

async function check() {
  error.value = ''
  const vin = input.value.trim().toUpperCase()
  if (vin.length !== 17) {
    error.value = t('vin.error.length')
    result.value = null
    searched.value = false
    return
  }
  busy.value = true
  try {
    const { vin: row } = await $fetch<{ vin: Vin | null }>(`/api/vin/${encodeURIComponent(vin)}`)
    result.value = row
    searched.value = true
  } catch {
    error.value = t('vin.error.failed')
  } finally {
    busy.value = false
  }
}

function pick(vin: string) {
  input.value = vin
  check()
}

function orderNow() {
  if (!result.value) return
  // Persist the active VIN (+ model/year) in shared state so the catalog survives
  // a refresh; keep ?vin= as a deep-link fallback.
  setActiveVin(result.value.vin, result.value.model, result.value.modelYear)
  navigateTo({ path: '/catalog', query: { vin: result.value.vin } })
}

function fmtDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <div class="space-y-5">
    <AppCard :title="t('vin.title')" :subtitle="t('vin.card.subtitle')">
      <div class="flex gap-2">
        <input
          v-model="input"
          maxlength="17"
          :placeholder="t('vin.input.placeholder')"
          class="code w-full rounded-lg border border-app bg-app px-3 py-2 text-sm uppercase text-app outline-none focus:border-brand-600"
          @keyup.enter="check"
        >
        <AppButton :disabled="busy" @click="check">{{ t('vin.check') }}</AppButton>
      </div>
      <p v-if="error" class="mt-2 text-xs text-rose-400">{{ error }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <CategoryChip v-for="v in SAMPLE_VINS" :key="v" @click="pick(v)">{{ v }}</CategoryChip>
      </div>
    </AppCard>

    <!-- Not found -->
    <EmptyState v-if="searched && !result" icon="❓" :title="t('vin.notFound.title')">
      {{ t('vin.notFound.body') }}
    </EmptyState>

    <!-- Installed → OK -->
    <AppCard v-else-if="result && result.autologicInstalled">
      <div class="rounded-xl border border-emerald-800 bg-emerald-950/40 p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-lg font-bold text-emerald-300">{{ t('vin.installed.title') }}</p>
            <p class="mt-1 text-sm text-app">
              {{ result.model }} · {{ t('vin.year') }} {{ result.modelYear }}
            </p>
            <p class="code mt-1 text-xs text-muted">{{ result.vin }}</p>
          </div>
          <StatusBadge :status="result.status" />
        </div>
        <AppButton class="mt-4" @click="orderNow">{{ t('vin.orderNow') }}</AppButton>
      </div>

      <div class="mt-5">
        <h3 class="mb-3 text-sm font-bold text-app">{{ t('vin.device.title') }}</h3>
        <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.package') }}</dt>
            <dd class="text-sm text-app">{{ result.packageName ?? '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.serial') }}</dt>
            <dd class="code text-sm text-app">{{ result.deviceSerial ?? '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.center') }}</dt>
            <dd class="text-sm text-app">{{ result.installCenter ?? '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.installDate') }}</dt>
            <dd class="text-sm text-app">{{ fmtDate(result.installDate) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.firmware') }}</dt>
            <dd class="code text-sm text-app">{{ result.firmware ?? '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t('vin.device.lastConnected') }}</dt>
            <dd class="text-sm text-app">{{ fmtDate(result.lastConnectedAt) }}</dd>
          </div>
        </dl>
      </div>
    </AppCard>

    <!-- Not installed → blocked -->
    <AppCard v-else-if="result && !result.autologicInstalled">
      <div class="rounded-xl border border-rose-800 bg-rose-950/40 p-6 text-center">
        <div class="text-4xl">🚫</div>
        <p class="mt-3 text-lg font-bold text-rose-300">{{ t('vin.blocked.title') }}</p>
        <p class="mt-1 text-sm text-app">{{ result.model }} · {{ t('vin.year') }} {{ result.modelYear }}</p>
        <p class="code mt-1 text-xs text-muted">{{ result.vin }}</p>
        <p class="mt-3 text-sm text-muted">
          {{ t('vin.blocked.body') }}
        </p>
      </div>
    </AppCard>

    <!-- Initial empty state -->
    <EmptyState v-else icon="🔎" :title="t('vin.empty.title')">
      {{ t('vin.empty.body') }}
    </EmptyState>
  </div>
</template>
