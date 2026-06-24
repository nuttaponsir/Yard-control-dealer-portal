<script setup lang="ts">
// /claims — Dev3 owns. Left: scan VIN → purchase history → file claim.
//           Right: recent claims list with status badges.
import { reactive } from 'vue'
import { statusLabel, thb } from '~/utils/labels'
import type { Claim, ClaimResolution } from '~/types'

const { t } = useI18n()
const { role } = useAuth()
const canManage = computed(() => role.value === 'admin' || role.value === 'warehouse')

usePageTitle().set(t('page.claims.title'), t('claims.subtitle'))

interface PurchaseHistoryItem {
  orderId: number
  poNumber: string
  partId: number
  sku: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  createdAt: string
}
type ClaimRow = Claim & { partName?: string }

// ---- recent claims ---------------------------------------------------------
const { data: claimsData, refresh: refreshClaims } =
  await useFetch<{ claims: ClaimRow[] }>('/api/claims')
const claims = computed(() => claimsData.value?.claims ?? [])

// ---- claim management (admin/warehouse): status + resolution ---------------
const { data: resData } = useFetch<{ resolutions: ClaimResolution[] }>('/api/claim-resolutions', {
  default: () => ({ resolutions: [] }),
})
const resolutions = computed(() => resData.value?.resolutions ?? [])
const resolutionLabel = (code: string | null) =>
  code ? (resolutions.value.find((r) => r.code === code)?.nameTh ?? code) : null
const CLAIM_STATUSES = ['submitted', 'reviewing', 'approved', 'rejected'] as const

// per-card edit drafts (id → {status, resolution}); presence = panel open
const draft = reactive<Record<number, { status: string; resolution: string }>>({})
const savingId = ref<number | null>(null)
function startEdit(c: ClaimRow) {
  draft[c.id] = { status: c.status, resolution: c.resolution ?? '' }
}
function cancelEdit(id: number) {
  delete draft[id]
}
async function saveClaim(c: ClaimRow) {
  const d = draft[c.id]
  if (!d) return
  savingId.value = c.id
  try {
    await $fetch(`/api/claims/${c.id}`, {
      method: 'PATCH',
      body: { status: d.status, resolution: d.resolution || null },
    })
    delete draft[c.id]
    await refreshClaims()
  } finally {
    savingId.value = null
  }
}

// ---- VIN scan + purchase history ------------------------------------------
const vinInput = ref('')
const history = ref<PurchaseHistoryItem[] | null>(null)
const scanning = ref(false)
const scannedVin = ref('')

async function scan() {
  const vin = vinInput.value.trim()
  if (!vin) return
  scanning.value = true
  try {
    const res = await $fetch<{ vin: string; history: PurchaseHistoryItem[] }>('/api/claims', {
      query: { vin },
    })
    history.value = res.history
    scannedVin.value = vin
    selected.value = null
  } finally {
    scanning.value = false
  }
}

// ---- file-claim form -------------------------------------------------------
const selected = ref<PurchaseHistoryItem | null>(null)
const reason = ref('')
const submitting = ref(false)

async function fileClaim() {
  if (!selected.value || !reason.value.trim() || !scannedVin.value) return
  submitting.value = true
  try {
    await $fetch('/api/claims', {
      method: 'POST',
      body: {
        vin: scannedVin.value,
        partSku: selected.value.sku,
        reason: reason.value.trim(),
        orderId: selected.value.orderId, // bind the claim to the ordered item
      },
    })
    reason.value = ''
    selected.value = null
    await refreshClaims()
  } finally {
    submitting.value = false
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="grid gap-5 lg:grid-cols-2">
    <!-- LEFT: scan VIN → history → file claim -->
    <div class="space-y-5">
      <AppCard :title="t('claims.scan.title')">
        <form class="flex gap-2" @submit.prevent="scan">
          <input
            v-model="vinInput"
            :placeholder="t('claims.scan.placeholder')"
            class="code w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app outline-none focus:border-brand-600"
          >
          <AppButton type="submit" :disabled="scanning">{{ t('claims.scan.button') }}</AppButton>
        </form>

        <div v-if="history !== null" class="mt-4">
          <EmptyState
            v-if="!history.length"
            icon="🔍"
            :title="t('claims.scan.noHistory')"
          />
          <ul v-else class="space-y-2">
            <li
              v-for="item in history"
              :key="`${item.orderId}-${item.partId}`"
              class="cursor-pointer rounded-lg border bg-app p-3 transition"
              :class="selected?.partId === item.partId && selected?.orderId === item.orderId
                ? 'border-brand-600'
                : 'border-app hover:border-brand-600/50'"
              @click="selected = item"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-sm font-semibold text-app">{{ item.name }}</p>
                  <p class="code mt-0.5 text-xs text-muted">{{ item.sku }}</p>
                </div>
                <span class="text-sm font-semibold text-app">{{ thb(item.unitPrice) }}</span>
              </div>
              <p class="code mt-1 text-[11px] text-muted">
                {{ item.poNumber }} · {{ t('claims.history.qty') }} {{ item.qty }} · {{ fmtDate(item.createdAt) }}
              </p>
            </li>
          </ul>
        </div>
      </AppCard>

      <AppCard v-if="selected" :title="t('claims.file.title')" :subtitle="selected.name">
        <form class="space-y-3" @submit.prevent="fileClaim">
          <div class="rounded-lg border border-app bg-app p-3 text-sm">
            <p class="code text-xs text-muted">{{ selected.sku }} · {{ scannedVin }}</p>
            <p class="mt-1 font-semibold text-app">{{ selected.name }}</p>
          </div>
          <textarea
            v-model="reason"
            rows="3"
            :placeholder="t('claims.file.reason')"
            class="w-full rounded-lg border border-app bg-app px-3 py-2 text-sm text-app outline-none focus:border-brand-600"
          />
          <AppButton type="submit" :disabled="submitting || !reason.trim()" class="w-full">
            {{ t('claims.file.submit') }}
          </AppButton>
        </form>
      </AppCard>
    </div>

    <!-- RIGHT: recent claims -->
    <AppCard :title="t('claims.recent.title')">
      <template #actions>
        <DataPorter :export-url="'/api/claims/export'" :export-filename="'claims.xlsx'" />
      </template>
      <EmptyState v-if="!claims.length" icon="🛡" :title="t('claims.recent.empty')" />
      <div v-else class="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <article
          v-for="c in claims"
          :key="c.id"
          class="rounded-xl border border-app bg-app p-4"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="code text-sm font-semibold text-app">{{ c.claimNumber }}</p>
              <p class="mt-0.5 text-sm text-app">
                {{ c.partName ?? c.partSku }}
                <span class="code text-xs text-muted">({{ c.partSku }})</span>
              </p>
            </div>
            <StatusBadge :status="c.status" :label="statusLabel(c.status)" />
          </div>
          <p class="mt-2 text-sm text-muted">{{ c.reason }}</p>
          <div class="mt-2 flex items-center justify-between text-xs">
            <span class="text-muted">{{ fmtDate(c.createdAt) }}</span>
            <span class="font-semibold text-app">{{ thb(c.amount) }}</span>
          </div>

          <!-- resolution outcome + linked RMA -->
          <div v-if="c.resolution || c.returnId" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              v-if="c.resolution"
              class="rounded-md bg-surface-2 px-2 py-0.5 font-semibold text-app"
            >
              {{ t('claims.manage.resolution') }}: {{ resolutionLabel(c.resolution) }}
            </span>
            <NuxtLink v-if="c.returnId" to="/returns" class="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              {{ t('claims.manage.viewRma') }} →
            </NuxtLink>
          </div>

          <!-- manage (admin/warehouse) -->
          <div v-if="canManage" class="mt-3 border-t border-app pt-3">
            <AppButton v-if="!draft[c.id]" size="sm" variant="outline" @click="startEdit(c)">
              {{ t('claims.manage.button') }}
            </AppButton>
            <div v-else class="space-y-2">
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block">
                  <span class="text-xs text-muted">{{ t('claims.manage.status') }}</span>
                  <select
                    v-model="draft[c.id].status"
                    class="mt-1 w-full rounded-lg border border-app bg-app px-2 py-1.5 text-sm text-app outline-none focus:border-brand-600"
                  >
                    <option v-for="s in CLAIM_STATUSES" :key="s" :value="s">{{ statusLabel(s) }}</option>
                  </select>
                </label>
                <label class="block">
                  <span class="text-xs text-muted">{{ t('claims.manage.resolution') }}</span>
                  <select
                    v-model="draft[c.id].resolution"
                    class="mt-1 w-full rounded-lg border border-app bg-app px-2 py-1.5 text-sm text-app outline-none focus:border-brand-600"
                  >
                    <option value="">{{ t('claims.manage.noResolution') }}</option>
                    <option v-for="r in resolutions" :key="r.code" :value="r.code">
                      {{ r.nameTh }}{{ r.refundable ? ` (${t('claims.manage.refundHint')})` : '' }}
                    </option>
                  </select>
                </label>
              </div>
              <p
                v-if="resolutions.find((r) => r.code === draft[c.id].resolution)?.refundable"
                class="text-xs text-amber-600 dark:text-amber-400"
              >
                ⚠ {{ t('claims.manage.refundNote') }}
              </p>
              <div class="flex gap-2">
                <AppButton size="sm" :disabled="savingId === c.id" @click="saveClaim(c)">
                  {{ t('action.save') }}
                </AppButton>
                <AppButton size="sm" variant="outline" @click="cancelEdit(c.id)">
                  {{ t('action.cancel') }}
                </AppButton>
              </div>
            </div>
          </div>
        </article>
      </div>
    </AppCard>
  </div>
</template>
