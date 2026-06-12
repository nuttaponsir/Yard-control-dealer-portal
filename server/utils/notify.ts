// ============================================================================
// Phase E — notification service
// ----------------------------------------------------------------------------
// Renders a Thai template for a domain event, resolves recipients (a dealer's
// users and/or all admins), and writes one `notifications` row per
// (recipient × channel). The in-app bell reads channel='inapp' rows; email/line
// rows are an outbox dispatched through the pluggable providers in
// integrations.ts (mock "log" providers in dev/test).
//
// Like the audit log, emission is BEST-EFFORT: any failure is swallowed and
// never breaks the originating request (order create, status advance, ...).
// ============================================================================
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { dispatch } from './integrations'
import type { NotificationChannel, NotificationEvent } from '../../app/types'

interface NotifyInput {
  event: NotificationEvent
  entity?: 'order' | 'claim' | 'return' | 'system'
  entityId?: string | null
  dealerId?: number | null // notify this dealer's users
  toAdmins?: boolean // also notify all admins
  vars?: Record<string, string | number>
}

// Channels each event fans out to. 'inapp' powers the bell; 'email'/'line' are
// the outbox so the integration surface is real and testable.
const EVENT_CHANNELS: Record<NotificationEvent, NotificationChannel[]> = {
  'order.created': ['inapp', 'email'],
  'order.shipped': ['inapp', 'email', 'line'],
  'order.delivered': ['inapp', 'line'],
  'claim.submitted': ['inapp', 'email'],
  'return.approved': ['inapp', 'email'],
  'return.rejected': ['inapp', 'email'],
  'alert.low_stock': ['inapp'],
  'alert.credit_risk': ['inapp'],
  'summary.daily': ['inapp'],
}

// Thai templates. {placeholders} are filled from `vars`.
const TEMPLATES: Record<NotificationEvent, { title: string; body: string }> = {
  'order.created': { title: 'คำสั่งซื้อใหม่ {po}', body: 'รับคำสั่งซื้อ {po} มูลค่า ฿{total} เรียบร้อยแล้ว' },
  'order.shipped': { title: 'จัดส่งคำสั่งซื้อ {po}', body: 'คำสั่งซื้อ {po} ถูกจัดส่งแล้ว ({carrier} · {tracking})' },
  'order.delivered': { title: 'ส่งมอบคำสั่งซื้อ {po}', body: 'คำสั่งซื้อ {po} ส่งมอบเรียบร้อยแล้ว' },
  'claim.submitted': { title: 'เคลมใหม่ {clm}', body: 'ยื่นเคลม {clm} สำหรับ VIN {vin}' },
  'return.approved': { title: 'อนุมัติการคืนสินค้า {rma}', body: 'อนุมัติคืนสินค้า {rma} คืนเครดิต ฿{refund}' },
  'return.rejected': { title: 'ปฏิเสธการคืนสินค้า {rma}', body: 'คำขอคืนสินค้า {rma} ถูกปฏิเสธ' },
  'alert.low_stock': { title: 'แจ้งเตือนสต๊อกต่ำ', body: 'มีอะไหล่ {count} รายการต่ำกว่าจุดสั่งซื้อ' },
  'alert.credit_risk': { title: 'แจ้งเตือนความเสี่ยงเครดิต', body: 'มีดีลเลอร์ {count} รายใช้เครดิตเกินเกณฑ์ที่กำหนด' },
  'summary.daily': { title: 'สรุปประจำวัน', body: 'คำสั่งซื้อใหม่ {orders} · เคลมใหม่ {claims} · ยอดขาย ฿{sales}' },
}

function render(tpl: string, vars: Record<string, string | number> = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`))
}

/** Resolve the recipient user set: a dealer's users ∪ (optionally) all admins. */
async function resolveRecipients(dealerId?: number | null, toAdmins?: boolean) {
  const byId = new Map<number, { id: number; email: string }>()
  if (dealerId != null) {
    const rows = await db.query.users.findMany({ where: eq(schema.users.dealerId, dealerId) })
    for (const u of rows) byId.set(u.id, { id: u.id, email: u.email })
  }
  if (toAdmins) {
    const rows = await db.query.users.findMany({ where: eq(schema.users.role, 'admin') })
    for (const u of rows) byId.set(u.id, { id: u.id, email: u.email })
  }
  return [...byId.values()]
}

/**
 * Emit a notification. Never throws.
 * @returns counts useful for logging/tests.
 */
export async function notify(input: NotifyInput): Promise<{ recipients: number; rows: number }> {
  try {
    const tpl = TEMPLATES[input.event]
    if (!tpl) return { recipients: 0, rows: 0 }
    const title = render(tpl.title, input.vars)
    const body = render(tpl.body, input.vars)
    const channels = EVENT_CHANNELS[input.event] ?? ['inapp']
    const recipients = await resolveRecipients(input.dealerId, input.toAdmins)
    if (!recipients.length) return { recipients: 0, rows: 0 }

    const now = new Date().toISOString()
    const values: (typeof schema.notifications.$inferInsert)[] = []
    for (const r of recipients) {
      for (const channel of channels) {
        let status = 'sent'
        if (channel !== 'inapp') {
          const ok = await dispatch({ channel, to: r.email, title, body })
          status = ok ? 'sent' : 'failed'
        }
        values.push({
          event: input.event,
          channel,
          userId: r.id,
          dealerId: input.dealerId ?? null,
          title,
          body,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          status,
          readAt: null,
          createdAt: now,
        })
      }
    }
    if (values.length) await db.insert(schema.notifications).values(values)
    return { recipients: recipients.length, rows: values.length }
  } catch (err) {
    console.error('[notify] failed', { event: input.event, entityId: input.entityId }, err)
    return { recipients: 0, rows: 0 }
  }
}
