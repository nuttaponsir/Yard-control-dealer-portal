// POST /api/chat — Phase I (AI Chat DEMO).
// Orchestrates the rule-based engine in server/utils/chat.ts:
//   classify the latest user message → answer with help text, a role-scoped
//   data lookup, or a graceful fallback. No external LLM (demo); the contract
//   (ChatReply) is the seam where a real model would slot in.
import { z } from 'zod'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { requireUser } from '../utils/auth'
import {
  classifyMessage,
  renderHelp,
  defaultSuggestions,
  FALLBACK_REPLY,
  type ChatReply,
  type DataIntent,
} from '../utils/chat'
import type { SessionUser } from '../../app/types'

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2000),
      }),
    )
    .min(1)
    .max(50),
})

const baht = (n: number) => `฿${(n ?? 0).toLocaleString('th-TH')}`

export default defineEventHandler(async (event): Promise<ChatReply> => {
  const user = await requireUser(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid chat payload' })
  }

  const lastUser = [...parsed.data.messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    return { reply: FALLBACK_REPLY, intent: 'fallback', suggestions: defaultSuggestions(user.role) }
  }

  const c = classifyMessage(lastUser.content)

  if (c.type === 'help' && c.topicId) {
    const text = renderHelp(c.topicId, user.role)
    return {
      reply: text ?? FALLBACK_REPLY,
      intent: text ? 'help' : 'fallback',
      topicId: c.topicId,
    }
  }

  if (c.type === 'data' && c.dataIntent) {
    const reply = await answerData(c.dataIntent, user)
    return { reply, intent: 'data', dataIntent: c.dataIntent }
  }

  return { reply: FALLBACK_REPLY, intent: 'fallback', suggestions: defaultSuggestions(user.role) }
})

// ---- data answerers (role-scoped) ------------------------------------------
// owner/sales are scoped to their own dealer; admin/warehouse see the network.
async function answerData(intent: DataIntent, user: SessionUser): Promise<string> {
  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null
  const dealerId = user.dealerId as number

  switch (intent) {
    case 'orders_summary': {
      const rows = await db.query.orders.findMany({
        where: scoped ? eq(schema.orders.dealerId, dealerId) : undefined,
        columns: { status: true, totalValue: true },
      })
      const total = rows.length
      const value = rows.reduce((s, r) => s + (r.totalValue ?? 0), 0)
      const pending = rows.filter((r) => r.status === 'pending').length
      const shipped = rows.filter((r) => r.status === 'shipped').length
      const delivered = rows.filter((r) => r.status === 'delivered').length
      const who = scoped ? 'ของดีลเลอร์คุณ' : 'ทั้งเครือข่าย'
      return `มีออเดอร์${who}ทั้งหมด **${total}** รายการ มูลค่ารวม ${baht(value)}\n• รอดำเนินการ ${pending}\n• กำลังจัดส่ง ${shipped}\n• ส่งสำเร็จ ${delivered}`
    }

    case 'orders_pending': {
      const rows = await db.query.orders.findMany({
        where: and(
          scoped ? eq(schema.orders.dealerId, dealerId) : undefined,
          inArray(schema.orders.status, ['pending', 'confirming', 'packing', 'shipped']),
        ),
        columns: { poNumber: true, status: true, totalValue: true },
      })
      if (!rows.length) return 'ไม่มีออเดอร์ที่ค้างจัดส่งในขณะนี้ 🎉'
      const sample = rows
        .slice(0, 5)
        .map((r) => `• ${r.poNumber} (${r.status}) ${baht(r.totalValue)}`)
        .join('\n')
      const more = rows.length > 5 ? `\n…และอีก ${rows.length - 5} รายการ` : ''
      return `มีออเดอร์ค้างจัดส่ง **${rows.length}** รายการ:\n${sample}${more}`
    }

    case 'low_stock': {
      const rows = await db
        .select({
          sku: schema.parts.sku,
          name: schema.parts.name,
          warehouse: schema.inventory.warehouse,
          qtyOnHand: schema.inventory.qtyOnHand,
          reorderPoint: schema.inventory.reorderPoint,
        })
        .from(schema.inventory)
        .innerJoin(schema.parts, eq(schema.inventory.partId, schema.parts.id))
        .where(lt(schema.inventory.qtyOnHand, schema.inventory.reorderPoint))
      if (!rows.length) return 'สต๊อกทุกรายการอยู่เหนือจุดสั่งซื้อซ้ำ ไม่มีของใกล้หมด ✅'
      const sample = rows
        .slice(0, 6)
        .map((r) => `• ${r.sku} ${r.name} — เหลือ ${r.qtyOnHand}/${r.reorderPoint} (${r.warehouse})`)
        .join('\n')
      const more = rows.length > 6 ? `\n…และอีก ${rows.length - 6} รายการ` : ''
      return `มีอะไหล่ใกล้หมด **${rows.length}** รายการ:\n${sample}${more}`
    }

    case 'credit': {
      if (!scoped) {
        const rows = await db.query.dealers.findMany({
          columns: { name: true, creditLimit: true, creditUsed: true },
        })
        const limit = rows.reduce((s, r) => s + (r.creditLimit ?? 0), 0)
        const used = rows.reduce((s, r) => s + (r.creditUsed ?? 0), 0)
        return `รวมวงเงินเครดิตทั้งเครือข่าย ${baht(limit)} ใช้ไปแล้ว ${baht(used)} คงเหลือ ${baht(limit - used)} (ดีลเลอร์ ${rows.length} ราย)`
      }
      const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, dealerId) })
      if (!dealer) return 'ไม่พบข้อมูลเครดิตของดีลเลอร์คุณ'
      const remaining = (dealer.creditLimit ?? 0) - (dealer.creditUsed ?? 0)
      return `เครดิตของ ${dealer.name} (เกรด ${dealer.grade})\n• วงเงิน ${baht(dealer.creditLimit)}\n• ใช้ไป ${baht(dealer.creditUsed)}\n• **คงเหลือ ${baht(remaining)}**`
    }

    case 'payments_outstanding': {
      const rows = await db.query.orders.findMany({
        where: and(
          scoped ? eq(schema.orders.dealerId, dealerId) : undefined,
          inArray(schema.orders.paymentStatus, ['unpaid', 'partial']),
        ),
        columns: { poNumber: true, totalValue: true, amountPaid: true },
      })
      const outstanding = rows.reduce((s, r) => s + ((r.totalValue ?? 0) - (r.amountPaid ?? 0)), 0)
      const who = scoped ? 'ของดีลเลอร์คุณ' : 'ทั้งเครือข่าย'
      if (!rows.length) return `ไม่มียอดค้างชำระ${who} ✅`
      return `ยอดค้างชำระ${who}รวม **${baht(outstanding)}** จาก ${rows.length} ออเดอร์`
    }

    case 'catalog_count': {
      const [{ count = 0 } = {}] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.parts)
      return `แคตตาล็อกมีอะไหล่ทั้งหมด **${count}** รายการ ดูและสั่งซื้อได้ที่เมนู "แคตตาล็อก"`
    }

    case 'claims_open': {
      const rows = await db.query.claims.findMany({
        where: inArray(schema.claims.status, ['submitted', 'reviewing']),
        columns: { claimNumber: true, status: true },
      })
      if (!rows.length) return 'ไม่มีเคลมที่ค้างพิจารณาในขณะนี้'
      return `มีเคลมที่ค้างพิจารณา **${rows.length}** รายการ (submitted/reviewing) ดูได้ที่เมนู "เคลม"`
    }

    case 'returns_open': {
      const rows = await db.query.returns.findMany({
        where: and(
          scoped ? eq(schema.returns.dealerId, dealerId) : undefined,
          eq(schema.returns.status, 'requested'),
        ),
        columns: { rmaNumber: true },
      })
      if (!rows.length) return 'ไม่มีคำขอคืนสินค้าที่ค้างอนุมัติในขณะนี้'
      return `มีคำขอคืนสินค้าค้างอนุมัติ **${rows.length}** รายการ ดูได้ที่เมนู "การคืนสินค้า"`
    }

    default:
      return FALLBACK_REPLY
  }
}
