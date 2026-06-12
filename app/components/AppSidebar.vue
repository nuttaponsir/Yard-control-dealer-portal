<script setup lang="ts">
// SHARED layout component (SA owns). Role-gated nav from useNav().
import { ref } from 'vue'
import { ROLE_LABELS } from '~/utils/labels'

const { t } = useI18n()
const items = useNav()
const { can, user } = useAuth()
const collapsed = ref(false)
const route = useRoute()

function active(to: string) {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <aside
    class="flex shrink-0 flex-col border-r border-app bg-surface transition-all"
    :class="collapsed ? 'w-16' : 'w-60'"
  >
    <!-- brand -->
    <div class="flex items-center gap-2.5 px-4 py-4">
      <div class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
        M
      </div>
      <div v-if="!collapsed" class="min-w-0">
        <p class="truncate text-sm font-bold text-app">{{ t('brand.name') }}</p>
        <p class="truncate text-[10px] uppercase tracking-wider text-muted">{{ t('brand.tagline') }}</p>
      </div>
      <button
        class="ml-auto rounded-lg p-1 text-muted hover:bg-surface-2"
        :aria-label="collapsed ? 'Expand' : 'Collapse'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '»' : '«' }}
      </button>
    </div>

    <!-- nav -->
    <nav class="flex-1 overflow-y-auto px-2 pb-4">
      <template v-for="item in items" :key="item.to">
        <NuxtLink
          v-if="can(item.roles)"
          :to="item.to"
          class="mt-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="active(item.to)
            ? 'bg-brand-900/30 text-brand-300'
            : 'text-muted hover:bg-surface-2 hover:text-app'"
          :title="t(item.labelKey)"
        >
          <span class="w-5 shrink-0 text-center">{{ item.icon }}</span>
          <span v-if="!collapsed" class="truncate">{{ t(item.labelKey) }}</span>
        </NuxtLink>
      </template>
    </nav>

    <!-- user -->
    <div v-if="user" class="border-t border-app p-3">
      <div class="flex items-center gap-2.5">
        <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold text-app">
          {{ user.email.slice(0, 2).toUpperCase() }}
        </div>
        <div v-if="!collapsed" class="min-w-0 flex-1">
          <p class="truncate text-xs font-semibold text-app">{{ user.email }}</p>
          <p class="truncate text-[10px] text-muted">{{ user.dealerName ?? '—' }}</p>
        </div>
        <span
          v-if="!collapsed"
          class="rounded bg-brand-900/40 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-300"
        >
          {{ ROLE_LABELS[user.role] ?? user.role }}
        </span>
      </div>
    </div>
  </aside>
</template>
