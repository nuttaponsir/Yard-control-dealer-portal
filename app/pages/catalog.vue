<script setup lang="ts">
// /catalog — Dev2 owns. VIN-gated parts catalog + cart sidebar + checkout.
import { computed, ref } from 'vue'
import { thb } from '~/utils/labels'
import type { Vin, AutologicDevice } from '~/types'
import type { CatalogPart } from '~/../server/api/parts/index.get'

const { t } = useI18n()

usePageTitle().set(t('catalog.title'), t('catalog.subtitle'))

const route = useRoute()
const router = useRouter()
const { role } = useAuth()
const { lines, count, total, add, setQty, remove, clear, qtyOf, activeVin, activeVinModel, activeVinYear, setActiveVin } = useCart()

// Active VIN: from shared cart state (set by the VIN page) or the ?vin= query.
const queryVin = computed(() => (typeof route.query.vin === 'string' ? route.query.vin : null))
if (queryVin.value && queryVin.value !== activeVin.value) setActiveVin(queryVin.value)
const vin = computed(() => activeVin.value ?? queryVin.value)
const hasVin = computed(() => !!vin.value && vin.value.length === 17)

// admin may browse but cannot order.
const isAdmin = computed(() => role.value === 'admin')

// ---- vehicle label --------------------------------------------------------
// Prefer the model/year carried in shared state; on a deep-link (query only) we
// fetch the VIN to resolve them so the header reflects the real vehicle.
const { data: vinData } = await useFetch<{ vin: Vin | null }>(
  () => `/api/vin/${encodeURIComponent(vin.value ?? '')}`,
  {
    immediate: hasVin.value && !activeVinModel.value,
    watch: [vin],
    default: () => ({ vin: null }),
  },
)
const vehicleModel = computed(() => activeVinModel.value ?? vinData.value?.vin?.model ?? null)
const vehicleYear = computed(() => activeVinYear.value ?? vinData.value?.vin?.modelYear ?? null)
const vehicleLabel = computed(() => {
  if (!vehicleModel.value) return null
  return vehicleYear.value ? `${vehicleModel.value} (${vehicleYear.value})` : vehicleModel.value
})

// ---- inline VIN scan (this page is now the ordering entry point) ----------
// /vin remains a standalone lookup; ordering scans here. Scanning an installed
// Autologic VIN unlocks the catalog; a non-installed (or unknown) VIN locks it.
const vinInput = ref(vin.value ?? '')
const vinChecking = ref(false)
const vinError = ref('')
const vinSearched = ref(false)
const scannedRow = ref<Vin | null>(null)
const showDevice = ref(false)

// Device/vehicle row to display: the freshly scanned row, else the deep-link fetch.
const deviceRow = computed<Vin | null>(() => scannedRow.value ?? vinData.value?.vin ?? null)
const blocked = computed(() => vinSearched.value && !!scannedRow.value && !scannedRow.value.autologicInstalled)
const notFound = computed(() => vinSearched.value && !scannedRow.value && !vinError.value)

async function checkVin() {
  vinError.value = ''
  const candidate = vinInput.value.trim().toUpperCase()
  if (candidate.length !== 17) {
    vinError.value = t('vin.error.length')
    return
  }
  vinChecking.value = true
  try {
    const { vin: row } = await $fetch<{ vin: Vin | null }>(`/api/vin/${encodeURIComponent(candidate)}`)
    scannedRow.value = row
    vinSearched.value = true
    if (row?.autologicInstalled) {
      setActiveVin(row.vin, row.model, row.modelYear)
      router.replace({ query: { ...route.query, vin: row.vin } })
    } else {
      setActiveVin(null) // lock ordering for unknown / not-installed VINs
    }
  } catch {
    vinError.value = t('vin.error.failed')
  } finally {
    vinChecking.value = false
  }
}

// Arrived with an active VIN (from /vin hand-off or ?vin= deep-link): reflect it
// and verify the install gate (so a not-installed deep-link can't order).
onMounted(async () => {
  if (!vin.value) return
  vinInput.value = vin.value
  try {
    const { vin: row } = await $fetch<{ vin: Vin | null }>(`/api/vin/${encodeURIComponent(vin.value)}`)
    scannedRow.value = row
    vinSearched.value = true
    if (row && !row.autologicInstalled) setActiveVin(null)
  } catch {
    // leave the deep-linked VIN as-is on lookup failure
  }
})

// ---- categories -----------------------------------------------------------
// Values stay Thai (the server filters on them); labels are localized for display.
const CATEGORIES = ['ทั้งหมด', 'กรอง', 'เบรก', 'อุปกรณ์', 'ไฟ', 'ช่วงล่าง', 'ไฟฟ้า']
const CATEGORY_KEYS: Record<string, string> = {
  'ทั้งหมด': 'catalog.cat.all',
  'กรอง': 'catalog.cat.filter',
  'เบรก': 'catalog.cat.brake',
  'อุปกรณ์': 'catalog.cat.accessory',
  'ไฟ': 'catalog.cat.light',
  'ช่วงล่าง': 'catalog.cat.suspension',
  'ไฟฟ้า': 'catalog.cat.electrical',
}
const activeCategory = ref('ทั้งหมด')

// ---- parts ----------------------------------------------------------------
// Filter by the active VIN so only compatible parts show (server resolves the
// VIN → model and includes universal parts). Category chips refine that set.
const { data, pending } = await useFetch<{ parts: CatalogPart[] }>('/api/parts', {
  query: { category: activeCategory, vin },
  watch: [activeCategory, vin],
  default: () => ({ parts: [] }),
})
const parts = computed(() => data.value?.parts ?? [])

// ---- Accessories that fit the scanned vehicle's model ---------------------
// On scan we resolve the model, show the accessories that fit it, and flag the
// ones already installed on this VIN (from /api/vin-accessories).
const scannedModel = computed(() => deviceRow.value?.model ?? vehicleModel.value ?? null)
const { data: devData } = useFetch<{ devices: AutologicDevice[] }>('/api/autologic-devices', {
  query: { model: scannedModel },
  watch: [scannedModel],
  default: () => ({ devices: [] }),
})
const autologicDevices = computed(() => devData.value?.devices ?? [])

const { data: installedData } = useFetch<{ accessories: { accessoryId: number }[] }>('/api/vin-accessories', {
  query: { vin },
  watch: [vin],
  default: () => ({ accessories: [] }),
})
const installedAccessoryIds = computed(() => new Set((installedData.value?.accessories ?? []).map((a) => a.accessoryId)))

function stockAt(part: CatalogPart, warehouse: string): number {
  return part.stock.find((s) => s.warehouse === warehouse)?.qtyOnHand ?? 0
}

// ---- checkout -------------------------------------------------------------
const submitting = ref(false)
const toast = ref<string | null>(null)

async function checkout() {
  if (isAdmin.value || !lines.value.length || !hasVin.value) return
  submitting.value = true
  try {
    const res = await $fetch<{ poNumber: string }>('/api/orders', {
      method: 'POST',
      body: {
        vin: vin.value,
        items: lines.value.map((l) => ({ partId: l.partId, qty: l.qty })),
      },
    })
    toast.value = `${t('catalog.checkout.success')} ${res.poNumber}`
    clear()
    setTimeout(() => router.push('/orders'), 900)
  } catch {
    toast.value = t('catalog.checkout.error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- VIN scan bar — ordering entry point (VIN-first) -->
    <AppCard :title="t('catalog.scan.title')" :subtitle="t('catalog.scan.subtitle')">
      <div class="flex flex-wrap gap-2">
        <input
          v-model="vinInput"
          maxlength="17"
          :placeholder="t('vin.input.placeholder')"
          class="code min-w-0 flex-1 rounded-lg border border-app bg-app px-3 py-2 text-sm uppercase text-app outline-none focus:border-brand-600"
          @keyup.enter="checkVin"
        >
        <AppButton :disabled="vinChecking" @click="checkVin">{{ t('vin.check') }}</AppButton>
        <NuxtLink to="/telematics"><AppButton variant="outline">{{ t('catalog.scan.lookup') }}</AppButton></NuxtLink>
      </div>
      <p v-if="vinError" class="mt-2 text-xs text-rose-500 dark:text-rose-400">{{ vinError }}</p>

      <!-- installed → status strip + expandable device detail -->
      <div
        v-if="hasVin && deviceRow"
        class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <StatusBadge :status="deviceRow.status" />
            <span class="text-sm font-medium text-app">{{ deviceRow.model }} · {{ t('vin.year') }} {{ deviceRow.modelYear }}</span>
            <span class="code text-xs text-muted">{{ deviceRow.vin }}</span>
          </div>
          <button class="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" @click="showDevice = !showDevice">
            {{ showDevice ? t('catalog.scan.hideDevice') : t('catalog.scan.showDevice') }}
          </button>
        </div>
        <dl v-if="showDevice" class="mt-3 grid grid-cols-1 gap-3 border-t border-emerald-200 pt-3 sm:grid-cols-2 dark:border-emerald-800">
          <div><dt class="text-xs text-muted">{{ t('vin.device.package') }}</dt><dd class="text-sm text-app">{{ deviceRow.packageName ?? '-' }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('vin.device.serial') }}</dt><dd class="code text-sm text-app">{{ deviceRow.deviceSerial ?? '-' }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('vin.device.center') }}</dt><dd class="text-sm text-app">{{ deviceRow.installCenter ?? '-' }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('vin.device.firmware') }}</dt><dd class="code text-sm text-app">{{ deviceRow.firmware ?? '-' }}</dd></div>
        </dl>
      </div>

      <!-- not installed → blocked -->
      <div
        v-else-if="blocked && scannedRow"
        class="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/40"
      >
        <p class="font-bold text-rose-700 dark:text-rose-300">🚫 {{ t('vin.blocked.title') }}</p>
        <p class="mt-1 text-sm text-app">{{ scannedRow.model }} · {{ t('vin.year') }} {{ scannedRow.modelYear }} · <span class="code">{{ scannedRow.vin }}</span></p>
        <p class="mt-1 text-sm text-muted">{{ t('vin.blocked.body') }}</p>
      </div>

      <!-- unknown VIN -->
      <p v-else-if="notFound" class="mt-3 text-sm text-muted">❓ {{ t('catalog.scan.notFound') }}</p>
    </AppCard>

    <!-- Autologic devices available for the scanned model -->
    <AppCard
      v-if="deviceRow && scannedModel"
      :title="t('catalog.autologic.title')"
      :subtitle="`${t('catalog.autologic.forModel')} ${scannedModel}`"
    >
      <EmptyState v-if="!autologicDevices.length" icon="📡" :title="t('catalog.autologic.empty')" />
      <ul v-else class="grid gap-3 sm:grid-cols-2">
        <li v-for="d in autologicDevices" :key="d.id" class="rounded-xl border border-app bg-surface p-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-semibold text-app">{{ d.name }}</p>
              <p class="code text-xs text-muted">{{ d.sku }}</p>
            </div>
            <span
              v-if="installedAccessoryIds.has(d.id)"
              class="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            >
              ✓ {{ t('catalog.autologic.installed') }}
            </span>
          </div>
          <p v-if="d.description" class="mt-1 text-xs text-muted">{{ d.description }}</p>
          <p class="mt-2 text-sm font-bold text-app">{{ thb(d.price) }}</p>
        </li>
      </ul>
    </AppCard>

    <!-- nothing scanned yet → prompt -->
    <EmptyState v-if="!hasVin && !blocked && !notFound" icon="🧰" :title="t('catalog.gate.title')">
      {{ t('catalog.gate.body') }}
    </EmptyState>

    <div v-else-if="hasVin" class="grid gap-5 lg:grid-cols-[1fr_340px]">
      <!-- catalog -->
      <div class="space-y-4">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-base font-bold text-app">
            <template v-if="vehicleLabel">{{ t('catalog.forModel') }} {{ vehicleLabel }}</template>
            <template v-else>{{ t('catalog.title') }}</template>
          </h2>
          <DataPorter :export-url="'/api/parts/export'" :export-filename="'catalog.xlsx'" />
        </div>

        <!-- category chips -->
        <div class="flex flex-wrap gap-2">
          <CategoryChip
            v-for="c in CATEGORIES"
            :key="c"
            :active="activeCategory === c"
            @click="activeCategory = c"
          >
            {{ t(CATEGORY_KEYS[c] ?? c) }}
          </CategoryChip>
        </div>

        <!-- admin notice -->
        <div
          v-if="isAdmin"
          class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
        >
          {{ t('catalog.adminNotice') }}
        </div>

        <!-- grid -->
        <div v-if="pending" class="py-12 text-center text-muted">{{ t('common.loadingEllipsis') }}</div>
        <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <article
            v-for="p in parts"
            :key="p.id"
            class="relative flex flex-col rounded-2xl border border-app bg-surface p-4"
          >
            <div class="mb-2 flex items-start justify-between">
              <span class="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">{{ p.category }}</span>
              <span
                v-if="p.oem"
                class="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
              >
                OEM
              </span>
            </div>

            <h3 class="font-semibold text-app">{{ p.name }}</h3>
            <p class="code mt-0.5 text-xs text-muted">{{ p.sku }}</p>

            <dl class="mt-3 space-y-1 text-xs text-muted">
              <div class="flex justify-between"><dt>{{ t('catalog.part.type') }}</dt><dd class="text-app">{{ p.category }}</dd></div>
              <div class="flex justify-between"><dt>{{ t('catalog.part.warranty') }}</dt><dd class="text-app">{{ p.warrantyMonths }} {{ t('catalog.part.warrantyUnit') }}</dd></div>
              <div class="flex justify-between"><dt>{{ t('catalog.part.leadTime') }}</dt><dd class="text-app">{{ p.leadTimeDays }} {{ t('catalog.part.leadTimeUnit') }}</dd></div>
              <div class="flex justify-between"><dt>{{ t('catalog.part.stockBkk') }}</dt><dd class="text-app">{{ stockAt(p, 'คลังกรุงเทพ') }} {{ t('catalog.part.stockUnit') }}</dd></div>
              <div class="flex justify-between"><dt>{{ t('catalog.part.stockCnx') }}</dt><dd class="text-app">{{ stockAt(p, 'คลังเชียงใหม่') }} {{ t('catalog.part.stockUnit') }}</dd></div>
            </dl>

            <div class="mt-3 flex items-center justify-between">
              <span class="text-base font-bold text-app">{{ thb(p.price) }}</span>

              <div v-if="qtyOf(p.id) > 0" class="flex items-center gap-2">
                <AppButton size="sm" variant="outline" @click="setQty(p.id, qtyOf(p.id) - 1)">−</AppButton>
                <span class="w-6 text-center text-sm font-semibold text-app">{{ qtyOf(p.id) }}</span>
                <AppButton size="sm" variant="outline" @click="add(p, 1)">+</AppButton>
              </div>
              <AppButton v-else size="sm" @click="add(p, 1)">{{ t('action.add') }}</AppButton>
            </div>
          </article>
        </div>
      </div>

      <!-- cart sidebar -->
      <AppCard :title="t('catalog.cart.title')" :subtitle="`${count} ${t('catalog.cart.items')}`">
        <EmptyState v-if="!lines.length" icon="🛒" :title="t('catalog.cart.empty')" />

        <div v-else class="space-y-3">
          <div
            v-for="l in lines"
            :key="l.partId"
            class="rounded-xl border border-app bg-surface-2/40 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-semibold text-app">{{ l.name }}</p>
                <p class="code text-xs text-muted">{{ l.sku }}</p>
              </div>
              <button class="text-muted hover:text-rose-400" @click="remove(l.partId)">✕</button>
            </div>
            <div class="mt-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <AppButton size="sm" variant="outline" @click="setQty(l.partId, l.qty - 1)">−</AppButton>
                <span class="w-6 text-center text-sm font-semibold text-app">{{ l.qty }}</span>
                <AppButton size="sm" variant="outline" @click="setQty(l.partId, l.qty + 1)">+</AppButton>
              </div>
              <span class="text-sm font-semibold text-app">{{ thb(l.qty * l.unitPrice) }}</span>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-app pt-3">
            <span class="text-sm text-muted">{{ t('catalog.cart.total') }}</span>
            <span class="text-lg font-bold text-app">{{ thb(total) }}</span>
          </div>

          <AppButton
            class="w-full"
            :disabled="isAdmin || submitting || !lines.length"
            @click="checkout"
          >
            {{ t('action.checkout') }}
          </AppButton>
          <p v-if="isAdmin" class="text-xs text-amber-300">
            {{ t('catalog.adminNotice') }}
          </p>
        </div>
      </AppCard>
    </div>

    <!-- success toast -->
    <AppToast :message="toast" />
  </div>
</template>
