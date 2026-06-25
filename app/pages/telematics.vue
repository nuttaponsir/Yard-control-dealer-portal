<script setup lang="ts">
// /telematics — Phase 5 (Autologic Telematics). Device registry + recent event
// feed for admin/owner/sales/warehouse. Online/offline is derived from each
// device's lastConnectedAt (online if within the last 7 days). admin/warehouse
// can push a firmware version per device via a small modal.
import { computed, ref } from 'vue'
import type { TelematicsEvent, TelematicsEventType, TelematicsSeverity, Vin } from '~/types'

interface Device {
  vin: string
  model: string
  modelYear: number
  deviceSerial: string | null
  firmware: string | null
  lastConnectedAt: string | null
  autologicInstalled: boolean
  status: string
}

const { t } = useI18n()
const { can } = useAuth()

usePageTitle().set(t('page.telematics.title'), t('page.telematics.subtitle'))

const canPush = computed(() => can(['admin', 'warehouse']))

const { data, refresh } = await useFetch<{ devices: Device[]; events: TelematicsEvent[] }>(
  '/api/telematics',
  { default: () => ({ devices: [], events: [] }) },
)
const devices = computed(() => data.value?.devices ?? [])
const events = computed(() => data.value?.events ?? [])

// ---- VIN search + lookup (absorbed from the old /vin page) ------------------
// Filters the device table; for a full 17-char VIN not in the fleet it falls
// back to GET /api/vin to report Autologic install status (incl. not-installed).
const vinQuery = ref('')
const lookupRow = ref<Vin | null>(null)
const lookupSearched = ref(false)
const lookupError = ref('')

const filteredDevices = computed(() => {
  const q = vinQuery.value.trim().toLowerCase()
  if (!q) return devices.value
  return devices.value.filter(
    (d) => d.vin.toLowerCase().includes(q) || d.model.toLowerCase().includes(q),
  )
})

async function lookupVin() {
  lookupError.value = ''
  lookupRow.value = null
  lookupSearched.value = false
  const vin = vinQuery.value.trim().toUpperCase()
  if (vin.length !== 17) return // shorter queries just filter the table
  try {
    const { vin: row } = await $fetch<{ vin: Vin | null }>(`/api/vin/${encodeURIComponent(vin)}`)
    lookupRow.value = row
    lookupSearched.value = true
  } catch {
    lookupError.value = t('telematics.error')
  }
}

const ONLINE_WINDOW_MS = 7 * 86400000
function isOnline(d: Device): boolean {
  if (!d.lastConnectedAt) return false
  return Date.now() - new Date(d.lastConnectedAt).getTime() <= ONLINE_WINDOW_MS
}

function thaiDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const severityDot: Record<TelematicsSeverity, string> = {
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  critical: 'bg-rose-500',
}

// ---- firmware push modal ---------------------------------------------------
const showPush = ref(false)
const pushVin = ref<string | null>(null)
const pushModel = ref('')
const fwVersion = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)

function openPush(d: Device) {
  formError.value = null
  pushVin.value = d.vin
  pushModel.value = `${d.model} · ${d.vin}`
  fwVersion.value = d.firmware ?? ''
  showPush.value = true
}
function closePush() {
  showPush.value = false
}

async function submitPush() {
  formError.value = null
  if (!pushVin.value || !fwVersion.value.trim()) {
    formError.value = t('telematics.error')
    return
  }
  submitting.value = true
  try {
    await $fetch('/api/telematics/firmware', {
      method: 'POST',
      body: { vin: pushVin.value, firmware: fwVersion.value.trim() },
    })
    closePush()
    await refresh()
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    formError.value = msg || t('telematics.error')
  } finally {
    submitting.value = false
  }
}

const fld =
  'w-full rounded-lg border border-app bg-surface-2 px-3 py-1.5 text-sm text-app focus:border-brand-600 focus:outline-none'

// ---- simulate a device event (demo of the ingestion endpoint) --------------
const SIM_TYPES: TelematicsEventType[] = ['connect', 'heartbeat', 'fault', 'geofence', 'firmware_update', 'disconnect']
const simVin = ref('')
const simType = ref<TelematicsEventType>('heartbeat')
const simBusy = ref(false)

async function simulateEvent() {
  if (!simVin.value) simVin.value = devices.value[0]?.vin ?? ''
  if (!simVin.value) return
  simBusy.value = true
  try {
    await $fetch('/api/telematics/ingest', { method: 'POST', body: { vin: simVin.value, type: simType.value } })
    await refresh()
  } catch {
    // ignore — best-effort demo control
  } finally {
    simBusy.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- devices -->
    <AppCard :title="t('telematics.devices')">
      <!-- VIN search + lookup (consolidated from the old VIN-check page) -->
      <div class="mb-3 flex flex-wrap gap-2">
        <input
          v-model="vinQuery"
          maxlength="17"
          :placeholder="t('telematics.searchPlaceholder')"
          class="code min-w-0 flex-1 rounded-lg border border-app bg-app px-3 py-2 text-sm uppercase text-app outline-none focus:border-brand-600"
          @keyup.enter="lookupVin"
        >
        <AppButton variant="outline" :disabled="vinQuery.trim().length !== 17" @click="lookupVin">
          {{ t('telematics.lookup') }}
        </AppButton>
      </div>

      <!-- inline lookup result for a full VIN not in the fleet table -->
      <div
        v-if="lookupSearched && lookupRow && !filteredDevices.some((d) => d.vin === lookupRow!.vin)"
        class="mb-3 rounded-xl border p-3 text-sm"
        :class="lookupRow.autologicInstalled
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
          : 'border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'"
      >
        <span class="font-semibold" :class="lookupRow.autologicInstalled ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'">
          {{ lookupRow.autologicInstalled ? t('telematics.online') : t('vin.blocked.title') }}
        </span>
        <span class="ml-2 text-app">{{ lookupRow.model }} · {{ lookupRow.modelYear }}</span>
        <span class="code ml-2 text-xs text-muted">{{ lookupRow.vin }}</span>
      </div>
      <p v-else-if="lookupSearched && !lookupRow" class="mb-3 text-sm text-muted">❓ {{ t('catalog.scan.notFound') }}</p>
      <p v-if="lookupError" class="mb-3 text-sm text-rose-500 dark:text-rose-400">{{ lookupError }}</p>

      <EmptyState v-if="!filteredDevices.length" icon="📡" :title="t('telematics.empty')" />
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-app text-xs text-muted">
              <th class="px-3 py-2 font-medium">{{ t('telematics.device') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('telematics.status') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('telematics.firmware') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('telematics.lastConnected') }}</th>
              <th v-if="canPush" class="px-3 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in filteredDevices" :key="d.vin" class="border-b border-app/60">
              <td class="px-3 py-2">
                <div class="font-medium text-app">{{ d.model }} <span class="text-muted">{{ d.modelYear }}</span></div>
                <div class="font-mono text-xs text-muted">{{ d.vin }}</div>
              </td>
              <td class="px-3 py-2">
                <StatusBadge
                  :status="isOnline(d) ? 'active' : 'inactive'"
                  :label="isOnline(d) ? t('telematics.online') : t('telematics.offline')"
                />
              </td>
              <td class="px-3 py-2 font-mono text-xs text-app">{{ d.firmware ?? '—' }}</td>
              <td class="px-3 py-2 text-muted">{{ thaiDateTime(d.lastConnectedAt) }}</td>
              <td v-if="canPush" class="px-3 py-2 text-right">
                <AppButton variant="outline" size="sm" @click="openPush(d)">
                  {{ t('telematics.pushFirmware') }}
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <!-- events -->
    <AppCard :title="t('telematics.events')">
      <!-- simulate a device event (demonstrates the ingestion endpoint) -->
      <div v-if="canPush" class="mb-3 flex flex-wrap items-center gap-2 border-b border-app pb-3">
        <select v-model="simVin" :class="fld" class="max-w-[220px]">
          <option value="" disabled>{{ t('telematics.device') }}</option>
          <option v-for="d in devices" :key="d.vin" :value="d.vin">{{ d.model }} · {{ d.vin }}</option>
        </select>
        <select v-model="simType" :class="fld" class="max-w-[170px]">
          <option v-for="ty in SIM_TYPES" :key="ty" :value="ty">{{ t(`telematics.type.${ty}`) }}</option>
        </select>
        <AppButton variant="outline" size="sm" :disabled="simBusy" @click="simulateEvent">
          {{ t('telematics.simulate') }}
        </AppButton>
      </div>

      <EmptyState v-if="!events.length" icon="📭" :title="t('telematics.eventsEmpty')" />
      <ul v-else class="divide-y divide-app/60">
        <li v-for="e in events" :key="e.id" class="flex items-start gap-3 py-2.5">
          <span
            class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            :class="severityDot[e.severity]"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-app">{{ t(`telematics.type.${e.type}`) }}</span>
              <span class="font-mono text-xs text-muted">{{ e.vin }}</span>
            </div>
            <p class="text-sm text-muted">{{ e.message }}</p>
          </div>
          <span class="shrink-0 text-xs text-muted">{{ thaiDateTime(e.createdAt) }}</span>
        </li>
      </ul>
    </AppCard>

    <!-- firmware push modal -->
    <AppModal :open="showPush" :title="t('telematics.pushFirmware')" @close="closePush">
      <div class="space-y-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('telematics.device') }}</label>
          <input type="text" :class="fld" :value="pushModel" disabled>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-muted">{{ t('telematics.firmware') }}</label>
          <input v-model="fwVersion" type="text" :class="fld" placeholder="v3.9.0">
        </div>

        <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>
      </div>

      <template #footer>
        <AppButton variant="outline" size="sm" :disabled="submitting" @click="closePush">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton size="sm" :disabled="submitting" @click="submitPush">
          {{ t('telematics.pushFirmware') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
