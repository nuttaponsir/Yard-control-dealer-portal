<script setup lang="ts">
// /catalog — Dev2 owns. VIN-gated parts catalog + cart sidebar + checkout.
import { computed, ref } from 'vue'
import { thb } from '~/utils/labels'
import type { Vin } from '~/types'
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
    <!-- VIN gate -->
    <AppCard
      v-if="!hasVin"
      :title="t('catalog.title')"
      :subtitle="t('catalog.gate.subtitle')"
    >
      <EmptyState icon="🧰" :title="t('catalog.gate.title')">
        {{ t('catalog.gate.body') }}
        <div class="mt-4">
          <NuxtLink to="/vin"><AppButton>{{ t('catalog.gate.cta') }}</AppButton></NuxtLink>
        </div>
      </EmptyState>
    </AppCard>

    <div v-else class="grid gap-5 lg:grid-cols-[1fr_340px]">
      <!-- catalog -->
      <div class="space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold text-app">{{ t('catalog.title') }}</h2>
            <p class="mt-0.5 text-sm text-muted">
              <template v-if="vehicleLabel">{{ t('catalog.forModel') }} {{ vehicleLabel }} — </template>VIN <span class="code">{{ vin }}</span>
            </p>
          </div>
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
                class="rounded-md bg-brand-900/30 px-2 py-0.5 text-xs font-semibold text-brand-300"
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
    <div
      v-if="toast"
      class="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
