<script setup lang="ts">
// SHARED layout component (SA owns). Top bar: title, TH/EN toggle, role badge.
import { ROLE_LABELS } from '~/utils/labels'
defineProps<{ title: string; subtitle?: string }>()
const { lang, toggle, t } = useI18n()
const { user, logout } = useAuth()
const sidebarOpen = useState('ui:sidebarOpen', () => false)

async function onLogout() {
  await logout()
  await navigateTo('/auth')
}
</script>

<template>
  <header class="flex items-center gap-3 border-b border-app bg-surface px-4 py-3 sm:gap-4 sm:px-6">
    <button
      class="-ml-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-app lg:hidden"
      aria-label="Open menu"
      @click="sidebarOpen = true"
    >
      <span class="block text-xl leading-none">☰</span>
    </button>
    <div class="min-w-0">
      <h1 class="truncate text-base font-bold text-app sm:text-lg">{{ title }}</h1>
      <p v-if="subtitle" class="truncate text-xs text-muted">{{ subtitle }}</p>
    </div>
    <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
      <NotificationBell v-if="user" />
      <button
        class="rounded-lg border border-app px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-app"
        @click="toggle"
      >
        {{ lang === 'th' ? 'TH' : 'EN' }}
      </button>
      <span
        v-if="user"
        class="rounded bg-brand-900/40 px-2 py-1 text-[10px] font-bold uppercase text-brand-300"
      >
        {{ ROLE_LABELS[user.role] ?? user.role }}
      </span>
      <AppButton v-if="user" variant="ghost" size="sm" @click="onLogout">
        {{ t('action.logout') }}
      </AppButton>
    </div>
  </header>
</template>
