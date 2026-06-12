<script setup lang="ts">
// /users — Phase G (User Management). Admin-only: create users, edit
// role/dealer/active, and reset passwords. The route is also gated by the
// global auth middleware via useNav (roles: ['admin']).
import { computed, reactive, ref } from 'vue'
import { ROLE_LABELS } from '~/utils/labels'
import type { UserRow } from '~/../server/api/users/index.get'
import type { Dealer, Role } from '~/types'

const { t } = useI18n()

usePageTitle().set(t('page.users.title'), t('page.users.subtitle'))

const ROLES: Role[] = ['admin', 'owner', 'sales', 'warehouse']
const DEALER_SCOPED: Role[] = ['owner', 'sales']

// ---- data ------------------------------------------------------------------
const { data: listData, refresh } = await useFetch<{ users: UserRow[] }>('/api/users', {
  default: () => ({ users: [] }),
})
const users = computed(() => listData.value?.users ?? [])

const { data: dealersData } = await useFetch<{ dealers: Dealer[] }>('/api/dealers', {
  default: () => ({ dealers: [] }),
})
const dealers = computed(() => dealersData.value?.dealers ?? [])

const columns = [
  { key: 'email', label: t('users.col.email') },
  { key: 'role', label: t('users.col.role') },
  { key: 'dealerName', label: t('users.col.dealer') },
  { key: 'active', label: t('users.col.status') },
  { key: 'createdAt', label: t('users.col.createdAt') },
  { key: 'actions', label: t('users.col.actions'), align: 'right' as const },
]

function thaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}
function roleLabel(r: string): string {
  return ROLE_LABELS[r] ?? r
}

const toast = ref<string | null>(null)
const formError = ref<string | null>(null)
function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => (toast.value = null), 4000)
}
function errMsg(err: unknown): string {
  return (err as { data?: { statusMessage?: string } })?.data?.statusMessage || t('users.toast.error')
}

// ---- create / edit modal ---------------------------------------------------
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = reactive<{ email: string; password: string; role: Role; dealerId: number | null; active: boolean }>({
  email: '',
  password: '',
  role: 'sales',
  dealerId: null,
  active: true,
})
const formScoped = computed(() => DEALER_SCOPED.includes(form.role))

function openCreate() {
  editingId.value = null
  form.email = ''
  form.password = ''
  form.role = 'sales'
  form.dealerId = null
  form.active = true
  formError.value = null
  showForm.value = true
}
function openEdit(u: UserRow) {
  editingId.value = u.id
  form.email = u.email
  form.password = ''
  form.role = u.role
  form.dealerId = u.dealerId
  form.active = u.active
  formError.value = null
  showForm.value = true
}
function onRoleChange() {
  if (!formScoped.value) form.dealerId = null
}

const saving = ref(false)
async function save() {
  formError.value = null
  saving.value = true
  try {
    if (editingId.value == null) {
      await $fetch('/api/users', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          dealerId: formScoped.value ? form.dealerId : null,
          active: form.active,
        },
      })
      showToast(t('users.toast.created'))
    } else {
      await $fetch(`/api/users/${editingId.value}`, {
        method: 'PUT',
        body: {
          email: form.email.trim(),
          role: form.role,
          dealerId: formScoped.value ? form.dealerId : null,
          active: form.active,
        },
      })
      showToast(t('users.toast.updated'))
    }
    showForm.value = false
    await refresh()
  } catch (err) {
    formError.value = errMsg(err)
  } finally {
    saving.value = false
  }
}

// ---- quick activate / deactivate -------------------------------------------
const busyId = ref<number | null>(null)
async function toggleActive(u: UserRow) {
  busyId.value = u.id
  try {
    await $fetch(`/api/users/${u.id}`, { method: 'PUT', body: { active: !u.active } })
    await refresh()
  } catch (err) {
    showToast(errMsg(err))
  } finally {
    busyId.value = null
  }
}

// ---- reset password modal --------------------------------------------------
const showReset = ref(false)
const resetId = ref<number | null>(null)
const resetEmail = ref('')
const newPassword = ref('')
const resetError = ref<string | null>(null)
const resetting = ref(false)

function openReset(u: UserRow) {
  resetId.value = u.id
  resetEmail.value = u.email
  newPassword.value = ''
  resetError.value = null
  showReset.value = true
}
async function submitReset() {
  resetError.value = null
  resetting.value = true
  try {
    await $fetch(`/api/users/${resetId.value}/reset-password`, {
      method: 'POST',
      body: { password: newPassword.value },
    })
    showReset.value = false
    showToast(t('users.toast.reset'))
  } catch (err) {
    resetError.value = errMsg(err)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <AppCard :title="t('users.list.title')">
      <template #actions>
        <AppButton size="sm" @click="openCreate">{{ t('users.action.add') }}</AppButton>
      </template>

      <EmptyState v-if="!users.length" icon="👤" :title="t('users.list.empty')" />
      <DataTable v-else :columns="columns" :rows="users">
        <template #cell-role="{ value }">{{ roleLabel(value) }}</template>
        <template #cell-dealerName="{ value }">{{ value ?? '—' }}</template>
        <template #cell-active="{ value }">
          <StatusBadge
            :status="value ? 'paid' : 'unpaid'"
            :label="value ? t('users.status.active') : t('users.status.inactive')"
          />
        </template>
        <template #cell-createdAt="{ value }">{{ thaiDate(value) }}</template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <AppButton size="sm" variant="outline" @click="openEdit(row)">
              {{ t('users.action.edit') }}
            </AppButton>
            <AppButton
              size="sm"
              variant="outline"
              :disabled="busyId === row.id"
              @click="toggleActive(row)"
            >
              {{ row.active ? t('users.action.deactivate') : t('users.action.activate') }}
            </AppButton>
            <AppButton size="sm" variant="outline" @click="openReset(row)">
              {{ t('users.action.resetPassword') }}
            </AppButton>
          </div>
        </template>
      </DataTable>
    </AppCard>

    <!-- create / edit modal -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="showForm = false"
    >
      <AppCard
        class="w-full max-w-md"
        :title="editingId == null ? t('users.form.create.title') : t('users.form.edit.title')"
      >
        <div class="space-y-4">
          <label class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('users.form.email') }}</span>
            <input
              v-model="form.email"
              type="email"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            >
          </label>

          <label v-if="editingId == null" class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('users.form.password') }}</span>
            <input
              v-model="form.password"
              type="password"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            >
          </label>

          <label class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('users.form.role') }}</span>
            <select
              v-model="form.role"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
              @change="onRoleChange"
            >
              <option v-for="r in ROLES" :key="r" :value="r">{{ roleLabel(r) }}</option>
            </select>
          </label>

          <label v-if="formScoped" class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('users.form.dealer') }}</span>
            <select
              v-model.number="form.dealerId"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            >
              <option :value="null">{{ t('users.form.dealerPlaceholder') }}</option>
              <option v-for="d in dealers" :key="d.id" :value="d.id">{{ d.code }} — {{ d.name }}</option>
            </select>
          </label>

          <label class="flex items-center gap-2">
            <input v-model="form.active" type="checkbox" class="size-4">
            <span class="text-sm text-app">{{ t('users.form.active') }}</span>
          </label>

          <p v-if="formError" class="text-xs text-rose-400">{{ formError }}</p>

          <div class="flex justify-end gap-2 border-t border-app pt-3">
            <AppButton variant="outline" @click="showForm = false">{{ t('action.cancel') }}</AppButton>
            <AppButton :disabled="saving" @click="save">{{ t('action.save') }}</AppButton>
          </div>
        </div>
      </AppCard>
    </div>

    <!-- reset password modal -->
    <div
      v-if="showReset"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="showReset = false"
    >
      <AppCard class="w-full max-w-md" :title="t('users.reset.title')">
        <div class="space-y-4">
          <p class="text-sm text-muted">{{ resetEmail }}</p>
          <label class="block">
            <span class="mb-1 block text-sm text-muted">{{ t('users.reset.newPassword') }}</span>
            <input
              v-model="newPassword"
              type="password"
              class="w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app"
            >
          </label>
          <p v-if="resetError" class="text-xs text-rose-400">{{ resetError }}</p>
          <div class="flex justify-end gap-2 border-t border-app pt-3">
            <AppButton variant="outline" @click="showReset = false">{{ t('action.cancel') }}</AppButton>
            <AppButton :disabled="resetting || newPassword.length < 8" @click="submitReset">
              {{ t('users.reset.submit') }}
            </AppButton>
          </div>
        </div>
      </AppCard>
    </div>

    <!-- toast -->
    <div
      v-if="toast"
      class="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 shadow-lg"
    >
      {{ toast }}
    </div>
  </div>
</template>
