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

// Inline status pill tones (active/expired/void). Light + dark friendly.
const pillTone = (s: string) =>
  s === 'active'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
    : s === 'void'
      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
      : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300'

// Shared input field classes (kept in script to avoid a Tailwind @apply block).
const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'
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

    <AppCard v-else-if="warranties.length" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-app text-left text-xs text-muted">
            <th class="px-3 py-2 font-medium">{{ t('warranty.warrantyNo') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.vin') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.part') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.start') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.expires') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.months') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('warranty.status') }}</th>
            <th v-if="isAdmin" class="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in warranties" :key="w.id" class="border-b border-app/60">
            <td class="px-3 py-2 font-medium text-app">{{ w.warrantyNo }}</td>
            <td class="px-3 py-2">
              <code class="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-app">{{ w.vin }}</code>
            </td>
            <td class="px-3 py-2 text-app">{{ w.partSku }}</td>
            <td class="px-3 py-2 text-muted">{{ w.startDate }}</td>
            <td class="px-3 py-2 text-muted">{{ w.expiresAt }}</td>
            <td class="px-3 py-2 text-muted">{{ w.months }}</td>
            <td class="px-3 py-2">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                :class="pillTone(w.status)"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-current" />
                {{ t('warranty.status.' + w.status) }}
              </span>
            </td>
            <td v-if="isAdmin" class="px-3 py-2 text-right">
              <AppButton
                v-if="w.status === 'active'"
                variant="danger"
                size="sm"
                @click="voidWarranty(w)"
              >
                {{ t('warranty.status.void') }}
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </AppCard>

    <!-- register drawer -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeForm"
    >
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-app">{{ t('warranty.register') }}</h2>
          <button class="text-muted hover:text-app" @click="closeForm">✕</button>
        </div>

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

          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="outline" size="sm" :disabled="saving" @click="closeForm">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton size="sm" :disabled="saving" @click="save">
              {{ t('common.save') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
