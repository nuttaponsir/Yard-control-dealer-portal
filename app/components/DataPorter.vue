<script setup lang="ts">
// SHARED component (Phase K). A compact Excel toolbar any module can drop in.
//   <DataPorter :export-url="..." export-filename="orders.xlsx" />
//   <DataPorter :export-url="..." :import-url="..." @imported="reload" />
// Export downloads the .xlsx the server streams. Import (optional) uploads a
// file, shows a validation preview, then commits — emitting `imported` so the
// host page can refresh its data.
const props = defineProps<{
  exportUrl: string
  exportFilename: string
  importUrl?: string
  /** Optional label shown before the buttons (e.g. the module name). */
  label?: string
}>()

const emit = defineEmits<{ imported: [committed: number] }>()
const { t } = useI18n()

const busy = ref(false)
const note = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)

function flash(tone: 'ok' | 'error', text: string) {
  note.value = { tone, text }
}

// ---- export ---------------------------------------------------------------
async function doExport() {
  busy.value = true
  note.value = null
  try {
    const res = await fetch(props.exportUrl, { credentials: 'include' })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = props.exportFilename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    flash('error', t('porter.exportError'))
  } finally {
    busy.value = false
  }
}

// ---- import ---------------------------------------------------------------
interface ImportSummary {
  total: number
  validCount: number
  invalidCount: number
  invalid: { row: number; errors: string[] }[]
  committed: number
}

const showImport = ref(false)
const file = ref<File | null>(null)
const preview = ref<ImportSummary | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function openImport() {
  showImport.value = true
  file.value = null
  preview.value = null
  note.value = null
}
function closeImport() {
  showImport.value = false
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null
  file.value = f
  preview.value = null
}

async function send(mode: 'preview' | 'commit'): Promise<ImportSummary | null> {
  if (!file.value || !props.importUrl) return null
  const fd = new FormData()
  fd.append('file', file.value)
  const res = await fetch(`${props.importUrl}?mode=${mode}`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  })
  const data = (await res.json().catch(() => null)) as
    | (ImportSummary & { statusMessage?: string })
    | null
  if (!res.ok) {
    throw new Error(data?.statusMessage || String(res.status))
  }
  return data as ImportSummary
}

async function doPreview() {
  busy.value = true
  note.value = null
  try {
    preview.value = await send('preview')
  } catch (err) {
    flash('error', (err as Error).message || t('porter.importError'))
  } finally {
    busy.value = false
  }
}

async function doCommit() {
  busy.value = true
  note.value = null
  try {
    const res = await send('commit')
    const n = res?.committed ?? 0
    flash('ok', t('porter.importDone', { n }))
    emit('imported', n)
    closeImport()
  } catch (err) {
    flash('error', (err as Error).message || t('porter.importError'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span v-if="label" class="text-xs text-muted">{{ label }}</span>
    <AppButton size="sm" variant="outline" :disabled="busy" @click="doExport">
      ⬇ {{ t('porter.export') }}
    </AppButton>
    <AppButton v-if="importUrl" size="sm" variant="subtle" :disabled="busy" @click="openImport">
      ⬆ {{ t('porter.import') }}
    </AppButton>

    <span
      v-if="note"
      class="text-xs"
      :class="note.tone === 'ok' ? 'text-emerald-400' : 'text-rose-400'"
    >
      {{ note.text }}
    </span>

    <!-- Import dialog -->
    <div
      v-if="showImport"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="closeImport"
    >
      <div class="w-full max-w-lg rounded-2xl border border-app bg-surface p-5">
        <h3 class="mb-1 text-base font-bold text-app">{{ t('porter.import') }}</h3>
        <p class="mb-4 text-xs text-muted">{{ t('porter.importHint') }}</p>

        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="mb-3 block w-full text-sm text-app file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-app"
          @change="onFile"
        >

        <!-- Preview summary -->
        <div v-if="preview" class="mb-3 space-y-2 rounded-lg border border-app bg-surface-2 p-3 text-sm">
          <div class="flex gap-4">
            <span class="text-app">{{ t('porter.total') }}: <b>{{ preview.total }}</b></span>
            <span class="text-emerald-400">{{ t('porter.valid') }}: <b>{{ preview.validCount }}</b></span>
            <span class="text-rose-400">{{ t('porter.invalid') }}: <b>{{ preview.invalidCount }}</b></span>
          </div>
          <ul
            v-if="preview.invalid.length"
            class="max-h-40 space-y-1 overflow-auto text-xs text-rose-300"
          >
            <li v-for="e in preview.invalid" :key="e.row">
              {{ t('porter.rowLabel', { n: e.row }) }}: {{ e.errors.join('; ') }}
            </li>
          </ul>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <AppButton type="button" variant="ghost" @click="closeImport">
            {{ t('action.cancel') }}
          </AppButton>
          <AppButton
            v-if="!preview"
            type="button"
            :disabled="!file || busy"
            variant="outline"
            @click="doPreview"
          >
            {{ t('porter.checkFile') }}
          </AppButton>
          <AppButton
            v-else
            type="button"
            :disabled="busy || preview.validCount === 0"
            @click="doCommit"
          >
            {{ t('porter.confirmImport', { n: preview.validCount }) }}
          </AppButton>
        </div>
      </div>
    </div>
  </div>
</template>
