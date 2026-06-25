<script setup lang="ts">
// /telematics (route kept for continuity) — "อุปกรณ์ตกแต่ง / Accessories".
// Search a VIN → see the vehicle's installed body-kit accessories + the
// accessories that fit its model; admin/warehouse can record a new install
// (which also unlocks ordering for that VIN). Plus a recent-installs feed.
import { computed, ref } from 'vue'
import { thb } from '~/utils/labels'
import type { Accessory, VinAccessory, Vin } from '~/types'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('accessories.title'), t('accessories.subtitle'))

const canRecord = computed(() => can(['admin', 'warehouse']))

// ---- recent installs across the network ------------------------------------
const { data: recentData, refresh: refreshRecent } = await useFetch<{ accessories: VinAccessory[] }>(
  '/api/vin-accessories',
  { default: () => ({ accessories: [] }) },
)
const recent = computed(() => recentData.value?.accessories ?? [])

// ---- VIN search ------------------------------------------------------------
const vinQuery = ref('')
const vehicle = ref<Vin | null>(null)
const searched = ref(false)
const lookupError = ref('')
const installed = ref<VinAccessory[]>([])
const compatible = ref<Accessory[]>([])

async function lookupVin() {
  lookupError.value = ''
  searched.value = false
  vehicle.value = null
  const vin = vinQuery.value.trim().toUpperCase()
  if (vin.length !== 17) return
  try {
    const [{ vin: row }, inst, comp] = await Promise.all([
      $fetch<{ vin: Vin | null }>(`/api/vin/${encodeURIComponent(vin)}`),
      $fetch<{ accessories: VinAccessory[] }>('/api/vin-accessories', { query: { vin } }),
      $fetch<{ devices: Accessory[] }>('/api/autologic-devices', { query: { vin } }),
    ])
    vehicle.value = row
    installed.value = inst.accessories
    compatible.value = comp.devices
    searched.value = true
  } catch {
    lookupError.value = t('accessories.error')
  }
}

const installedIds = computed(() => new Set(installed.value.map((a) => a.accessoryId)))

function thaiDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---- record-install modal --------------------------------------------------
const showForm = ref(false)
const formAccessoryId = ref<number | null>(null)
const formInstalledAt = ref('')
const formCenter = ref('')
const formWarranty = ref(12)
const submitting = ref(false)
const formError = ref<string | null>(null)

const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'

function openForm() {
  formError.value = null
  formAccessoryId.value = compatible.value[0]?.id ?? null
  formInstalledAt.value = ''
  formCenter.value = ''
  formWarranty.value = 12
  showForm.value = true
}

async function submitInstall() {
  formError.value = null
  if (!vehicle.value || formAccessoryId.value == null) {
    formError.value = t('accessories.error')
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/vin-accessories', {
      method: 'POST',
      body: {
        vin: vehicle.value.vin,
        accessoryId: formAccessoryId.value,
        installedAt: formInstalledAt.value || undefined,
        installCenter: formCenter.value.trim() || null,
        warrantyMonths: formWarranty.value,
      },
    })
    showForm.value = false
    await Promise.all([lookupVin(), refreshRecent()])
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    formError.value = msg || t('accessories.error')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- VIN search -->
    <AppCard :title="t('accessories.searchTitle')" :subtitle="t('accessories.subtitle')">
      <div class="flex flex-wrap gap-2">
        <input
          v-model="vinQuery"
          maxlength="17"
          :placeholder="t('accessories.searchPlaceholder')"
          class="code min-w-0 flex-1 rounded-lg border border-app bg-app px-3 py-2 text-sm uppercase text-app outline-none focus:border-brand-600"
          @keyup.enter="lookupVin"
        >
        <AppButton :disabled="vinQuery.trim().length !== 17" @click="lookupVin">{{ t('accessories.check') }}</AppButton>
      </div>
      <p v-if="lookupError" class="mt-2 text-sm text-rose-500 dark:text-rose-400">{{ lookupError }}</p>
      <p v-else-if="searched && !vehicle" class="mt-2 text-sm text-muted">❓ {{ t('accessories.notFound') }}</p>
    </AppCard>

    <!-- vehicle detail: installed + compatible accessories -->
    <div v-if="searched && vehicle" class="grid gap-5 lg:grid-cols-2">
      <!-- installed -->
      <AppCard :title="t('accessories.installed')" :subtitle="`${vehicle.model} · ${vehicle.modelYear} · ${vehicle.vin}`">
        <template v-if="canRecord" #actions>
          <AppButton size="sm" :disabled="!compatible.length" @click="openForm">{{ t('accessories.recordTitle') }}</AppButton>
        </template>
        <EmptyState v-if="!installed.length" icon="🛠" :title="t('accessories.none')" />
        <ul v-else class="divide-y divide-app">
          <li v-for="a in installed" :key="a.id" class="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div class="min-w-0">
              <p class="font-medium text-app">{{ a.accessoryName }} <span class="code text-xs text-muted">{{ a.accessorySku }}</span></p>
              <p class="text-xs text-muted">{{ thaiDate(a.installedAt) }} · {{ a.installCenter ?? '—' }}</p>
            </div>
            <span class="shrink-0 text-xs text-muted">{{ t('accessories.warranty') }} {{ a.warrantyMonths }} {{ t('accessories.warrantyUnit') }}</span>
          </li>
        </ul>
      </AppCard>

      <!-- compatible with this model -->
      <AppCard :title="t('accessories.compatible')" :subtitle="vehicle.model">
        <EmptyState v-if="!compatible.length" icon="📦" :title="t('accessories.noneCompatible')" />
        <ul v-else class="grid gap-3 sm:grid-cols-2">
          <li v-for="d in compatible" :key="d.id" class="rounded-xl border border-app bg-surface p-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="font-semibold text-app">{{ d.name }}</p>
                <p class="code text-xs text-muted">{{ d.sku }}</p>
              </div>
              <span
                v-if="installedIds.has(d.id)"
                class="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                ✓ {{ t('accessories.installedTag') }}
              </span>
            </div>
            <p v-if="d.description" class="mt-1 text-xs text-muted">{{ d.description }}</p>
            <p class="mt-2 text-sm font-bold text-app">{{ thb(d.price) }}</p>
          </li>
        </ul>
      </AppCard>
    </div>

    <!-- recent installs across the network -->
    <AppCard :title="t('accessories.recentTitle')">
      <EmptyState v-if="!recent.length" icon="📭" :title="t('accessories.recentEmpty')" />
      <ul v-else class="divide-y divide-app">
        <li v-for="a in recent" :key="a.id" class="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div class="min-w-0">
            <span class="font-medium text-app">{{ a.accessoryName }}</span>
            <span class="ml-2 code text-xs text-muted">{{ a.vin }}</span>
          </div>
          <span class="shrink-0 text-xs text-muted">{{ thaiDate(a.installedAt) }} · {{ a.installCenter ?? '—' }}</span>
        </li>
      </ul>
    </AppCard>

    <!-- record-install modal -->
    <AppModal :open="showForm" :title="t('accessories.recordTitle')" @close="showForm = false">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('accessories.accessory') }}</label>
          <select v-model.number="formAccessoryId" :class="fld">
            <option v-for="d in compatible" :key="d.id" :value="d.id">{{ d.name }} — {{ thb(d.price) }}</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('accessories.installedAt') }}</label>
            <input v-model="formInstalledAt" type="date" :class="fld">
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('accessories.warranty') }} ({{ t('accessories.warrantyUnit') }})</label>
            <input v-model.number="formWarranty" type="number" min="0" :class="fld">
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('accessories.installCenter') }}</label>
          <input v-model="formCenter" type="text" :class="fld">
        </div>
        <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>
      </div>
      <template #footer>
        <AppButton variant="outline" size="sm" :disabled="submitting" @click="showForm = false">{{ t('common.cancel') }}</AppButton>
        <AppButton size="sm" :disabled="submitting" @click="submitInstall">{{ t('action.save') }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
