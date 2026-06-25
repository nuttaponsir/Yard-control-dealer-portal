<script setup lang="ts">
// /warranty — Phase 5. Part-warranty registry tied to a VIN.
// Read: admin/owner/sales/warehouse. Register: admin/owner/sales. Void: admin.
import type { Warranty } from '~/types'

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.warranty.title'), t('page.warranty.subtitle'))

const canRegister = computed(() => can(['admin', 'owner', 'sales']))
const isAdmin = computed(() => can(['admin']))

// ---- list ------------------------------------------------------------------
const warranties = ref<Warranty[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

function readErr(e: unknown): string {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
  return err?.data?.statusMessage || err?.statusMessage || t('warranty.error')
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await $fetch<{ warranties: Warranty[] }>('/api/warranty')
    warranties.value = res.warranties
  } catch (e: unknown) {
    error.value = readErr(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- register form ---------------------------------------------------------
interface WarrantyForm {
  vin: string
  partSku: string
  startDate: string
  months: number
}
function emptyForm(): WarrantyForm {
  return { vin: '', partSku: '', startDate: '', months: 12 }
}
const form = reactive<WarrantyForm>(emptyForm())
const showForm = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)

function openCreate() {
  Object.assign(form, emptyForm())
  formError.value = null
  showForm.value = true
}
function closeForm() {
  showForm.value = false
}

async function save() {
  saving.value = true
  formError.value = null
  try {
    await $fetch('/api/warranty', {
      method: 'POST',
      body: {
        vin: form.vin.trim(),
        partSku: form.partSku.trim(),
        startDate: form.startDate,
        months: Number(form.months),
      },
    })
    showForm.value = false
    await load()
  } catch (e: unknown) {
    formError.value = readErr(e)
  } finally {
    saving.value = false
  }
}

async function voidWarranty(w: Warranty) {
  if (!confirm(t('warranty.status.void') + ' — ' + w.warrantyNo + '?')) return
  try {
    await $fetch(`/api/warranty/${w.id}/void`, { method: 'POST' })
    await load()
  } catch (e: unknown) {
    error.value = readErr(e)
  }
}

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'

// DataTable columns. The trailing actions column is admin-only.
const columns = computed(() => {
  const cols: { key: string; label: string; mono?: boolean; align?: 'left' | 'right' }[] = [
    { key: 'warrantyNo', label: t('warranty.warrantyNo') },
    { key: 'vin', label: t('warranty.vin'), mono: true },
    { key: 'partSku', label: t('warranty.part') },
    { key: 'startDate', label: t('warranty.start') },
    { key: 'expiresAt', label: t('warranty.expires') },
    { key: 'months', label: t('warranty.months') },
    { key: 'status', label: t('warranty.status') },
  ]
  if (isAdmin.value) cols.push({ key: 'actions', label: '', align: 'right' })
  return cols
})
</script>

<template>
  <div class="space-y-5">
    <!-- toolbar -->
    <div class="flex flex-wrap items-center justify-end gap-3">
      <AppButton v-if="canRegister" size="sm" @click="openCreate">
        + {{ t('warranty.register') }}
      </AppButton>
    </div>

    <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>

    <EmptyState v-if="!loading && warranties.length === 0" icon="🛡️" :title="t('warranty.empty')" />

    <DataTable v-else-if="warranties.length" :columns="columns" :rows="warranties">
      <template #cell-status="{ row }">
        <StatusBadge :status="row.status" :label="t('warranty.status.' + row.status)" />
      </template>
      <template #cell-actions="{ row }">
        <AppButton
          v-if="row.status === 'active'"
          variant="danger"
          size="sm"
          @click="voidWarranty(row)"
        >
          {{ t('warranty.status.void') }}
        </AppButton>
      </template>
    </DataTable>

    <!-- register modal -->
    <AppModal :open="showForm" :title="t('warranty.register')" @close="closeForm">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('warranty.vin') }}</label>
          <input v-model="form.vin" type="text" maxlength="17" :class="fld">
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('warranty.part') }}</label>
          <input v-model="form.partSku" type="text" :class="fld">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('warranty.start') }}</label>
            <input v-model="form.startDate" type="date" :class="fld">
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-muted">{{ t('warranty.months') }}</label>
            <input v-model.number="form.months" type="number" min="1" :class="fld">
          </div>
        </div>

        <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" :disabled="saving" @click="closeForm">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton size="sm" :disabled="saving" @click="save">
          {{ t('common.save') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
