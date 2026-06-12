// GET /api/notifications — Phase E. The current user's in-app inbox (the header
// bell). Returns the 50 newest inapp notifications addressed to this user plus
// the total unread count. Every authenticated role has an inbox.
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import type { NotificationEvent } from '../../../app/types'

export interface NotificationRow {
  id: number
  event: NotificationEvent
  title: string
  body: string
  entity: string | null
  entityId: string | null
  readAt: string | null
  createdAt: string
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const mine = and(
    eq(schema.notifications.userId, user.id),
    eq(schema.notifications.channel, 'inapp'),
  )

  const rows = await db.query.notifications.findMany({
    where: mine,
    orderBy: (n, { desc }) => [desc(n.createdAt), desc(n.id)],
    limit: 50,
  })

  const unreadRows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(and(mine, isNull(schema.notifications.readAt)))

  const notifications: NotificationRow[] = rows.map((r) => ({
    id: r.id,
    event: r.event as NotificationEvent,
    title: r.title,
    body: r.body,
    entity: r.entity,
    entityId: r.entityId,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }))

  return { notifications, unread: unreadRows.length }
})
