<script setup lang="ts">
// /locations — Phase 3 (WMS). Storage-location (bin) master. Warehouse-level;
// admin/warehouse manage the bins. There is no warehouse-list endpoint, so the
// filter dropdown + the create-form datalist derive their options from the
// distinct warehouses already present on the loaded locations.
import type { StorageLocation } from '~/types'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.locations.title'), t('page.locations.subtitle'))

// Defensive client gate (server still enforces). admin/warehouse only.
const allowed = computed(() => can(['admin', 'warehouse']))

// ---- list ------------------------------------------------------------------
const locations = ref<StorageLocation[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// Warehouse filter (''=all). Options derived from loaded rows.
const warehouseFilter = ref('')
const activeFilter = ref('') // ''|'true'|'false'

// Distinct warehouses seen across the loaded set — feeds both the filter and
// the create-form datalist.
const warehouseOptions = computed(() => {
  const set = new Set<string>()
  for (const l of locations.value) set.add(l.warehouse)
  return [...set].sort()
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams()
    if (warehouseFilter.value) params.set('warehouse', warehouseFilter.value)
    if (activeFilter.value) params.set('active', activeFilter.value)
    const qs = params.toString() ? `?${params.toString()}` : ''
    const res = await $fetch<{ locations: StorageLocation[] }>(`/api/wms/locations${qs}`)
    locations.value = res.locations
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch([warehouseFilter, activeFilter], load)

// ---- form (create / edit) --------------------------------------------------
interface LocationForm {
  id: number | null
  warehouse: string
  code: string
  zone: string
  aisle: string
  bin: string
  active: boolean
}
function emptyForm(): LocationForm {
  return { id: null, warehouse: '', code: '', zone: '', aisle: '', bin: '', active: true }
}
const form = reactive<LocationForm>(emptyForm())
const showForm = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

function openCreate() {
  Object.assign(form, emptyForm())
  // Pre-fill warehouse from the active filter for convenience.
  if (warehouseFilter.value) form.warehouse = warehouseFilter.value
  formError.value = null
  showForm.value = true
}
function openEdit(l: StorageLocation) {
  Object.assign(form, {
    id: l.id,
    warehouse: l.warehouse,
    code: l.code,
    zone: l.zone ?? '',
    aisle: l.aisle ?? '',
    bin: l.bin ?? '',
    active: l.active,
  })
  formError.value = null
  showForm.value = true
}
function closeForm() {
  showForm.value = false
}

function readErr(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage || err?.statusMessage || t('locations.error')
}

// Build the request body, coercing optional text → null.
function toBody() {
  const txt = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    warehouse: form.warehouse.trim(),
    code: form.code.trim(),
    zone: txt(form.zone),
    aisle: txt(form.aisle),
    bin: txt(form.bin),
    active: form.active,
  }
}

async function save() {
  saving.value = true
  formError.value = null
  try {
    if (form.id == null) {
      await $fetch('/api/wms/locations', { method: 'POST', body: toBody() })
    } else {
      await $fetch(`/api/wms/locations/${form.id}`, { method: 'PUT', body: toBody() })
    }
    showForm.value = false
    await load()
  } catch (e: unknown) {
    formError.value = readErr(e)
  } finally {
    saving.value = false
  }
}

async function remove(l: StorageLocation) {
  if (!confirm(t('locations.confirmDelete', { code: l.code }))) return
  try {
    await $fetch(`/api/wms/locations/${l.id}`, { method: 'DELETE' })
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  }
}

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
</script>

<template>
  <div class="space-y-5">
    <!-- toolbar -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-48">
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.warehouse') }}</label>
          <select v-model="warehouseFilter" :class="fld">
            <option value="">—</option>
            <option v-for="w in warehouseOptions" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <div class="min-w-40">
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.active') }}</label>
          <select v-model="activeFilter" :class="fld">
            <option value="">—</option>
            <option value="true">{{ t('locations.active') }}</option>
            <option value="false">{{ t('locations.inactive') }}</option>
          </select>
        </div>
      </div>
      <AppButton v-if="allowed" size="sm" @click="openCreate">
        + {{ t('locations.add') }}
      </AppButton>
    </div>

    <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

    <EmptyState v-if="!loading && locations.length === 0" icon="📦" :title="t('locations.empty')">
      {{ t('locations.emptyHint') }}
    </EmptyState>

    <!-- locations table -->
    <AppCard v-if="locations.length > 0">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-app text-left text-xs text-muted">
              <th class="px-3 py-2 font-medium">{{ t('locations.warehouse') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('locations.code') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('locations.zone') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('locations.aisle') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('locations.bin') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('locations.active') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in locations" :key="l.id" class="border-b border-app/60">
              <td class="px-3 py-2 text-app">{{ l.warehouse }}</td>
              <td class="px-3 py-2 font-medium text-app">{{ l.code }}</td>
              <td class="px-3 py-2 text-muted">{{ l.zone ?? '—' }}</td>
              <td class="px-3 py-2 text-muted">{{ l.aisle ?? '—' }}</td>
              <td class="px-3 py-2 text-muted">{{ l.bin ?? '—' }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-[11px]"
                  :class="l.active ? 'bg-emerald-600/20 text-emerald-300' : 'bg-surface-2 text-muted'"
                >
                  {{ l.active ? t('locations.active') : t('locations.inactive') }}
                </span>
              </td>
              <td class="px-3 py-2">
                <div v-if="allowed" class="flex justify-end gap-1.5">
                  <AppButton variant="outline" size="sm" @click="openEdit(l)">{{ t('common.edit') }}</AppButton>
                  <AppButton variant="danger" size="sm" @click="remove(l)">{{ t('common.delete') }}</AppButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- create / edit drawer -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeForm"
    >
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">
            {{ form.id == null ? t('locations.add') : t('locations.editTitle') }}
          </h2>
          <button class="text-muted hover:text-app" @click="closeForm">✕</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.warehouse') }}</label>
            <input v-model="form.warehouse" type="text" list="wms-warehouse-options" :class="fld">
            <datalist id="wms-warehouse-options">
              <option v-for="w in warehouseOptions" :key="w" :value="w" />
            </datalist>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.code') }}</label>
            <input v-model="form.code" type="text" :class="fld">
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.zone') }}</label>
              <input v-model="form.zone" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.aisle') }}</label>
              <input v-model="form.aisle" type="text" :class="fld">
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-muted">{{ t('locations.bin') }}</label>
              <input v-model="form.bin" type="text" :class="fld">
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-app">
            <input v-model="form.active" type="checkbox">
            {{ t('locations.active') }}
          </label>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="saving" @click="closeForm">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="saving" @click="save">
              {{ saving ? t('locations.saving') : t('common.save') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
