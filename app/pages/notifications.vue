<script setup lang="ts">
// /notifications — Phase E. Full in-app notification inbox for the current user.
// Reachable from the header bell's "view all" (intentionally not in the sidebar
// nav). Every authenticated role has an inbox.
import { onMounted } from 'vue'

const { t } = useI18n()
const { items, unread, refresh, markRead, markAll } = useNotifications()

usePageTitle().set(t('page.notifications.title'), t('page.notifications.subtitle'))

onMounted(refresh)

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
</script>

<template>
  <AppCard :title="t('notify.title')">
    <template #actions>
      <AppButton v-if="unread > 0" variant="outline" size="sm" @click="markAll">
        {{ t('notify.markAllRead') }}
      </AppButton>
    </template>

    <EmptyState v-if="!items.length" icon="🔔" :title="t('notify.empty')" />
    <ul v-else class="divide-y divide-app">
      <li
        v-for="n in items"
        :key="n.id"
        class="flex items-start gap-3 py-3"
      >
        <span
          class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          :class="n.readAt ? 'bg-transparent' : 'bg-brand-500'"
        />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-app">{{ n.title }}</p>
          <p class="text-xs text-muted">{{ n.body }}</p>
          <p class="mt-0.5 text-[11px] text-muted">{{ fmt(n.createdAt) }}</p>
        </div>
        <button
          v-if="!n.readAt"
          class="shrink-0 text-xs font-semibold text-brand-300 hover:text-brand-200"
          @click="markRead(n.id)"
        >
          {{ t('notify.unreadOne') }}
        </button>
      </li>
    </ul>
  </AppCard>
</template>
