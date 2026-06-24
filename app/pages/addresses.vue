<script setup lang="ts">
// /addresses — Phase 2. Dealer address book (bill-to / ship-to + geo).
// owner/sales manage their own dealer's addresses; admin can pick any dealer.
// A lat/lng pair renders an OpenStreetMap preview + a Google Maps link.
import type { DealerAddress, AddressKind } from '~/types'

const { t } = useI18n()
const { can, user } = useAuth()

const isAdmin = computed(() => can(['admin']))

// Admin manages every dealer's address book (reached from masters → dealers);
// owner/sales see it framed as their own dealer profile ("ดีลเลอร์ของฉัน").
usePageTitle().set(
  isAdmin.value ? t('page.addresses.title') : t('page.myDealer.title'),
  isAdmin.value ? t('page.addresses.subtitle') : t('page.myDealer.subtitle'),
)

// ---- admin dealer picker ---------------------------------------------------
interface DealerLite {
  id: number
  code: string
  name: string
}
const dealers = ref<DealerLite[]>([])
const selectedDealerId = ref<number | null>(null)

if (isAdmin.value) {
  const { data } = await useFetch<{ dealers: DealerLite[] }>('/api/dealers')
  dealers.value = data.value?.dealers ?? []
  selectedDealerId.value = dealers.value[0]?.id ?? null
}

// The dealer whose book we're viewing (admin → picker; else the session dealer).
const activeDealerId = computed<number | null>(() =>
  isAdmin.value ? selectedDealerId.value : (user.value?.dealerId ?? null),
)

// ---- list ------------------------------------------------------------------
const addresses = ref<DealerAddress[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const qs = isAdmin.value && selectedDealerId.value ? `?dealerId=${selectedDealerId.value}` : ''
    const res = await $fetch<{ addresses: DealerAddress[] }>(`/api/addresses${qs}`)
    addresses.value = res.addresses
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(selectedDealerId, load)

// ---- form (create / edit) --------------------------------------------------
interface AddressForm {
  id: number | null
  label: string
  kind: AddressKind
  line1: string
  subDistrict: string
  district: string
  province: string
  postalCode: string
  contactName: string
  contactPhone: string
  lat: string
  lng: string
  isDefaultBilling: boolean
  isDefaultShipping: boolean
}
function emptyForm(): AddressForm {
  return {
    id: null,
    label: '',
    kind: 'both',
    line1: '',
    subDistrict: '',
    district: '',
    province: '',
    postalCode: '',
    contactName: '',
    contactPhone: '',
    lat: '',
    lng: '',
    isDefaultBilling: false,
    isDefaultShipping: false,
  }
}
const form = reactive<AddressForm>(emptyForm())
const showForm = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

function openCreate() {
  Object.assign(form, emptyForm())
  formError.value = null
  showForm.value = true
}
function openEdit(a: DealerAddress) {
  Object.assign(form, {
    id: a.id,
    label: a.label,
    kind: a.kind,
    line1: a.line1,
    subDistrict: a.subDistrict ?? '',
    district: a.district ?? '',
    province: a.province,
    postalCode: a.postalCode ?? '',
    contactName: a.contactName ?? '',
    contactPhone: a.contactPhone ?? '',
    lat: a.lat != null ? String(a.lat) : '',
    lng: a.lng != null ? String(a.lng) : '',
    isDefaultBilling: a.isDefaultBilling,
    isDefaultShipping: a.isDefaultShipping,
  })
  formError.value = null
  showForm.value = true
}
function closeForm() {
  showForm.value = false
}

function readErr(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage || err?.statusMessage || t('addresses.error')
}

// Build the request body, coercing optional text → null and lat/lng → number.
function toBody() {
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const txt = (s: string) => (s.trim() === '' ? null : s.trim())
  const body: Record<string, unknown> = {
    label: form.label.trim(),
    kind: form.kind,
    line1: form.line1.trim(),
    subDistrict: txt(form.subDistrict),
    district: txt(form.district),
    province: form.province.trim(),
    postalCode: txt(form.postalCode),
    contactName: txt(form.contactName),
    contactPhone: txt(form.contactPhone),
    lat: num(form.lat),
    lng: num(form.lng),
    isDefaultBilling: form.isDefaultBilling,
    isDefaultShipping: form.isDefaultShipping,
  }
  // admin creating a new row must say which dealer it belongs to.
  if (form.id == null && isAdmin.value && selectedDealerId.value != null) {
    body.dealerId = selectedDealerId.value
  }
  return body
}

async function save() {
  saving.value = true
  formError.value = null
  try {
    if (form.id == null) {
      await $fetch('/api/addresses', { method: 'POST', body: toBody() })
    } else {
      await $fetch(`/api/addresses/${form.id}`, { method: 'PUT', body: toBody() })
    }
    showForm.value = false
    await load()
  } catch (e: unknown) {
    formError.value = readErr(e)
  } finally {
    saving.value = false
  }
}

async function remove(a: DealerAddress) {
  if (!confirm(t('addresses.confirmDelete', { label: a.label }))) return
  try {
    await $fetch(`/api/addresses/${a.id}`, { method: 'DELETE' })
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  }
}

// ---- map helpers -----------------------------------------------------------
function osmEmbed(lat: number, lng: number): string {
  const d = 0.01
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`
}
function gmapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

const kindLabel = (k: string) =>
  k === 'billing' ? t('addresses.kind.billing') : k === 'shipping' ? t('addresses.kind.shipping') : t('addresses.kind.both')

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
</script>

<template>
  <div class="space-y-5">
    <!-- toolbar -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div v-if="isAdmin" class="min-w-56">
        <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.dealer') }}</label>
        <select
          v-model.number="selectedDealerId"
          class="w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none"
        >
          <option v-for="d in dealers" :key="d.id" :value="d.id">{{ d.code }} — {{ d.name }}</option>
        </select>
      </div>
      <div v-else />
      <AppButton size="sm" :disabled="activeDealerId == null" @click="openCreate">
        + {{ t('addresses.add') }}
      </AppButton>
    </div>

    <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

    <EmptyState v-if="!loading && addresses.length === 0" icon="📍" :title="t('addresses.empty')">
      {{ t('addresses.emptyHint') }}
    </EmptyState>

    <!-- address cards -->
    <div class="grid gap-4 md:grid-cols-2">
      <AppCard v-for="a in addresses" :key="a.id">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-app">{{ a.label }}</p>
              <span class="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{{ kindLabel(a.kind) }}</span>
              <span v-if="a.isDefaultBilling" class="rounded-full bg-brand-600/20 px-2 py-0.5 text-[11px] text-brand-300">{{ t('addresses.defaultBilling') }}</span>
              <span v-if="a.isDefaultShipping" class="rounded-full bg-emerald-600/20 px-2 py-0.5 text-[11px] text-emerald-300">{{ t('addresses.defaultShipping') }}</span>
            </div>
            <p class="mt-1 text-sm text-app">{{ a.line1 }}</p>
            <p class="text-xs text-muted">
              {{ [a.subDistrict, a.district, a.province, a.postalCode].filter(Boolean).join(' ') }}
            </p>
            <p v-if="a.contactName || a.contactPhone" class="mt-1 text-xs text-muted">
              👤 {{ [a.contactName, a.contactPhone].filter(Boolean).join(' · ') }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <AppButton variant="outline" size="sm" @click="openEdit(a)">{{ t('common.edit') }}</AppButton>
            <AppButton variant="danger" size="sm" @click="remove(a)">{{ t('common.delete') }}</AppButton>
          </div>
        </div>

        <!-- map preview -->
        <div v-if="a.lat != null && a.lng != null" class="mt-3">
          <iframe
            :src="osmEmbed(a.lat, a.lng)"
            class="h-44 w-full rounded-lg border border-app"
            loading="lazy"
            referrerpolicy="no-referrer"
            :title="`${a.label} map`"
          />
          <a
            :href="gmapsLink(a.lat, a.lng)"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-block text-xs text-brand-400 hover:underline"
          >
            🗺 {{ t('addresses.openInGoogle') }}
          </a>
        </div>
      </AppCard>
    </div>

    <!-- create / edit drawer -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeForm"
    >
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">
            {{ form.id == null ? t('addresses.add') : t('addresses.editTitle') }}
          </h2>
          <button class="text-muted hover:text-app" @click="closeForm">✕</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.label') }}</label>
            <input v-model="form.label" type="text" :class="fld">
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.kindLabel') }}</label>
            <select v-model="form.kind" :class="fld">
              <option value="both">{{ t('addresses.kind.both') }}</option>
              <option value="billing">{{ t('addresses.kind.billing') }}</option>
              <option value="shipping">{{ t('addresses.kind.shipping') }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.line1') }}</label>
            <input v-model="form.line1" type="text" :class="fld">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.subDistrict') }}</label>
              <input v-model="form.subDistrict" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.district') }}</label>
              <input v-model="form.district" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.province') }}</label>
              <input v-model="form.province" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.postalCode') }}</label>
              <input v-model="form.postalCode" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.contactName') }}</label>
              <input v-model="form.contactName" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.contactPhone') }}</label>
              <input v-model="form.contactPhone" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.lat') }}</label>
              <input v-model="form.lat" type="number" step="any" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('addresses.lng') }}</label>
              <input v-model="form.lng" type="number" step="any" :class="fld">
            </div>
          </div>
          <div class="flex flex-wrap gap-4 pt-1">
            <label class="flex items-center gap-2 text-sm text-app">
              <input v-model="form.isDefaultBilling" type="checkbox">
              {{ t('addresses.defaultBilling') }}
            </label>
            <label class="flex items-center gap-2 text-sm text-app">
              <input v-model="form.isDefaultShipping" type="checkbox">
              {{ t('addresses.defaultShipping') }}
            </label>
          </div>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="saving" @click="closeForm">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="saving" @click="save">
              {{ saving ? t('addresses.saving') : t('common.save') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
