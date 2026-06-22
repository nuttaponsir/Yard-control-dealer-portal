// ============================================================================
// Mitsubishi Dealer Portal — Drizzle schema (PostgreSQL)
// ----------------------------------------------------------------------------
// SHARED FILE — owned by the Solution Architect. Dev agents MUST NOT edit this
// directly; if a module needs a schema change, note it in SCAFFOLD.md and flag
// the SA. Timestamp-like fields are stored as ISO text for a 1:1 shape with the
// frontend domain types (no (de)serialization drift).
// ============================================================================
import { pgTable, text, integer, boolean, serial, doublePrecision } from 'drizzle-orm/pg-core'

// ---- dealers ---------------------------------------------------------------
export const dealers = pgTable('dealers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // DLR0001
  name: text('name').notNull(), // "มิตซูบิชิ สงขลา สาขา 1"
  province: text('province').notNull(),
  phone: text('phone').notNull(),
  grade: text('grade').notNull(), // 'A' | 'B' | 'C'
  creditLimit: integer('credit_limit').notNull(), // THB
  creditUsed: integer('credit_used').notNull().default(0),
  createdAt: text('created_at').notNull(),
  // Phase B Wave 1: nullable FK to creditTerms master (text grade remains source of truth)
  creditTermId: integer('credit_term_id').references(() => creditTerms.id),
})

// ---- dealer addresses (Phase 2 — bill-to / ship-to + geo) ------------------
// A dealer keeps an address book. Each entry can serve as a billing and/or
// shipping address (`kind`), carries a full Thai postal address plus optional
// lat/lng for map display, and may be flagged as the dealer's default for
// billing and/or shipping. Orders reference an entry for where they ship/bill.
export const dealerAddresses = pgTable('dealer_addresses', {
  id: serial('id').primaryKey(),
  dealerId: integer('dealer_id')
    .notNull()
    .references(() => dealers.id),
  label: text('label').notNull(), // "สำนักงานใหญ่" | "คลังสาขา 2"
  kind: text('kind').notNull().default('both'), // 'billing' | 'shipping' | 'both'
  line1: text('line1').notNull(), // บ้านเลขที่/ถนน
  subDistrict: text('sub_district'), // ตำบล/แขวง
  district: text('district'), // อำเภอ/เขต
  province: text('province').notNull(),
  postalCode: text('postal_code'),
  country: text('country').notNull().default('TH'),
  lat: doublePrecision('lat'), // nullable — geocoded or hand-entered
  lng: doublePrecision('lng'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  isDefaultBilling: boolean('is_default_billing').notNull().default(false),
  isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
})

// ---- users -----------------------------------------------------------------
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(), // 'admin' | 'owner' | 'sales' | 'warehouse'
  dealerId: integer('dealer_id').references(() => dealers.id), // nullable
  // Phase G — User Management. Deactivated users keep their history but cannot
  // log in (login.post.ts rejects active=false). Defaults true for old rows.
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
})

// ---- vehicle models (master) -----------------------------------------------
export const vehicleModels = pgTable('vehicle_models', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(), // "Triton"
  active: boolean('active').notNull().default(true),
})

// ---- vins ------------------------------------------------------------------
export const vins = pgTable('vins', {
  id: serial('id').primaryKey(),
  vin: text('vin').notNull().unique(), // 17 chars
  model: text('model').notNull(), // "Triton"
  modelYear: integer('model_year').notNull(),
  autologicInstalled: boolean('autologic_installed').notNull().default(false),
  packageName: text('package_name'), // "Fleet Tracker Pro"
  deviceSerial: text('device_serial'), // "ALG-2024-A8731"
  installCenter: text('install_center'),
  installDate: text('install_date'),
  firmware: text('firmware'), // "v3.8.2"
  lastConnectedAt: text('last_connected_at'),
  status: text('status').notNull(), // 'installed' | 'pending' | 'not_installed'
})

// ---- parts -----------------------------------------------------------------
export const parts = pgTable('parts', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(), // MIT-OF-001
  name: text('name').notNull(),
  category: text('category').notNull(), // 'กรอง' | 'เบรก' | 'อุปกรณ์' | 'ไฟ' | 'ช่วงล่าง' | 'ไฟฟ้า'
  oem: boolean('oem').notNull().default(true),
  warrantyMonths: integer('warranty_months').notNull(),
  leadTimeDays: integer('lead_time_days').notNull(),
  price: integer('price').notNull(), // THB
  // Model compatibility: empty array = universal (fits all models); otherwise
  // the part fits only the listed model names (matches vehicleModels.name / vins.model).
  compatibleModels: text('compatible_models').array().notNull().default([]),
  // Phase B Wave 1: nullable FK to suppliers master (text category remains source of truth)
  supplierId: integer('supplier_id').references(() => suppliers.id),
})

// ---- inventory -------------------------------------------------------------
export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  warehouse: text('warehouse').notNull(), // 'คลังกรุงเทพ' | 'คลังเชียงใหม่'
  qtyOnHand: integer('qty_on_hand').notNull().default(0),
  reorderPoint: integer('reorder_point').notNull().default(0),
})

// ---- orders ----------------------------------------------------------------
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  poNumber: text('po_number').notNull().unique(), // PO-2026-089793
  dealerId: integer('dealer_id')
    .notNull()
    .references(() => dealers.id),
  vin: text('vin').notNull(), // VIN-gated: every order traces to an Autologic-verified vehicle
  status: text('status').notNull(), // 'pending'|'confirming'|'packing'|'shipped'|'delivered'|'cancelled'
  // Phase C — money breakdown. totalValue stays the grand total (subtotal − discount + vat)
  // so existing readers are unaffected; the new columns default to 0 for old rows.
  subtotal: integer('subtotal').notNull().default(0), // sum(list price × qty), pre-discount
  discount: integer('discount').notNull().default(0), // tiered grade discount (THB)
  vat: integer('vat').notNull().default(0), // VAT on the discounted subtotal (THB)
  totalValue: integer('total_value').notNull().default(0),
  invoiceNo: text('invoice_no'), // Phase C — INV-2026-###### issued at order time
  trackingNo: text('tracking_no'),
  carrier: text('carrier'), // 'Flash' | 'SCG'
  // Phase G — Accounts Receivable. amountPaid accumulates posted payments;
  // paymentStatus is derived ('unpaid' | 'partial' | 'paid'). Both default so
  // existing rows read as unpaid with 0 paid.
  amountPaid: integer('amount_paid').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('unpaid'),
  // Phase 2 — bill-to / ship-to address capture. Nullable FKs to the dealer's
  // own address book; null on legacy rows (and when the dealer has no address).
  shipToAddressId: integer('ship_to_address_id').references(() => dealerAddresses.id),
  billToAddressId: integer('bill_to_address_id').references(() => dealerAddresses.id),
  createdAt: text('created_at').notNull(),
})

// ---- order items -----------------------------------------------------------
export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  qty: integer('qty').notNull(),
  unitPrice: integer('unit_price').notNull(),
})

// ---- claims ----------------------------------------------------------------
export const claims = pgTable('claims', {
  id: serial('id').primaryKey(),
  claimNumber: text('claim_number').notNull().unique(), // CLM-2026-0001
  // Filing dealer (Phase L). Nullable: admin/warehouse staff have no dealer, and
  // pre-existing seed rows backfill to NULL. owner/sales are scoped to their own
  // dealerId on read; null-dealer claims are visible to admin/warehouse only.
  dealerId: integer('dealer_id').references(() => dealers.id),
  vin: text('vin').notNull(),
  partSku: text('part_sku').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(), // 'submitted'|'reviewing'|'rejected'|'approved'
  amount: integer('amount').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// ---- returns / RMA (Phase C — deferred workflow) ---------------------------
// A return is filed by a dealer against a DELIVERED order. Lifecycle:
//   requested → approved | rejected
// On approve the goods are restocked (inventory += qty) and the dealer's credit
// is released (creditUsed -= refundAmount), inside one transaction. Reject is a
// pure state change. refundAmount is computed server-side from the order's own
// effective discount/VAT so a partial return refunds proportionally.
export const returns = pgTable('returns', {
  id: serial('id').primaryKey(),
  rmaNumber: text('rma_number').notNull().unique(), // RMA-2026-0001
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  dealerId: integer('dealer_id')
    .notNull()
    .references(() => dealers.id),
  reason: text('reason').notNull(),
  status: text('status').notNull(), // 'requested' | 'approved' | 'rejected'
  refundAmount: integer('refund_amount').notNull().default(0), // THB credited on approve
  decidedBy: integer('decided_by').references(() => users.id), // nullable — admin who decided
  decidedAt: text('decided_at'), // nullable ISO
  createdAt: text('created_at').notNull(),
})

// ---- return items ----------------------------------------------------------
export const returnItems = pgTable('return_items', {
  id: serial('id').primaryKey(),
  returnId: integer('return_id')
    .notNull()
    .references(() => returns.id),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  qty: integer('qty').notNull(),
  unitPrice: integer('unit_price').notNull(),
})

// ---- sessions (server-side auth tokens) ------------------------------------
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque token stored in the cookie
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  // Phase F: server-side expiry. Nullable for legacy rows (treated as
  // non-expiring); every new session sets it. getUser() rejects expired rows.
  expiresAt: text('expires_at'),
})

// ============================================================================
// Phase B Wave 1 — Master / reference data layer
// ----------------------------------------------------------------------------
// These tables are the future canonical source for the denormalized text
// columns the current app reads (inventory.warehouse, parts.category,
// dealers.province, orders.carrier). For this wave they are ADDED alongside;
// the text columns remain the source of truth so existing code/tests are
// unaffected. New nullable FK columns (parts.supplierId, dealers.creditTermId)
// are populated in seed but not yet consumed by app logic (Phase C).
// ============================================================================

// ---- warehouses (M3) -------------------------------------------------------
export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'BKK' | 'CNX'
  name: text('name').notNull(), // matches inventory.warehouse values exactly
  province: text('province'),
})

// ---- part categories (M4) --------------------------------------------------
export const partCategories = pgTable('part_categories', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'filters' | 'brakes' | ...
  nameTh: text('name_th').notNull(), // matches parts.category values exactly
})

// ---- carriers (M5) ---------------------------------------------------------
export const carriers = pgTable('carriers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'flash' | 'scg' | 'kerry'
  name: text('name').notNull(), // matches orders.carrier values exactly
})

// ---- suppliers (M6) --------------------------------------------------------
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  leadTimeDays: integer('lead_time_days').notNull().default(0),
  contact: text('contact'),
})

// ---- credit terms (M8) -----------------------------------------------------
export const creditTerms = pgTable('credit_terms', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'net30' | 'net60' | 'cod'
  days: integer('days').notNull(),
  nameTh: text('name_th').notNull(),
})

// ---- price tiers (M7) ------------------------------------------------------
export const priceTiers = pgTable('price_tiers', {
  id: serial('id').primaryKey(),
  grade: text('grade').notNull().unique(), // 'A' | 'B' | 'C'
  discountPct: integer('discount_pct').notNull(), // percent
  nameTh: text('name_th'),
})

// ---- claim reasons (M9) ----------------------------------------------------
export const claimReasons = pgTable('claim_reasons', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameTh: text('name_th').notNull(),
})

// ---- provinces (M12) -------------------------------------------------------
export const provinces = pgTable('provinces', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  region: text('region').notNull(), // ภาคเหนือ | ภาคกลาง | ภาคอีสาน | ภาคใต้ | ภาคตะวันออก
})

// ---- app config (M11) ------------------------------------------------------
export const appConfig = pgTable('app_config', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
})

// ---- audit log (M13) -------------------------------------------------------
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id), // nullable
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  detail: text('detail'),
  createdAt: text('created_at').notNull(),
})

// ============================================================================
// Phase E — Integrations & Notifications
// ----------------------------------------------------------------------------
// One row per (recipient × channel) emitted by the notification service. The
// in-app inbox (the header bell) reads channel='inapp' rows; email/LINE rows
// are an outbox dispatched by pluggable providers (a mock "log" provider in
// dev/test). Like the audit log, emission is best-effort and never blocks the
// originating request. Admin-facing rows (low-stock / credit-risk / daily
// summary) carry userId = an admin and dealerId = null.
// ============================================================================
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  event: text('event').notNull(), // 'order.created'|'order.shipped'|'order.delivered'|'claim.submitted'|'return.approved'|'return.rejected'|'alert.low_stock'|'alert.credit_risk'|'summary.daily'
  channel: text('channel').notNull(), // 'inapp' | 'email' | 'line'
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }), // recipient (nullable)
  dealerId: integer('dealer_id').references(() => dealers.id, { onDelete: 'cascade' }), // context dealer (nullable)
  title: text('title').notNull(),
  body: text('body').notNull(),
  entity: text('entity'), // 'order' | 'claim' | 'return' | 'system'
  entityId: text('entity_id'), // PO / CLM / RMA number
  status: text('status').notNull(), // 'sent' | 'failed' | 'read'
  readAt: text('read_at'), // nullable ISO — only meaningful for inapp rows
  createdAt: text('created_at').notNull(),
})

// ============================================================================
// Phase G — Payments / Accounts Receivable
// ----------------------------------------------------------------------------
// A payment is money received from a dealer, optionally applied to a specific
// order. Posting a payment runs in one transaction: insert the payment row,
// add to orders.amountPaid + recompute orders.paymentStatus (when orderId is
// set), and RELEASE the dealer's credit (creditUsed = max(0, creditUsed −
// amount)). This is the missing half of the credit lifecycle — orders consume
// credit on create, returns/cancels release it on goods movement, and payments
// release it on settlement. amount is THB (integer).
// ============================================================================
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  receiptNo: text('receipt_no').notNull().unique(), // RCP-2026-######
  dealerId: integer('dealer_id')
    .notNull()
    .references(() => dealers.id),
  orderId: integer('order_id').references(() => orders.id), // nullable — on-account payment
  amount: integer('amount').notNull(), // THB
  method: text('method').notNull(), // 'transfer' | 'cash' | 'cheque' | 'card'
  reference: text('reference'), // bank ref / cheque no (nullable)
  note: text('note'), // nullable
  receivedAt: text('received_at').notNull(), // ISO — when funds were received
  createdBy: integer('created_by').references(() => users.id), // nullable — admin/owner who posted
  createdAt: text('created_at').notNull(),
})

// ============================================================================
// Phase 3 — Internal WMS + OMS/WMS integration
// ----------------------------------------------------------------------------
// A warehouse-management layer ADDED on top of the existing simple `inventory`
// table (which stays the authoritative sellable on-hand, decremented at order
// time). Three new concepts:
//   • storage_locations — the physical bin master within a warehouse.
//   • stock_movements    — an append-only ledger posted ALONGSIDE every change
//                          to inventory.qtyOnHand (issue on order, receipt on
//                          return, adjust on manual correction). It never drives
//                          qtyOnHand on its own; it records why a delta happened.
//   • pick_tasks / items — the fulfillment workflow. In `wms_mode = internal`
//                          a pick task is generated when an order enters
//                          'packing'; warehouse staff assign + complete it.
// The OMS/WMS adapter (server/utils/wms) switches behaviour on the `wms_mode`
// app-config key: 'internal' runs the picking workflow above; 'external' hands
// fulfillment to a stubbed external WMS (records a dispatch movement + audit).
// ============================================================================

// ---- storage locations (bin master) ---------------------------------------
export const storageLocations = pgTable('storage_locations', {
  id: serial('id').primaryKey(),
  warehouse: text('warehouse').notNull(), // matches inventory.warehouse exactly
  code: text('code').notNull().unique(), // 'BKK-A-01-01'
  zone: text('zone'), // 'A'
  aisle: text('aisle'), // '01'
  bin: text('bin'), // '01'
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
})

// ---- stock movements (append-only ledger) ----------------------------------
export const stockMovements = pgTable('stock_movements', {
  id: serial('id').primaryKey(),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  warehouse: text('warehouse').notNull(),
  locationId: integer('location_id').references(() => storageLocations.id), // nullable
  kind: text('kind').notNull(), // 'receipt'|'issue'|'transfer'|'adjust'|'return'|'external_dispatch'
  qty: integer('qty').notNull(), // signed: +adds to on-hand, −removes
  refType: text('ref_type'), // 'order' | 'return' | 'manual' | 'external'
  refId: text('ref_id'), // PO / RMA number, or null
  note: text('note'), // nullable human reason
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }), // nullable; history survives user deletion
  createdAt: text('created_at').notNull(),
})

// ---- pick tasks (fulfillment workflow) -------------------------------------
export const pickTasks = pgTable('pick_tasks', {
  id: serial('id').primaryKey(),
  pickNumber: text('pick_number').notNull().unique(), // PICK-2026-######
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  warehouse: text('warehouse').notNull(),
  status: text('status').notNull().default('open'), // 'open'|'assigned'|'picking'|'picked'|'cancelled'
  assignedTo: integer('assigned_to').references(() => users.id, { onDelete: 'set null' }), // nullable; survives user deletion
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'), // nullable — set on assign/complete
})

// ---- pick task items -------------------------------------------------------
export const pickTaskItems = pgTable('pick_task_items', {
  id: serial('id').primaryKey(),
  pickTaskId: integer('pick_task_id')
    .notNull()
    .references(() => pickTasks.id),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  qty: integer('qty').notNull(), // required quantity
  locationId: integer('location_id').references(() => storageLocations.id), // suggested bin (nullable)
  pickedQty: integer('picked_qty').notNull().default(0),
  status: text('status').notNull().default('pending'), // 'pending' | 'picked'
})

// ============================================================================
// Phase H — Issue tracker (auto error capture)
// ----------------------------------------------------------------------------
// Client-side error handlers (app/plugins/error-capture.client.ts) POST a row
// here whenever an unhandled error, rejected promise, failed API call, or Vue
// render error fires. Each row records WHAT broke (message/stack), WHERE
// (module + page route), WHICH action triggered it (last button/link clicked,
// or the failing endpoint), WHO hit it (userId/email from the session), and an
// optional html2canvas SCREENSHOT (base64 data URL). New rows land as 'draft'
// so a human triages them before they become real issues.
// ============================================================================
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  issueNumber: text('issue_number').notNull().unique(), // ISSUE-2026-######
  title: text('title').notNull(),
  module: text('module'), // ระบบ — logical area, derived from route (orders|payments|…)
  page: text('page'), // หน้า — route path the user was on
  action: text('action'), // ปุ่ม/การกระทำ — last clicked control label or failing endpoint
  severity: text('severity').notNull().default('error'), // 'error' | 'warning' | 'info'
  source: text('source').notNull(), // 'api' | 'unhandled' | 'rejection' | 'vue' | 'manual'
  message: text('message').notNull(), // human-readable error message
  stack: text('stack'), // nullable — JS stack / extra trace
  detail: text('detail'), // nullable — JSON blob: {endpoint,method,status,userAgent,…}
  screenshot: text('screenshot'), // nullable — base64 data URL (image/jpeg)
  userId: integer('user_id').references(() => users.id), // ใครทำ — nullable (may be logged out)
  userEmail: text('user_email'), // denormalised for display even if user is deleted
  status: text('status').notNull().default('draft'), // 'draft'|'open'|'in_progress'|'resolved'|'closed'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'), // nullable — set on status change
})

// ============================================================================
// Phase 5 — completeness modules (Telematics · Procurement · Transfer/Count ·
// Warranty). All additive on top of the existing WMS + order domain.
// ============================================================================

// ---- Autologic telematics events (device activity / alert log) -------------
// One row per device event, keyed by VIN (the device registry lives on `vins`).
// Drives the telematics fleet view + alert feed; firmware pushes append a row.
export const telematicsEvents = pgTable('telematics_events', {
  id: serial('id').primaryKey(),
  vin: text('vin').notNull(), // references vins.vin (text), not enforced as FK
  type: text('type').notNull(), // 'connect'|'disconnect'|'fault'|'firmware_update'|'geofence'|'heartbeat'
  severity: text('severity').notNull().default('info'), // 'info'|'warning'|'critical'
  message: text('message').notNull(),
  detail: text('detail'), // optional JSON blob (firmware version, fault code, …)
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
})

// ---- procurement: inbound purchase orders to suppliers ---------------------
// The supply-side counterpart of sales orders. Receiving a PO line increments
// inventory.qtyOnHand + posts a 'receipt' stock_movement (the WMS inbound seam).
export const purchaseOrders = pgTable('purchase_orders', {
  id: serial('id').primaryKey(),
  poNumber: text('po_number').notNull().unique(), // PO-IN-2026-######
  supplierId: integer('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  warehouse: text('warehouse').notNull(), // destination warehouse (matches inventory.warehouse)
  status: text('status').notNull().default('draft'), // 'draft'|'ordered'|'partial'|'received'|'cancelled'
  totalCost: integer('total_cost').notNull().default(0), // THB
  note: text('note'),
  expectedAt: text('expected_at'), // nullable ISO
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
})

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: serial('id').primaryKey(),
  purchaseOrderId: integer('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id),
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyReceived: integer('qty_received').notNull().default(0),
  unitCost: integer('unit_cost').notNull(), // THB
})

// ---- stock transfers between warehouses ------------------------------------
// Completing a transfer posts an 'issue' from the source + a 'receipt' to the
// destination and moves inventory.qtyOnHand across both rows.
export const stockTransfers = pgTable('stock_transfers', {
  id: serial('id').primaryKey(),
  transferNo: text('transfer_no').notNull().unique(), // TRF-2026-######
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  fromWarehouse: text('from_warehouse').notNull(),
  toWarehouse: text('to_warehouse').notNull(),
  qty: integer('qty').notNull(),
  status: text('status').notNull().default('requested'), // 'requested'|'completed'|'cancelled'
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'), // nullable ISO
})

// ---- cycle counts (physical stock-take reconciliation) ---------------------
// Posting a count writes inventory.qtyOnHand to the counted figure and records
// an 'adjust' stock_movement for the (counted − system) variance.
export const cycleCounts = pgTable('cycle_counts', {
  id: serial('id').primaryKey(),
  countNo: text('count_no').notNull().unique(), // CNT-2026-######
  partId: integer('part_id')
    .notNull()
    .references(() => parts.id),
  warehouse: text('warehouse').notNull(),
  systemQty: integer('system_qty').notNull(), // on-hand at count time
  countedQty: integer('counted_qty').notNull(),
  variance: integer('variance').notNull(), // countedQty − systemQty
  status: text('status').notNull().default('open'), // 'open'|'posted'|'cancelled'
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  postedAt: text('posted_at'), // nullable ISO
})

// ---- warranty registrations (per VIN + part) -------------------------------
// Coverage record opened when a part is installed/sold against a vehicle.
export const warranties = pgTable('warranties', {
  id: serial('id').primaryKey(),
  warrantyNo: text('warranty_no').notNull().unique(), // WAR-2026-######
  vin: text('vin').notNull(), // references vins.vin (text)
  partSku: text('part_sku').notNull(),
  dealerId: integer('dealer_id').references(() => dealers.id), // nullable — filing dealer
  startDate: text('start_date').notNull(), // ISO date
  months: integer('months').notNull(), // coverage length
  expiresAt: text('expires_at').notNull(), // ISO date (startDate + months)
  status: text('status').notNull().default('active'), // 'active'|'expired'|'void'
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
})
