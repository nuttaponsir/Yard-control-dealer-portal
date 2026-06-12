// ============================================================================
// useNotifications() — Phase E. Shared in-app notification state for the header
// bell and the /notifications page. Backed by GET /api/notifications and the
// mark-read endpoints. State is shared via useState so the bell badge and the
// page stay in sync.
// ============================================================================
import type { NotificationRow } from '~/../server/api/notifications/index.get'

export function useNotifications() {
  const items = useState<NotificationRow[]>('notifications:items', () => [])
  const unread = useState<number>('notifications:unread', () => 0)
  const loading = useState<boolean>('notifications:loading', () => false)

  async function refresh() {
    loading.value = true
    try {
      const res = await $fetch<{ notifications: NotificationRow[]; unread: number }>('/api/notifications')
      items.value = res.notifications
      unread.value = res.unread
    } catch {
      /* unauthenticated or transient — leave state as-is */
    } finally {
      loading.value = false
    }
  }

  async function markRead(id: number) {
    try {
      await $fetch(`/api/notifications/${id}/read`, { method: 'POST' })
    } finally {
      await refresh()
    }
  }

  async function markAll() {
    try {
      await $fetch('/api/notifications/read-all', { method: 'POST' })
    } finally {
      await refresh()
    }
  }

  return { items, unread, loading, refresh, markRead, markAll }
}
