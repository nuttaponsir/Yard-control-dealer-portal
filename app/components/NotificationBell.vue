<script setup lang="ts">
// Phase E — header notification bell. Shows the unread count and a dropdown of
// recent in-app notifications; clicking one marks it read; "view all" links to
// the /notifications page. Shared state via useNotifications().
import { onMounted, ref } from 'vue'

const { t } = useI18n()
const { items, unread, refresh, markRead, markAll } = useNotifications()

const open = ref(false)

onMounted(refresh)

async function toggle() {
  open.value = !open.value
  if (open.value) await refresh()
}

async function onItem(id: number) {
  await markRead(id)
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="relative">
    <button
      class="relative rounded-lg border border-app px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-2 hover:text-app"
      :aria-label="t('notify.title')"
      @click="toggle"
    >
      <span aria-hidden="true">🔔</span>
      <span
        v-if="unread > 0"
        class="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-none text-white"
      >
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </button>

    <!-- backdrop -->
    <div v-if="open" class="fixed inset-0 z-40" @click="open = false" />

    <!-- dropdown -->
    <div
      v-if="open"
      class="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-app bg-surface shadow-2xl"
    >
      <div class="flex items-center justify-between border-b border-app px-4 py-3">
        <p class="text-sm font-bold text-app">{{ t('notify.title') }}</p>
        <button
          v-if="unread > 0"
          class="text-xs font-semibold text-brand-300 hover:text-brand-200"
          @click="markAll"
        >
          {{ t('notify.markAllRead') }}
        </button>
      </div>

      <div class="max-h-96 overflow-y-auto">
        <p v-if="!items.length" class="px-4 py-8 text-center text-xs text-muted">
          {{ t('notify.empty') }}
        </p>
        <button
          v-for="n in items"
          :key="n.id"
          class="flex w-full items-start gap-2 border-b border-app/60 px-4 py-3 text-left transition hover:bg-surface-2"
          @click="onItem(n.id)"
        >
          <span
            class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
            :class="n.readAt ? 'bg-transparent' : 'bg-brand-500'"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-app">{{ n.title }}</span>
            <span class="block truncate text-xs text-muted">{{ n.body }}</span>
            <span class="mt-0.5 block text-[10px] text-muted">{{ fmt(n.createdAt) }}</span>
          </span>
        </button>
      </div>

      <NuxtLink
        to="/notifications"
        class="block border-t border-app px-4 py-2.5 text-center text-xs font-semibold text-brand-300 hover:bg-surface-2"
        @click="open = false"
      >
        {{ t('notify.viewAll') }}
      </NuxtLink>
    </div>
  </div>
</template>
