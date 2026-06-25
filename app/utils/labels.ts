// ============================================================================
// Mitsubishi Dealer Portal — shared status → Thai-label maps + tone tokens
// ----------------------------------------------------------------------------
// SHARED FILE — owned by the SA. Used everywhere (StatusBadge, tables, Kanban).
// Add new statuses here, never inline Thai strings in components.
// ============================================================================
import type { OrderStatus, ClaimStatus, VinStatus, ReturnStatus, Grade, PaymentStatus } from '~/types'

// Order workflow (also drives the fulfillment Kanban column order).
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'รอดำเนินการ',
  confirming: 'กำลังยืนยันสินค้า',
  packing: 'กำลังแพ็ค',
  shipped: 'จัดส่งแล้ว',
  delivered: 'ส่งถึงแล้ว',
  cancelled: 'ยกเลิกแล้ว',
}

// Forward fulfillment pipeline (excludes the terminal off-pipeline 'cancelled').
export const ORDER_STATUS_ORDER: OrderStatus[] = [
  'pending',
  'confirming',
  'packing',
  'shipped',
  'delivered',
]

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  submitted: 'ส่งคำร้อง',
  reviewing: 'กำลังตรวจสอบ',
  rejected: 'ปฏิเสธ',
  approved: 'อนุมัติ',
}

// Return / RMA workflow labels.
export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'รออนุมัติคืน',
  approved: 'อนุมัติคืน',
  rejected: 'ปฏิเสธคืน',
}

// Payment / AR status labels (Phase G).
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'ยังไม่ชำระ',
  partial: 'ชำระบางส่วน',
  paid: 'ชำระครบ',
}

export const VIN_STATUS_LABELS: Record<VinStatus, string> = {
  installed: 'ติดตั้งแล้ว',
  pending: 'รอติดตั้ง',
  not_installed: 'ยังไม่ได้ติดตั้ง',
}

export const ROLE_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  owner: 'เจ้าของดีลเลอร์',
  sales: 'ฝ่ายขาย',
  warehouse: 'คลังสินค้า',
}

export const GRADE_LABELS: Record<Grade, string> = {
  A: 'เกรด A',
  B: 'เกรด B',
  C: 'เกรด C',
}

// Tailwind class tones for StatusBadge — keyed by status string.
export const STATUS_TONE: Record<string, string> = {
  // orders
  pending: 'bg-zinc-700/40 text-zinc-300',
  confirming: 'bg-amber-500/15 text-amber-400',
  packing: 'bg-indigo-500/15 text-indigo-400',
  shipped: 'bg-sky-500/15 text-sky-400',
  delivered: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-rose-500/15 text-rose-400',
  // claims
  submitted: 'bg-zinc-700/40 text-zinc-300',
  reviewing: 'bg-amber-500/15 text-amber-400',
  rejected: 'bg-rose-500/15 text-rose-400',
  approved: 'bg-emerald-500/15 text-emerald-400',
  // returns / RMA
  requested: 'bg-amber-500/15 text-amber-400',
  // payments / AR
  unpaid: 'bg-rose-500/15 text-rose-400',
  partial: 'bg-amber-500/15 text-amber-400',
  paid: 'bg-emerald-500/15 text-emerald-400',
  // vins
  installed: 'bg-emerald-500/15 text-emerald-400',
  not_installed: 'bg-rose-500/15 text-rose-400',
  // WMS pick tasks (Phase 3)
  open: 'bg-zinc-700/40 text-zinc-300',
  assigned: 'bg-amber-500/15 text-amber-400',
  picking: 'bg-indigo-500/15 text-indigo-400',
  picked: 'bg-emerald-500/15 text-emerald-400',
  // generic active/inactive (locations, masters, devices)
  active: 'bg-emerald-500/15 text-emerald-400',
  inactive: 'bg-zinc-700/40 text-zinc-300',
  // warranty (Phase 5)
  expiring: 'bg-amber-500/15 text-amber-400',
  expired: 'bg-rose-500/15 text-rose-400',
  void: 'bg-zinc-700/40 text-zinc-300',
  // issues (Phase H)
  in_progress: 'bg-indigo-500/15 text-indigo-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  closed: 'bg-zinc-700/40 text-zinc-300',
  // procurement POs (Phase 5)
  ordered: 'bg-sky-500/15 text-sky-400',
  received: 'bg-emerald-500/15 text-emerald-400',
  // stock-ops (Phase 5): transfers + cycle counts
  completed: 'bg-emerald-500/15 text-emerald-400',
  posted: 'bg-emerald-500/15 text-emerald-400',
  // severity (telematics events / issues)
  info: 'bg-sky-500/15 text-sky-400',
  low: 'bg-zinc-700/40 text-zinc-300',
  medium: 'bg-amber-500/15 text-amber-400',
  warning: 'bg-amber-500/15 text-amber-400',
  high: 'bg-rose-500/15 text-rose-400',
  critical: 'bg-rose-600/20 text-rose-400',
  error: 'bg-rose-500/15 text-rose-400',
  // issues lifecycle extra
  draft: 'bg-zinc-700/40 text-zinc-300',
}

/** Resolve a Thai label for any known status string (falls back to the input). */
export function statusLabel(status: string): string {
  return (
    ORDER_STATUS_LABELS[status as OrderStatus] ??
    CLAIM_STATUS_LABELS[status as ClaimStatus] ??
    VIN_STATUS_LABELS[status as VinStatus] ??
    RETURN_STATUS_LABELS[status as ReturnStatus] ??
    PAYMENT_STATUS_LABELS[status as PaymentStatus] ??
    status
  )
}

export function statusTone(status: string): string {
  return STATUS_TONE[status] ?? 'bg-zinc-700/40 text-zinc-300'
}

/** Format a THB amount with 2 decimals, e.g. "฿1,250,000.00". */
export function thb(amount: number): string {
  return '฿' + amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
