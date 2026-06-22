<script setup lang="ts">
// SHARED layout component (SA owns). Role-gated nav from useNav().
import { computed, onMounted, ref } from 'vue'
import { ROLE_LABELS } from '~/utils/labels'

const { t } = useI18n()
const items = useNav()
const { can, user } = useAuth()
const { logoUrl, load: loadBrand } = useBrand()
const collapsed = ref(false)
// Mobile drawer open state — shared with AppHeader's hamburger + the layout
// backdrop. On lg+ the sidebar is always docked so this flag is irrelevant there.
const open = useState('ui:sidebarOpen', () => false)
const route = useRoute()

onMounted(loadBrand)

// Only the items this role can see; a group header renders when the group
// changes from the previous visible item.
const visibleItems = computed(() => items.filter((i) => can(i.roles)))
function showGroupHeader(idx: number): string | null {
  const g = visibleItems.value[idx]?.group
  if (!g) return null
  return idx === 0 || visibleItems.value[idx - 1]?.group !== g ? g : null
}

function active(to: string) {
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-app bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 lg:transition-all"
    :class="[
      open ? 'translate-x-0' : '-translate-x-full',
      collapsed ? 'lg:w-16' : 'lg:w-60',
    ]"
  >
    <!-- brand -->
    <div class="flex items-center gap-2.5 px-4 py-4">
      <img
        v-if="logoUrl"
        :src="logoUrl"
        :alt="t('brand.name')"
        class="h-9 w-9 shrink-0 rounded-xl bg-white object-contain"
      >
      <div v-else class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-[11px] font-extrabold tracking-tight text-white">
        <span>JW<span class="text-accent-400">D</span></span>
      </div>
      <div v-if="!collapsed" class="min-w-0">
        <p class="truncate text-sm font-bold text-app">{{ t('brand.name') }}</p>
        <p class="truncate text-[10px] uppercase tracking-wider text-muted">{{ t('brand.tagline') }}</p>
      </div>
      <!-- desktop collapse toggle -->
      <button
        class="ml-auto hidden rounded-lg p-1 text-muted hover:bg-surface-2 lg:block"
        :aria-label="collapsed ? 'Expand' : 'Collapse'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '»' : '«' }}
      </button>
      <!-- mobile drawer close -->
      <button
        class="ml-auto rounded-lg p-1 text-muted hover:bg-surface-2 lg:hidden"
        aria-label="Close menu"
        @click="open = false"
      >
        ✕
      </button>
    </div>

    <!-- nav -->
    <nav class="flex-1 overflow-y-auto px-2 pb-4">
      <template v-for="(item, idx) in visibleItems" :key="item.to">
        <!-- section header (skipped when collapsed) -->
        <p
          v-if="!collapsed && showGroupHeader(idx)"
          class="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted/70"
        >
          {{ t(showGroupHeader(idx)!) }}
        </p>
        <NuxtLink
          :to="item.to"
          class="mt-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="active(item.to)
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
            : 'text-muted hover:bg-surface-2 hover:text-app'"
          :title="t(item.labelKey)"
          @click="open = false"
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
          class="rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
        >
          {{ ROLE_LABELS[user.role] ?? user.role }}
        </span>
      </div>
    </div>
  </aside>
</template>
