<script setup lang="ts">
// /settings — admin-only system configuration. Renders the typed config catalog
// (from /api/settings) grouped into cards with the right input per type, and
// saves changed values back via PUT. Friendlier than the raw appConfig master.
const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.settings.title'), t('page.settings.subtitle'))

// Defensive client gate (middleware already blocks non-admins).
if (import.meta.client && !can(['admin'])) {
  await navigateTo('/dashboard')
}

interface SettingOption {
  value: string
  label: string
}
interface Setting {
  key: string
  label: string
  help: string
  group: string
  type: 'number' | 'enum' | 'boolean' | 'string'
  default: string
  value: string
  options?: SettingOption[]
  min?: number
  max?: number
}
interface SettingsResponse {
  ok: boolean
  settings: Setting[]
}

const { data, refresh } = await useFetch<SettingsResponse>('/api/settings')

// Local editable copy keyed by config key.
const form = reactive<Record<string, string>>({})
watchEffect(() => {
  for (const s of data.value?.settings ?? []) {
    if (!(s.key in form)) form[s.key] = s.value
  }
})

// Group the catalog for display (preserves catalog order within each group).
const groups = computed(() => {
  const out: { name: string; items: Setting[] }[] = []
  for (const s of data.value?.settings ?? []) {
    let g = out.find((x) => x.name === s.group)
    if (!g) {
      g = { name: s.group, items: [] }
      out.push(g)
    }
    g.items.push(s)
  }
  return out
})

// Dirty = any field differs from the server value.
const dirty = computed(() =>
  (data.value?.settings ?? []).some((s) => form[s.key] !== s.value),
)

const saving = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)

async function save() {
  saving.value = true
  message.value = null
  error.value = null
  // Only send changed keys.
  const values: Record<string, string> = {}
  for (const s of data.value?.settings ?? []) {
    if (form[s.key] !== s.value) values[s.key] = form[s.key]!
  }
  if (Object.keys(values).length === 0) {
    saving.value = false
    return
  }
  try {
    await $fetch('/api/settings', { method: 'PUT', body: { values } })
    await refresh()
    message.value = t('settings.saved')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
    error.value = err?.data?.statusMessage || err?.statusMessage || t('settings.error')
  } finally {
    saving.value = false
  }
}

function reset() {
  for (const s of data.value?.settings ?? []) form[s.key] = s.value
  message.value = null
  error.value = null
}
</script>

<template>
  <div class="space-y-5">
    <AppCard
      v-for="g in groups"
      :key="g.name"
      :title="g.name"
    >
      <ul class="divide-y divide-app">
        <li
          v-for="s in g.items"
          :key="s.key"
          class="grid gap-2 py-4 md:grid-cols-[1fr_auto] md:items-center md:gap-6"
        >
          <div class="min-w-0">
            <p class="text-sm font-semibold text-app">{{ s.label }}</p>
            <p class="mt-0.5 text-xs text-muted">{{ s.help }}</p>
            <p class="code mt-0.5 text-[11px] text-muted/70">{{ s.key }}</p>
          </div>
          <div class="md:w-64">
            <select
              v-if="s.type === 'enum'"
              v-model="form[s.key]"
              class="w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none"
            >
              <option v-for="o in s.options" :key="o.value" :value="o.value">
                {{ o.label }}
              </option>
            </select>
            <input
              v-else-if="s.type === 'number'"
              v-model="form[s.key]"
              type="number"
              :min="s.min"
              :max="s.max"
              class="w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none"
            >
            <label
              v-else-if="s.type === 'boolean'"
              class="flex items-center gap-2 text-sm text-app"
            >
              <input
                type="checkbox"
                :checked="form[s.key] === 'true'"
                @change="form[s.key] = ($event.target as HTMLInputElement).checked ? 'true' : 'false'"
              >
              {{ form[s.key] === 'true' ? t('common.on') : t('common.off') }}
            </label>
            <input
              v-else
              v-model="form[s.key]"
              type="text"
              class="w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none"
            >
          </div>
        </li>
      </ul>
    </AppCard>

    <!-- Save bar -->
    <div class="flex items-center justify-end gap-3">
      <p v-if="message" class="text-xs text-emerald-400">{{ message }}</p>
      <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>
      <AppButton variant="outline" size="sm" :disabled="!dirty || saving" @click="reset">
        {{ t('common.reset') }}
      </AppButton>
      <AppButton size="sm" :disabled="!dirty || saving" @click="save">
        {{ saving ? t('settings.saving') : t('common.save') }}
      </AppButton>
    </div>
  </div>
</template>
