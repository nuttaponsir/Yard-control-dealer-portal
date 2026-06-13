// ============================================================================
// Phase I — AI Chat (DEMO engine).
// ----------------------------------------------------------------------------
// A self-contained, rule-based chat "brain" with NO external paid API. It does
// two jobs the user asked for:
//   1) help / how-to   — answers "วิธีใช้งาน X" from a small knowledge base
//   2) data Q&A        — answers "มีออเดอร์กี่รายการ", "ของใกล้หมดมีอะไรบ้าง"
//                         by running a ROLE-SCOPED DB query and formatting it.
//
// ── Pluggable later ──────────────────────────────────────────────────────────
// Everything below the classifier is intentionally split so a real LLM can be
// dropped in without touching the UI or the endpoint:
//   • classifyMessage()  → pure intent detection (unit-tested, no DB)
//   • renderHelp()       → pure help-text lookup (unit-tested, no DB)
//   • the /api/chat route → orchestrates classify → (help | data | fallback)
// To use a real model, implement the same ChatReply contract in a new engine
// and call it from the route; the front-end never changes.
// ============================================================================
import type { Role } from '../../app/types'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ChatIntentType = 'help' | 'data' | 'fallback'

/** A data question the demo engine knows how to answer from the DB. */
export type DataIntent =
  | 'orders_summary'
  | 'orders_pending'
  | 'low_stock'
  | 'credit'
  | 'payments_outstanding'
  | 'catalog_count'
  | 'claims_open'
  | 'returns_open'

export interface Classification {
  type: ChatIntentType
  topicId?: string // when type === 'help'
  dataIntent?: DataIntent // when type === 'data'
}

export interface ChatReply {
  reply: string
  intent: ChatIntentType
  topicId?: string
  dataIntent?: DataIntent
  /** Optional suggested follow-up prompts the UI can render as chips. */
  suggestions?: string[]
}

// ---- help knowledge base ---------------------------------------------------
// Each topic is matched by keyword (TH or EN). `roles` (optional) restricts a
// topic to certain roles; an undefined `roles` means "everyone".
export interface HelpTopic {
  id: string
  keywords: string[]
  title: string
  body: string
  roles?: Role[]
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'create_order',
    keywords: ['สั่งซื้อ', 'เปิดออเดอร์', 'สร้างออเดอร์', 'สั่งของ', 'ออเดอร์ใหม่', 'create order', 'new order', 'place order'],
    title: 'วิธีเปิดออเดอร์ใหม่',
    body:
      'ไปที่เมนู "แคตตาล็อก" เลือกอะไหล่ที่ต้องการแล้วกดเพิ่มลงตะกร้า จากนั้นเปิดตะกร้าและกดยืนยันคำสั่งซื้อ ระบบจะตรวจ VIN, เครดิตคงเหลือ และสต๊อกให้อัตโนมัติก่อนสร้าง PO',
    roles: ['admin', 'owner', 'sales'],
  },
  {
    id: 'vin_check',
    keywords: ['vin', 'เช็ค vin', 'ตรวจสอบรถ', 'ตัวถัง', 'เลขตัวถัง'],
    title: 'วิธีตรวจสอบ VIN',
    body:
      'ไปที่เมนู "ตรวจ VIN" กรอกเลขตัวถัง 17 หลัก ระบบจะดึงข้อมูลรุ่นรถและประวัติเพื่อยืนยันก่อนสั่งอะไหล่ ทุกออเดอร์ต้องผูกกับ VIN ที่ตรวจแล้ว',
  },
  {
    id: 'track_order',
    keywords: ['ติดตาม', 'สถานะออเดอร์', 'ของถึงใหน', 'tracking', 'track', 'สถานะการจัดส่ง'],
    title: 'วิธีติดตามสถานะออเดอร์',
    body:
      'ไปที่เมนู "ออเดอร์" เปิดออเดอร์ที่ต้องการ จะเห็นแถบสถานะตั้งแต่ pending → confirming → packing → shipped → delivered พร้อมเลขพัสดุและผู้ขนส่ง',
  },
  {
    id: 'returns',
    keywords: ['คืนสินค้า', 'คืนของ', 'rma', 'return', 'ตีกลับ'],
    title: 'วิธีแจ้งคืนสินค้า (RMA)',
    body:
      'การคืนทำได้กับออเดอร์ที่จัดส่งแล้ว (delivered) ไปที่เมนู "การคืนสินค้า" กดสร้างคำขอคืน เลือกออเดอร์และจำนวน เมื่ออนุมัติระบบจะคืนสต๊อกและปลดเครดิตให้อัตโนมัติ',
  },
  {
    id: 'claims',
    keywords: ['เคลม', 'claim', 'รับประกัน', 'ของเสีย', 'warranty'],
    title: 'วิธียื่นเคลมประกัน',
    body:
      'ไปที่เมนู "เคลม" กดสร้างเคลมใหม่ ระบุ VIN, SKU อะไหล่ และเหตุผล สถานะจะไล่จาก submitted → reviewing → approved/rejected',
    roles: ['admin', 'owner', 'warehouse'],
  },
  {
    id: 'payments',
    keywords: ['ชำระเงิน', 'จ่ายเงิน', 'ค้างชำระ', 'ใบแจ้งหนี้', 'payment', 'invoice', 'ar'],
    title: 'วิธีดูและบันทึกการชำระเงิน',
    body:
      'ไปที่เมนู "การชำระเงิน" จะเห็นยอดค้างชำระ (AR) ของแต่ละออเดอร์ บันทึกการชำระได้ที่หน้านี้ ระบบจะอัปเดตสถานะเป็น unpaid / partial / paid ให้อัตโนมัติ',
    roles: ['admin', 'owner'],
  },
  {
    id: 'warehouse',
    keywords: ['คลัง', 'จัดของ', 'แพ็ค', 'fulfillment', 'warehouse', 'หยิบของ'],
    title: 'วิธีจัดการงานคลัง',
    body:
      'ไปที่เมนู "คลังสินค้า" จะเห็นรายการงานที่ต้องหยิบ-แพ็ค-ส่ง อัปเดตสถานะออเดอร์ได้จากที่นี่ และดูสต๊อกที่ใกล้ถึงจุดสั่งซื้อซ้ำ',
    roles: ['admin', 'warehouse'],
  },
  {
    id: 'users',
    keywords: ['ผู้ใช้', 'เพิ่มผู้ใช้', 'สิทธิ์', 'จัดการผู้ใช้', 'user management', 'add user', 'role'],
    title: 'วิธีจัดการผู้ใช้',
    body:
      'ไปที่เมนู "ผู้ใช้งาน" (เฉพาะแอดมิน) เพื่อเพิ่ม/แก้ไขผู้ใช้และกำหนดบทบาท (admin / owner / sales / warehouse) บทบาทกำหนดว่าผู้ใช้เห็นเมนูใดได้บ้าง',
    roles: ['admin'],
  },
  {
    id: 'issues',
    keywords: ['ปัญหา', 'error', 'ข้อผิดพลาด', 'issue', 'บั๊ก', 'bug', 'แจ้งปัญหา'],
    title: 'ระบบบันทึกข้อผิดพลาดอัตโนมัติ',
    body:
      'เมื่อเกิดข้อผิดพลาดในระบบ จะถูกบันทึกเป็น issue สถานะ draft อัตโนมัติ พร้อมภาพหน้าจอ ระบบ/หน้า/ปุ่ม และผู้ใช้ แอดมินดูและจัดการได้ที่เมนู "ปัญหา/ข้อผิดพลาด"',
    roles: ['admin'],
  },
]

// ---- intent classifier (PURE — no DB, unit-tested) -------------------------
// Data questions are detected by an action word (กี่/เท่าไหร่/รายการ/list/how
// many/total/show) co-occurring with a domain noun, OR by strong standalone
// phrases. Help is detected by "how/วิธี/ยังไง" + a known topic keyword.
interface DataRule {
  intent: DataIntent
  keywords: string[]
}

const DATA_RULES: DataRule[] = [
  { intent: 'orders_pending', keywords: ['ค้างส่ง', 'รอจัดส่ง', 'ออเดอร์ค้าง', 'pending order', 'รอดำเนินการ'] },
  { intent: 'orders_summary', keywords: ['ออเดอร์', 'คำสั่งซื้อ', 'order', 'po', 'ยอดสั่งซื้อ'] },
  { intent: 'low_stock', keywords: ['ใกล้หมด', 'สต๊อกต่ำ', 'ของจะหมด', 'low stock', 'reorder', 'สั่งซื้อซ้ำ'] },
  { intent: 'credit', keywords: ['เครดิต', 'วงเงิน', 'credit', 'limit คงเหลือ'] },
  { intent: 'payments_outstanding', keywords: ['ค้างชำระ', 'ยอดค้าง', 'หนี้', 'outstanding', 'ar', 'ลูกหนี้'] },
  { intent: 'claims_open', keywords: ['เคลม', 'claim'] },
  { intent: 'returns_open', keywords: ['คืนสินค้า', 'คืนของ', 'rma', 'return'] },
  { intent: 'catalog_count', keywords: ['อะไหล่', 'สินค้า', 'แคตตาล็อก', 'catalog', 'part', 'sku'] },
]

const HELP_TRIGGERS = ['วิธี', 'ยังไง', 'อย่างไร', 'ทำไง', 'how to', 'how do', 'how can', 'help', 'ช่วย', 'สอน', 'แนะนำ']
const DATA_TRIGGERS = ['กี่', 'เท่าไหร่', 'เท่าไร', 'จำนวน', 'มีอะไร', 'อะไรบ้าง', 'รายการ', 'แสดง', 'ดู', 'สรุป', 'how many', 'total', 'count', 'list', 'show', 'มี']

function norm(s: string): string {
  return s.toLowerCase().trim()
}

export function classifyMessage(raw: string): Classification {
  const text = norm(raw)
  if (!text) return { type: 'fallback' }

  const isHelpAsk = HELP_TRIGGERS.some((k) => text.includes(k))
  const isDataAsk = DATA_TRIGGERS.some((k) => text.includes(k))

  // 1) Explicit "how to ..." → help wins if it matches a known topic.
  if (isHelpAsk) {
    const topic = HELP_TOPICS.find((tp) => tp.keywords.some((k) => text.includes(norm(k))))
    if (topic) return { type: 'help', topicId: topic.id }
  }

  // 2) Data question (a data trigger word + a domain keyword, or a strong
  //    standalone data phrase).
  const dataHit = DATA_RULES.find((r) => r.keywords.some((k) => text.includes(norm(k))))
  if (dataHit && (isDataAsk || !isHelpAsk)) {
    return { type: 'data', dataIntent: dataHit.intent }
  }

  // 3) Bare topic keyword with no data trigger → treat as help if it matches.
  const topic = HELP_TOPICS.find((tp) => tp.keywords.some((k) => text.includes(norm(k))))
  if (topic) return { type: 'help', topicId: topic.id }

  return { type: 'fallback' }
}

// ---- help renderer (PURE — unit-tested) ------------------------------------
export function renderHelp(topicId: string, role: Role): string | null {
  const topic = HELP_TOPICS.find((t) => t.id === topicId)
  if (!topic) return null
  if (topic.roles && !topic.roles.includes(role)) {
    return `หัวข้อ "${topic.title}" ไม่อยู่ในสิทธิ์ของบทบาทคุณ จึงอาจไม่เห็นเมนูนี้`
  }
  return `**${topic.title}**\n${topic.body}`
}

/** A few starter prompts shown when the chat opens / on fallback. */
export function defaultSuggestions(role: Role): string[] {
  const base = ['มีออเดอร์กี่รายการ', 'ของใกล้หมดมีอะไรบ้าง', 'วิธีเปิดออเดอร์ใหม่', 'วิธีตรวจ VIN']
  if (role === 'owner' || role === 'sales') base.push('เครดิตคงเหลือเท่าไหร่')
  if (role === 'admin' || role === 'owner') base.push('ยอดค้างชำระเท่าไหร่')
  return base
}

export const FALLBACK_REPLY =
  'ขออภัย ฉันยังไม่เข้าใจคำถามนี้ ลองถามเรื่องออเดอร์ สต๊อก เครดิต การชำระเงิน หรือถามวิธีใช้งานเมนูต่าง ๆ ได้เลยครับ'
