// ============================================================================
// Mitsubishi Dealer Portal — shared domain types
// ----------------------------------------------------------------------------
// SHARED FILE — owned by the Solution Architect. Mirrors server/db/schema.ts.
// Dev agents consume these; do not edit without flagging the SA (see SCAFFOLD).
// ============================================================================

export type Role = 'admin' | 'owner' | 'sales' | 'warehouse'
export type Grade = 'A' | 'B' | 'C'

export type OrderStatus = 'pending' | 'confirming' | 'packing' | 'shipped' | 'delivered' | 'cancelled'
export type ClaimStatus = 'submitted' | 'reviewing' | 'rejected' | 'approved'
export type ReturnStatus = 'requested' | 'approved' | 'rejected'
export type VinStatus = 'installed' | 'pending' | 'not_installed'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' // Phase G — AR
export type PaymentMethod = 'transfer' | 'cash' | 'cheque' | 'card' // Phase G
export type PartCategory = 'กรอง' | 'เบรก' | 'อุปกรณ์' | 'ไฟ' | 'ช่วงล่าง' | 'ไฟฟ้า'
export type Warehouse = 'คลังกรุงเทพ' | 'คลังเชียงใหม่'

export interface Dealer {
  id: number
  code: string
  name: string
  province: string
  phone: string
  grade: Grade
  creditLimit: number
  creditUsed: number
  createdAt: string
  creditTermId?: number | null // Phase B Wave 1 — nullable FK to CreditTerm
}

export interface User {
  id: number
  email: string
  role: Role
  dealerId: number | null
  active: boolean // Phase G — deactivated users cannot log in
  createdAt: string
}

export interface Vin {
  id: number
  vin: string
  model: string
  modelYear: number
  autologicInstalled: boolean
  packageName: string | null
  deviceSerial: string | null
  installCenter: string | null
  installDate: string | null
  firmware: string | null
  lastConnectedAt: string | null
  status: VinStatus
}

export interface VehicleModel {
  id: number
  name: string
  active: boolean
}

export interface Part {
  id: number
  sku: string
  name: string
  category: PartCategory
  oem: boolean
  warrantyMonths: number
  leadTimeDays: number
  price: number
  // empty array = universal (fits all models); otherwise the model names it fits.
  compatibleModels: string[]
  supplierId?: number | null // Phase B Wave 1 — nullable FK to Supplier
}

export interface InventoryRow {
  id: number
  partId: number
  warehouse: Warehouse
  qtyOnHand: number
  reorderPoint: number
}

export interface Order {
  id: number
  poNumber: string
  dealerId: number
  vin: string | null
  status: OrderStatus
  subtotal: number
  discount: number
  vat: number
  totalValue: number
  invoiceNo: string | null
  trackingNo: string | null
  carrier: string | null
  amountPaid: number // Phase G — accumulated posted payments
  paymentStatus: PaymentStatus // Phase G — derived: unpaid | partial | paid
  createdAt: string
}

export interface OrderItem {
  id: number
  orderId: number
  partId: number
  qty: number
  unitPrice: number
}

export interface Claim {
  id: number
  claimNumber: string
  vin: string
  partSku: string
  reason: string
  status: ClaimStatus
  amount: number
  createdAt: string
}

export interface Return {
  id: number
  rmaNumber: string
  orderId: number
  dealerId: number
  reason: string
  status: ReturnStatus
  refundAmount: number
  decidedBy: number | null
  decidedAt: string | null
  createdAt: string
}

export interface ReturnItem {
  id: number
  returnId: number
  partId: number
  qty: number
  unitPrice: number
}

// ---- payment (Phase G — Accounts Receivable) -------------------------------
export interface Payment {
  id: number
  receiptNo: string
  dealerId: number
  orderId: number | null
  amount: number
  method: PaymentMethod
  reference: string | null
  note: string | null
  receivedAt: string
  createdBy: number | null
  createdAt: string
}

// ---- session shape returned by GET /api/auth/me ----------------------------
export interface SessionUser {
  id: number
  email: string
  role: Role
  dealerId: number | null
  dealerName?: string | null
}

// ---- navigation contract (consumed by the sidebar) ------------------------
export interface NavItem {
  to: string
  labelKey: string
  icon: string
  roles?: Role[]
  badge?: string
}

// ---- client cart line (useCart) --------------------------------------------
export interface CartLine {
  partId: number
  sku: string
  name: string
  unitPrice: number
  qty: number
}

// ============================================================================
// Phase B Wave 1 — Master / reference data domain types
// ----------------------------------------------------------------------------
// NOTE: `PartCategory` and `Warehouse` already exist above as string unions
// used by the current app. The master-table interfaces are named
// `PartCategoryMaster` / `WarehouseMaster` to avoid clobbering those unions.
// ============================================================================

export interface WarehouseMaster {
  id: number
  code: string
  name: string
  province: string | null
}

export interface PartCategoryMaster {
  id: number
  code: string
  nameTh: string
}

export interface Carrier {
  id: number
  code: string
  name: string
}

export interface Supplier {
  id: number
  code: string
  name: string
  leadTimeDays: number
  contact: string | null
}

export interface CreditTerm {
  id: number
  code: string
  days: number
  nameTh: string
}

export interface PriceTier {
  id: number
  grade: Grade
  discountPct: number
  nameTh: string | null
}

export interface ClaimReason {
  id: number
  code: string
  nameTh: string
}

export interface Province {
  id: number
  name: string
  region: string
}

export interface AppConfig {
  id: number
  key: string
  value: string
}

// ============================================================================
// Phase E — Integrations & Notifications domain types
// ============================================================================
export type NotificationChannel = 'inapp' | 'email' | 'line'
export type NotificationStatus = 'sent' | 'failed' | 'read'
export type NotificationEvent =
  | 'order.created'
  | 'order.shipped'
  | 'order.delivered'
  | 'claim.submitted'
  | 'return.approved'
  | 'return.rejected'
  | 'alert.low_stock'
  | 'alert.credit_risk'
  | 'summary.daily'

export interface Notification {
  id: number
  event: NotificationEvent
  channel: NotificationChannel
  userId: number | null
  dealerId: number | null
  title: string
  body: string
  entity: string | null
  entityId: string | null
  status: NotificationStatus
  readAt: string | null
  createdAt: string
}

export interface AuditLogEntry {
  id: number
  userId: number | null
  action: string
  entity: string
  entityId: string | null
  detail: string | null
  createdAt: string
}

// ============================================================================
// Phase H — Issue tracker (auto error capture)
// ============================================================================
export type IssueStatus = 'draft' | 'open' | 'in_progress' | 'resolved' | 'closed'
export type IssueSeverity = 'error' | 'warning' | 'info'
export type IssueSource = 'api' | 'unhandled' | 'rejection' | 'vue' | 'manual'

export interface Issue {
  id: number
  issueNumber: string
  title: string
  module: string | null
  page: string | null
  action: string | null
  severity: IssueSeverity
  source: IssueSource
  message: string
  stack: string | null
  detail: string | null
  screenshot: string | null
  userId: number | null
  userEmail: string | null
  status: IssueStatus
  createdAt: string
  updatedAt: string | null
}
