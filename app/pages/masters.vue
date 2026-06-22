<script setup lang="ts">
// /masters — Master Data management (Phase B Wave 2). Admin-only.
// Tabbed CRUD over the registered master tables. Operational masters
// (suppliers, carriers, creditTerms, claimReasons, priceTiers, appConfig) are
// fully editable; derived/reference masters (warehouses, partCategories,
// provinces, vehicleModels) are read-only here. Route is role-gated by
// middleware via useNav; we also guard defensively on the client.
const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.masters.title'), t('page.masters.subtitle'))

if (import.meta.client && !can(['admin'])) {
  await navigateTo('/dashboard')
}

// ---- field definitions (drive both the table columns and the form) --------
type FieldType = 'text' | 'number' | 'boolean'
interface FieldDef {
  key: string
  labelKey: string
  type: FieldType
  optional?: boolean
}

interface MasterTab {
  entity: string
  labelKey: string
  editable: boolean
  fields: FieldDef[]
}

// Field sets mirror server/api/masters/registry.ts (and schema.ts).
const TABS: MasterTab[] = [
  // ---- operational (editable) ----
  {
    entity: 'suppliers',
    labelKey: 'masters.tab.suppliers',
    editable: true,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
      { key: 'leadTimeDays', labelKey: 'masters.field.leadTimeDays', type: 'number' },
      { key: 'contact', labelKey: 'masters.field.contact', type: 'text', optional: true },
    ],
  },
  {
    entity: 'carriers',
    labelKey: 'masters.tab.carriers',
    editable: true,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
    ],
  },
  {
    entity: 'creditTerms',
    labelKey: 'masters.tab.creditTerms',
    editable: true,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'days', labelKey: 'masters.field.days', type: 'number' },
      { key: 'nameTh', labelKey: 'masters.field.nameTh', type: 'text' },
    ],
  },
  {
    entity: 'claimReasons',
    labelKey: 'masters.tab.claimReasons',
    editable: true,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'nameTh', labelKey: 'masters.field.nameTh', type: 'text' },
    ],
  },
  {
    entity: 'priceTiers',
    labelKey: 'masters.tab.priceTiers',
    editable: true,
    fields: [
      { key: 'grade', labelKey: 'masters.field.grade', type: 'text' },
      { key: 'discountPct', labelKey: 'masters.field.discountPct', type: 'number' },
      { key: 'nameTh', labelKey: 'masters.field.nameTh', type: 'text', optional: true },
    ],
  },
  {
    entity: 'appConfig',
    labelKey: 'masters.tab.appConfig',
    editable: true,
    fields: [
      { key: 'key', labelKey: 'masters.field.key', type: 'text' },
      { key: 'value', labelKey: 'masters.field.value', type: 'text' },
    ],
  },
  {
    entity: 'dealers',
    labelKey: 'masters.tab.dealers',
    editable: true,
    // creditUsed is system-managed (not editable); createdAt is server-stamped.
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
      { key: 'province', labelKey: 'masters.field.province', type: 'text' },
      { key: 'phone', labelKey: 'masters.field.phone', type: 'text' },
      { key: 'grade', labelKey: 'masters.field.grade', type: 'text' },
      { key: 'creditLimit', labelKey: 'masters.field.creditLimit', type: 'number' },
    ],
  },
  // ---- reference (read-only) ----
  {
    entity: 'warehouses',
    labelKey: 'masters.tab.warehouses',
    editable: false,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
      { key: 'province', labelKey: 'masters.field.province', type: 'text', optional: true },
    ],
  },
  {
    entity: 'partCategories',
    labelKey: 'masters.tab.partCategories',
    editable: false,
    fields: [
      { key: 'code', labelKey: 'masters.field.code', type: 'text' },
      { key: 'nameTh', labelKey: 'masters.field.nameTh', type: 'text' },
    ],
  },
  {
    entity: 'provinces',
    labelKey: 'masters.tab.provinces',
    editable: false,
    fields: [
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
      { key: 'region', labelKey: 'masters.field.region', type: 'text' },
    ],
  },
  {
    entity: 'vehicleModels',
    labelKey: 'masters.tab.vehicleModels',
    editable: false,
    fields: [
      { key: 'name', labelKey: 'masters.field.name', type: 'text' },
      { key: 'active', labelKey: 'masters.field.active', type: 'boolean' },
    ],
  },
]

type Row = Record<string, unknown> & { id: number }

const activeEntity = ref<string>(TABS[0]!.entity)
const activeTab = computed(() => TABS.find((tab) => tab.entity === activeEntity.value)!)

const rows = ref<Row[]>([])
const loading = ref(false)
const banner = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)

function flash(tone: 'ok' | 'error', text: string) {
  banner.value = { tone, text }
}

async function load() {
  loading.value = true
  banner.value = null
  try {
    const res = await $fetch<{ rows: Row[] }>(`/api/masters/${activeEntity.value}`)
    rows.value = res.rows
  } catch {
    rows.value = []
    flash('error', t('masters.toast.error'))
  } finally {
    loading.value = false
  }
}

watch(activeEntity, load, { immediate: true })

// ---- table columns (fields + an actions column for editable masters) -------
const columns = computed(() => {
  const cols = activeTab.value.fields.map((f) => ({
    key: f.key,
    label: t(f.labelKey),
    mono: f.key === 'code' || f.key === 'key',
  }))
  if (activeTab.value.editable) {
    cols.push({ key: '_actions', label: t('masters.col.actions'), mono: false })
  }
  return cols
})

// ---- create / edit form ----------------------------------------------------
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref<Record<string, unknown>>({})
const saving = ref(false)

function blankForm(): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const field of activeTab.value.fields) {
    f[field.key] = field.type === 'boolean' ? true : field.type === 'number' ? 0 : ''
  }
  return f
}

function openCreate() {
  editingId.value = null
  form.value = blankForm()
  showForm.value = true
}

function openEdit(row: Row) {
  editingId.value = row.id
  const f: Record<string, unknown> = {}
  for (const field of activeTab.value.fields) {
    const v = row[field.key]
    f[field.key] = field.type === 'boolean' ? Boolean(v) : (v ?? (field.type === 'number' ? 0 : ''))
  }
  form.value = f
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
}

function buildPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of activeTab.value.fields) {
    let v = form.value[field.key]
    if (field.type === 'number') v = Number(v)
    if (field.type === 'text' && typeof v === 'string') v = v.trim()
    if (field.optional && (v === '' || v == null)) {
      payload[field.key] = null
      continue
    }
    payload[field.key] = v
  }
  return payload
}

async function submitForm() {
  saving.value = true
  try {
    const payload = buildPayload()
    if (editingId.value != null) {
      await $fetch(`/api/masters/${activeEntity.value}/${editingId.value}`, {
        method: 'PUT',
        body: payload,
      })
      flash('ok', t('masters.toast.updated'))
    } else {
      await $fetch(`/api/masters/${activeEntity.value}`, { method: 'POST', body: payload })
      flash('ok', t('masters.toast.created'))
    }
    closeForm()
    await load()
  } catch (err: unknown) {
    const msg =
      (err as { data?: { statusMessage?: string }; statusMessage?: string })?.data
        ?.statusMessage ||
      (err as { statusMessage?: string })?.statusMessage ||
      t('masters.toast.error')
    flash('error', msg)
  } finally {
    saving.value = false
  }
}

async function removeRow(row: Row) {
  if (import.meta.client && !window.confirm(t('masters.confirm.delete'))) return
  try {
    await $fetch(`/api/masters/${activeEntity.value}/${row.id}`, { method: 'DELETE' })
    flash('ok', t('masters.toast.deleted'))
    await load()
  } catch {
    flash('error', t('masters.toast.error'))
  }
}

function cellDisplay(row: Row, field: FieldDef): string {
  const v = row[field.key]
  if (field.type === 'boolean') return v ? '✓' : '—'
  if (v == null || v === '') return '—'
  return String(v)
}

const editableTabs = computed(() => TABS.filter((tabb) => tabb.editable))
const referenceTabs = computed(() => TABS.filter((tabb) => !tabb.editable))
</script>

<template>
  <div class="space-y-5">
    <!-- Tab groups -->
    <AppCard>
      <div class="space-y-3">
        <div>
          <p class="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
            {{ t('masters.group.operational') }}
          </p>
          <div class="flex flex-wrap gap-2">
            <CategoryChip
              v-for="tabb in editableTabs"
              :key="tabb.entity"
              :active="tabb.entity === activeEntity"
              @click="activeEntity = tabb.entity"
            >
              {{ t(tabb.labelKey) }}
            </CategoryChip>
          </div>
        </div>
        <div>
          <p class="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
            {{ t('masters.group.reference') }}
          </p>
          <div class="flex flex-wrap gap-2">
            <CategoryChip
              v-for="tabb in referenceTabs"
              :key="tabb.entity"
              :active="tabb.entity === activeEntity"
              @click="activeEntity = tabb.entity"
            >
              {{ t(tabb.labelKey) }}
            </CategoryChip>
          </div>
        </div>
      </div>
    </AppCard>

    <!-- Feedback banner -->
    <div
      v-if="banner"
      class="rounded-lg border px-4 py-2.5 text-sm"
      :class="banner.tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'"
    >
      {{ banner.text }}
    </div>

    <!-- Active master table -->
    <AppCard :title="t(activeTab.labelKey)">
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <DataPorter
            :export-url="`/api/masters/${activeEntity}/export`"
            :export-filename="`${activeEntity}.xlsx`"
            :import-url="activeTab.editable ? `/api/masters/${activeEntity}/import` : undefined"
            @imported="load"
          />
          <AppButton v-if="activeTab.editable" size="sm" @click="openCreate">
            + {{ t('masters.action.add') }}
          </AppButton>
          <span
            v-else
            class="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted"
          >
            {{ t('masters.group.reference') }}
          </span>
        </div>
      </template>

      <p v-if="!activeTab.editable" class="mb-3 text-xs text-muted">
        {{ t('masters.readonly.note') }}
      </p>

      <EmptyState
        v-if="!loading && !rows.length"
        :title="t('masters.empty.title')"
      >
        {{ activeTab.editable ? t('masters.empty.body') : '' }}
      </EmptyState>

      <DataTable v-else :columns="columns" :rows="rows">
        <template
          v-for="field in activeTab.fields"
          :key="field.key"
          #[`cell-${field.key}`]="{ row }"
        >
          {{ cellDisplay(row as Row, field) }}
        </template>

        <template #cell-_actions="{ row }">
          <div class="flex gap-2">
            <AppButton size="sm" variant="outline" @click="openEdit(row as Row)">
              {{ t('masters.action.edit') }}
            </AppButton>
            <AppButton size="sm" variant="danger" @click="removeRow(row as Row)">
              {{ t('masters.action.delete') }}
            </AppButton>
          </div>
        </template>
      </DataTable>
    </AppCard>

    <!-- Create / edit modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeForm"
    >
      <div class="w-full max-w-md rounded-2xl border border-app bg-surface p-5">
        <h3 class="mb-4 text-base font-bold text-app">
          {{ editingId != null ? t('masters.form.edit.title') : t('masters.form.create.title') }}
        </h3>
        <form class="space-y-3" @submit.prevent="submitForm">
          <div v-for="field in activeTab.fields" :key="field.key">
            <label class="mb-1 block text-xs font-medium text-muted">
              {{ t(field.labelKey) }}
            </label>
            <label v-if="field.type === 'boolean'" class="flex items-center gap-2 text-sm text-app">
              <input v-model="form[field.key]" type="checkbox" class="h-4 w-4" >
              {{ t('masters.field.active') }}
            </label>
            <input
              v-else
              v-model="form[field.key]"
              :type="field.type === 'number' ? 'number' : 'text'"
              class="w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app placeholder:text-muted focus:border-brand-600 focus:outline-none"
            >
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <AppButton type="button" variant="ghost" @click="closeForm">
              {{ t('action.cancel') }}
            </AppButton>
            <AppButton type="submit" :disabled="saving">
              {{ t('action.save') }}
            </AppButton>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
