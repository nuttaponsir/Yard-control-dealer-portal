// ============================================================================
// Mitsubishi Dealer Portal — seed data + shared seeding routine
// ----------------------------------------------------------------------------
// SHARED FILE — owned by the SA. Used by both `npm run db:seed` (server/db/seed.ts)
// and POST /api/auth/seed-demo so the demo dataset is defined in exactly one
// place. Idempotent: truncates then re-inserts.
// ============================================================================
import bcrypt from 'bcryptjs'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from './index'

const PROVINCES = [
  'กรุงเทพ', 'สงขลา', 'เชียงใหม่', 'ขอนแก่น', 'ชลบุรี', 'นครราชสีมา',
  'ภูเก็ต', 'อุดรธานี', 'สุราษฎร์ธานี', 'นนทบุรี',
]
const GRADES = ['A', 'B', 'C'] as const
const ORDER_STATUSES = ['pending', 'confirming', 'packing', 'shipped', 'delivered'] as const
const CARRIERS = ['Flash', 'SCG'] as const

function pad(n: number, len: number) {
  return String(n).padStart(len, '0')
}
function iso(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString()
}

export async function seedDatabase(): Promise<{
  dealers: number
  users: number
  orders: number
  payments: number
}> {
  // wipe (children first), restart serial identities
  await db.execute(sql`TRUNCATE TABLE
    ${schema.auditLog}, ${schema.sessions}, ${schema.orderItems}, ${schema.orders},
    ${schema.claims}, ${schema.inventory}, ${schema.parts}, ${schema.vins},
    ${schema.vehicleModels}, ${schema.users}, ${schema.dealers},
    ${schema.warehouses}, ${schema.partCategories}, ${schema.carriers},
    ${schema.suppliers}, ${schema.creditTerms}, ${schema.priceTiers},
    ${schema.claimReasons}, ${schema.provinces}, ${schema.appConfig}
    RESTART IDENTITY CASCADE`)

  // ---- Phase B Wave 1 master tables (seed before dependents) ---------------
  // credit terms (M8) — needed before dealers (dealers.creditTermId FK)
  const insertedCreditTerms = await db
    .insert(schema.creditTerms)
    .values([
      { code: 'net30', days: 30, nameTh: 'เครดิต 30 วัน' },
      { code: 'net60', days: 60, nameTh: 'เครดิต 60 วัน' },
      { code: 'cod', days: 0, nameTh: 'ชำระเงินสด' },
    ])
    .returning()
  const termByCode = Object.fromEntries(insertedCreditTerms.map((t) => [t.code, t.id]))
  // grade → credit term: A→net60, B→net30, C→cod
  const gradeToTerm: Record<string, number> = {
    A: termByCode.net60!,
    B: termByCode.net30!,
    C: termByCode.cod!,
  }

  // suppliers (M6) — needed before parts (parts.supplierId FK)
  const insertedSuppliers = await db
    .insert(schema.suppliers)
    .values([
      { code: 'SUP01', name: 'Mitsubishi Motors (Thailand)', leadTimeDays: 3, contact: '02-080-1000' },
      { code: 'SUP02', name: 'Siam Auto Parts Co., Ltd.', leadTimeDays: 5, contact: '02-555-1212' },
      { code: 'SUP03', name: 'Bangkok OEM Distributors', leadTimeDays: 2, contact: '02-300-7788' },
      { code: 'SUP04', name: 'Northern Spare Supply', leadTimeDays: 7, contact: '053-200-456' },
    ])
    .returning()

  // warehouses (M3) — names match inventory.warehouse exactly
  await db.insert(schema.warehouses).values([
    { code: 'BKK', name: 'คลังกรุงเทพ', province: 'กรุงเทพ' },
    { code: 'CNX', name: 'คลังเชียงใหม่', province: 'เชียงใหม่' },
  ])

  // part categories (M4) — nameTh matches parts.category exactly
  await db.insert(schema.partCategories).values([
    { code: 'filters', nameTh: 'กรอง' },
    { code: 'brakes', nameTh: 'เบรก' },
    { code: 'accessories', nameTh: 'อุปกรณ์' },
    { code: 'lights', nameTh: 'ไฟ' },
    { code: 'suspension', nameTh: 'ช่วงล่าง' },
    { code: 'electrical', nameTh: 'ไฟฟ้า' },
  ])

  // carriers (M5) — names match orders.carrier exactly
  await db.insert(schema.carriers).values([
    { code: 'flash', name: 'Flash' },
    { code: 'scg', name: 'SCG' },
    { code: 'kerry', name: 'Kerry' },
  ])

  // price tiers (M7) — data backbone for future tiered pricing (Phase C)
  await db.insert(schema.priceTiers).values([
    { grade: 'A', discountPct: 10, nameTh: 'ดีลเลอร์เกรด A' },
    { grade: 'B', discountPct: 5, nameTh: 'ดีลเลอร์เกรด B' },
    { grade: 'C', discountPct: 0, nameTh: 'ดีลเลอร์เกรด C' },
  ])

  // claim reasons (M9) — warranty reason codes
  await db.insert(schema.claimReasons).values([
    { code: 'manufacture_defect', nameTh: 'ชำรุดจากการผลิต' },
    { code: 'transit_damage', nameTh: 'เสียหายระหว่างขนส่ง' },
    { code: 'install_error', nameTh: 'ติดตั้งผิดพลาด' },
    { code: 'wrong_model', nameTh: 'ไม่ตรงรุ่น' },
    { code: 'other', nameTh: 'อื่นๆ' },
  ])

  // provinces (M12) — distinct dealer provinces, each tagged with a region
  const PROVINCE_REGION: Record<string, string> = {
    'กรุงเทพ': 'ภาคกลาง',
    'นนทบุรี': 'ภาคกลาง',
    'นครราชสีมา': 'ภาคอีสาน',
    'ขอนแก่น': 'ภาคอีสาน',
    'อุดรธานี': 'ภาคอีสาน',
    'เชียงใหม่': 'ภาคเหนือ',
    'ชลบุรี': 'ภาคตะวันออก',
    'สงขลา': 'ภาคใต้',
    'ภูเก็ต': 'ภาคใต้',
    'สุราษฎร์ธานี': 'ภาคใต้',
  }
  await db.insert(schema.provinces).values(
    PROVINCES.map((name) => ({ name, region: PROVINCE_REGION[name] ?? 'ภาคกลาง' })),
  )

  // app config (M11) — simple key/value
  await db.insert(schema.appConfig).values([
    { key: 'vat_rate', value: '7' },
    { key: 'currency', value: 'THB' },
    { key: 'credit_enforcement', value: 'block' },
    { key: 'credit_overlimit_pct', value: '0' },
  ])

  // ---- 100 dealers ---------------------------------------------------------
  const dealerRows = Array.from({ length: 100 }, (_, i) => {
    const n = i + 1
    const province = PROVINCES[i % PROVINCES.length]!
    const branch = (i % 4) + 1
    const creditLimit = 1_000_000 + (i % 7) * 250_000 // ~1.0–2.5M
    return {
      code: `DLR${pad(n, 4)}`,
      name: `มิตซูบิชิ ${province} สาขา ${branch}`,
      province,
      phone: `0${(2 + (i % 7))}-${pad(100 + i, 3)}-${pad(1000 + i * 7, 4)}`,
      grade: GRADES[i % GRADES.length]!,
      creditLimit,
      creditUsed: Math.round(creditLimit * ((i % 8) / 10)), // 0–70%
      createdAt: iso(120 - (i % 90)),
      creditTermId: gradeToTerm[GRADES[i % GRADES.length]!]!, // A→net60, B→net30, C→cod
    }
  })
  const insertedDealers = await db.insert(schema.dealers).values(dealerRows).returning()
  const dlr1 = insertedDealers[0]!.id

  // ---- Phase 2: sample dealer addresses (bill-to / ship-to + geo) ----------
  // A couple for DLR0001 (default billing + default shipping) and one for
  // DLR0002, so the address book + map preview have data out of the box.
  const dlr2 = insertedDealers[1]?.id
  await db.insert(schema.dealerAddresses).values(
    [
      {
        dealerId: dlr1,
        label: 'สำนักงานใหญ่',
        kind: 'billing' as const,
        line1: '199 ถนนสุขุมวิท',
        subDistrict: 'คลองเตย',
        district: 'คลองเตย',
        province: 'กรุงเทพมหานคร',
        postalCode: '10110',
        country: 'TH',
        lat: 13.7218,
        lng: 100.5793,
        contactName: 'ฝ่ายบัญชี',
        contactPhone: '02-111-2222',
        isDefaultBilling: true,
        isDefaultShipping: false,
        createdAt: iso(100),
        updatedAt: null,
      },
      {
        dealerId: dlr1,
        label: 'คลังรับสินค้า',
        kind: 'shipping' as const,
        line1: '88 หมู่ 4 ถนนบางนา-ตราด',
        subDistrict: 'บางแก้ว',
        district: 'บางพลี',
        province: 'สมุทรปราการ',
        postalCode: '10540',
        country: 'TH',
        lat: 13.6021,
        lng: 100.7501,
        contactName: 'ฝ่ายคลัง',
        contactPhone: '02-333-4444',
        isDefaultBilling: false,
        isDefaultShipping: true,
        createdAt: iso(100),
        updatedAt: null,
      },
      ...(dlr2 != null
        ? [
            {
              dealerId: dlr2,
              label: 'สาขาเชียงใหม่',
              kind: 'both' as const,
              line1: '55 ถนนนิมมานเหมินท์',
              subDistrict: 'สุเทพ',
              district: 'เมืองเชียงใหม่',
              province: 'เชียงใหม่',
              postalCode: '50200',
              country: 'TH',
              lat: 18.7969,
              lng: 98.9669,
              contactName: 'ผู้จัดการสาขา',
              contactPhone: '053-555-666',
              isDefaultBilling: true,
              isDefaultShipping: true,
              createdAt: iso(100),
              updatedAt: null,
            },
          ]
        : []),
    ],
  )

  // ---- 4 demo users (password "demo1234") ----------------------------------
  const hash = await bcrypt.hash('demo1234', 10)
  const insertedUsers = await db
    .insert(schema.users)
    .values([
      { email: 'admin@demo.co', passwordHash: hash, role: 'admin', dealerId: null, createdAt: iso(100) },
      { email: 'owner@demo.co', passwordHash: hash, role: 'owner', dealerId: dlr1, createdAt: iso(100) },
      { email: 'sales@demo.co', passwordHash: hash, role: 'sales', dealerId: dlr1, createdAt: iso(100) },
      { email: 'warehouse@demo.co', passwordHash: hash, role: 'warehouse', dealerId: null, createdAt: iso(100) },
    ])
    .returning()
  const adminId = insertedUsers.find((u) => u.role === 'admin')!.id

  // ---- vehicle models (master) ---------------------------------------------
  const MODEL_NAMES = ['Triton', 'Pajero Sport', 'Outlander PHEV', 'Attrage']
  await db.insert(schema.vehicleModels).values(
    MODEL_NAMES.map((name) => ({ name, active: true })),
  )

  // ---- 8 parts -------------------------------------------------------------
  // compatibleModels: [] = universal (fits all); otherwise the listed models only.
  // supplierId: round-robin across the seeded suppliers (Phase B Wave 1 FK).
  const partSeed = [
    { sku: 'MIT-OF-001', name: 'ไส้กรองน้ำมันเครื่อง', category: 'กรอง', oem: true, warrantyMonths: 12, leadTimeDays: 1, price: 350, compatibleModels: [] as string[] },
    { sku: 'MIT-AF-002', name: 'ไส้กรองอากาศ', category: 'กรอง', oem: true, warrantyMonths: 12, leadTimeDays: 1, price: 420, compatibleModels: ['Triton', 'Pajero Sport', 'Attrage'] },
    { sku: 'MIT-BP-003', name: 'ผ้าเบรกหน้า', category: 'เบรก', oem: true, warrantyMonths: 12, leadTimeDays: 2, price: 1850, compatibleModels: ['Triton', 'Pajero Sport'] },
    { sku: 'MIT-BP-004', name: 'ผ้าเบรกหน้า EV', category: 'เบรก', oem: true, warrantyMonths: 12, leadTimeDays: 2, price: 2300, compatibleModels: ['Outlander PHEV'] },
    { sku: 'MIT-WP-005', name: 'ใบปัดน้ำฝน 22"', category: 'อุปกรณ์', oem: false, warrantyMonths: 6, leadTimeDays: 1, price: 650, compatibleModels: [] as string[] },
    { sku: 'MIT-HL-006', name: 'โคมไฟหน้า LED', category: 'ไฟ', oem: true, warrantyMonths: 24, leadTimeDays: 5, price: 8900, compatibleModels: ['Pajero Sport', 'Outlander PHEV'] },
    { sku: 'MIT-SP-007', name: 'โช๊คอัพหลัง', category: 'ช่วงล่าง', oem: true, warrantyMonths: 24, leadTimeDays: 3, price: 3200, compatibleModels: ['Triton', 'Pajero Sport'] },
    { sku: 'MIT-BT-008', name: 'แบตเตอรี่ 65Ah', category: 'ไฟฟ้า', oem: true, warrantyMonths: 18, leadTimeDays: 2, price: 3450, compatibleModels: [] as string[] },
  ]
  const insertedParts = await db
    .insert(schema.parts)
    .values(
      partSeed.map((p, i) => ({
        ...p,
        supplierId: insertedSuppliers[i % insertedSuppliers.length]!.id, // round-robin
      })),
    )
    .returning()
  const partBySku = Object.fromEntries(insertedParts.map((p) => [p.sku, p]))

  // ---- inventory (both warehouses; some below reorder to drive low-stock) --
  const lowStock: Record<string, { bkk: [number, number]; cnx: [number, number] }> = {
    'MIT-BP-004': { bkk: [1, 8], cnx: [2, 8] }, // qty / reorder
    'MIT-HL-006': { bkk: [3, 4], cnx: [5, 4] },
  }
  const invRows = insertedParts.flatMap((p, i) => {
    const low = lowStock[p.sku]
    const bkk = low?.bkk ?? [40 + i * 5, 10]
    const cnx = low?.cnx ?? [25 + i * 3, 8]
    return [
      { partId: p.id, warehouse: 'คลังกรุงเทพ', qtyOnHand: bkk[0], reorderPoint: bkk[1] },
      { partId: p.id, warehouse: 'คลังเชียงใหม่', qtyOnHand: cnx[0], reorderPoint: cnx[1] },
    ]
  })
  await db.insert(schema.inventory).values(invRows)

  // ---- sample VINs ---------------------------------------------------------
  await db.insert(schema.vins).values([
    {
      vin: 'MMTJNKB40NH000001', model: 'Triton', modelYear: 2023, autologicInstalled: true,
      packageName: 'Fleet Tracker Pro', deviceSerial: 'ALG-2024-A8731',
      installCenter: 'ศูนย์บริการ Autologic กรุงเทพ (สาขารัชดา)', installDate: iso(220),
      firmware: 'v3.8.2', lastConnectedAt: iso(0), status: 'installed',
    },
    {
      vin: 'MMBJNKS50PH000003', model: 'Pajero Sport', modelYear: 2024, autologicInstalled: true,
      packageName: 'Premium Telematics', deviceSerial: 'ALG-2024-B1209',
      installCenter: 'ศูนย์บริการ Autologic เชียงใหม่', installDate: iso(150),
      firmware: 'v3.8.2', lastConnectedAt: iso(1), status: 'installed',
    },
    {
      vin: 'MMOJNPEV2RH000006', model: 'Outlander PHEV', modelYear: 2025, autologicInstalled: true,
      packageName: 'EV Telematics', deviceSerial: 'ALG-2025-E0455',
      installCenter: 'ศูนย์บริการ Autologic กรุงเทพ (สาขารัชดา)', installDate: iso(60),
      firmware: 'v4.1.0', lastConnectedAt: iso(0), status: 'installed',
    },
    {
      vin: 'MMTJNKB40NH000002', model: 'Triton', modelYear: 2023, autologicInstalled: true,
      packageName: 'Fleet Tracker Pro', deviceSerial: 'ALG-2024-A8732',
      installCenter: 'ศูนย์บริการ Autologic ขอนแก่น', installDate: iso(200),
      firmware: 'v3.8.2', lastConnectedAt: iso(2), status: 'installed',
    },
    {
      vin: 'MMAJNATG1NH000008', model: 'Attrage', modelYear: 2022, autologicInstalled: false,
      packageName: null, deviceSerial: null, installCenter: null, installDate: null,
      firmware: null, lastConnectedAt: null, status: 'pending',
    },
    {
      vin: 'MMAJNATG1NH000009', model: 'Attrage', modelYear: 2022, autologicInstalled: false,
      packageName: null, deviceSerial: null, installCenter: null, installDate: null,
      firmware: null, lastConnectedAt: null, status: 'not_installed',
    },
  ])

  // ---- ~40 sample orders + items (mostly DLR0001, a few others) -----------
  const installedVins = ['MMTJNKB40NH000001', 'MMBJNKS50PH000003', 'MMOJNPEV2RH000006', 'MMTJNKB40NH000002']
  const skuList = insertedParts.map((p) => p.sku)
  const insertedOrders: (typeof schema.orders.$inferSelect)[] = []
  let orderCount = 0
  for (let i = 0; i < 40; i++) {
    const dealer = i < 30 ? insertedDealers[0]! : insertedDealers[(i % 6) + 1]!
    const status = ORDER_STATUSES[i % ORDER_STATUSES.length]!
    // 1–3 line items
    const lineCount = (i % 3) + 1
    const lines = Array.from({ length: lineCount }, (_, k) => {
      const part = partBySku[skuList[(i + k) % skuList.length]!]!
      const qty = ((i + k) % 4) + 1
      return { part, qty }
    })
    const total = lines.reduce((s, l) => s + l.part.price * l.qty, 0)
    const shipped = status === 'shipped' || status === 'delivered'
    const [order] = await db
      .insert(schema.orders)
      .values({
        poNumber: `PO-2026-${pad(89000 + i, 6)}`,
        dealerId: dealer.id,
        vin: installedVins[i % installedVins.length]!,
        status,
        subtotal: total,
        discount: 0,
        vat: 0,
        totalValue: total,
        invoiceNo: `INV-2026-${pad(89000 + i, 6)}`,
        trackingNo: shipped ? `TH${pad(1000000 + i * 13, 8)}` : null,
        carrier: shipped ? CARRIERS[i % CARRIERS.length]! : null,
        createdAt: iso(45 - (i % 40)),
      })
      .returning()
    await db.insert(schema.orderItems).values(
      lines.map((l) => ({
        orderId: order!.id,
        partId: l.part.id,
        qty: l.qty,
        unitPrice: l.part.price,
      })),
    )
    insertedOrders.push(order!)
    orderCount++
  }

  // ---- ~6 claims -----------------------------------------------------------
  const claimStatuses = ['submitted', 'reviewing', 'rejected', 'approved'] as const
  const reasons = [
    'ชิ้นส่วนชำรุดจากการขนส่ง', 'สินค้าไม่ตรงรุ่น', 'อายุการใช้งานต่ำกว่ามาตรฐาน',
    'พบรอยร้าวหลังติดตั้ง', 'ค่าไฟกระพริบผิดปกติ', 'เสียงดังผิดปกติ',
  ]
  // Scope each claim to the dealer that actually ordered its VIN (Phase L);
  // fall back to dlr1 if that VIN has no order in the seed set.
  const dealerByVin = new Map(insertedOrders.map((o) => [o.vin, o.dealerId]))
  await db.insert(schema.claims).values(
    Array.from({ length: 6 }, (_, i) => {
      const vin = installedVins[i % installedVins.length]!
      return {
        claimNumber: `CLM-2026-${pad(i + 1, 4)}`,
        dealerId: dealerByVin.get(vin) ?? dlr1,
        vin,
        partSku: skuList[i % skuList.length]!,
        reason: reasons[i]!,
        status: claimStatuses[i % claimStatuses.length]!,
        amount: 350 + i * 600,
        createdAt: iso(20 - i * 2),
      }
    }),
  )

  // ---- demo payments (Phase G — Accounts Receivable) ----------------------
  // Settle a representative slice of DLR0001's orders so /payments and the
  // AR-aging report have realistic data, then align DLR0001's creditUsed to its
  // true outstanding receivables (orders consume credit; payments release it).
  const PAY_METHODS = ['transfer', 'cash', 'cheque', 'card'] as const
  const dlr1Orders = insertedOrders.filter((o) => o.dealerId === dlr1 && o.status !== 'cancelled')
  let rcpSeq = 0
  let paymentCount = 0
  let dlr1Outstanding = 0
  for (let i = 0; i < dlr1Orders.length; i++) {
    const o = dlr1Orders[i]!
    const mod = i % 3 // 0 → paid in full, 1 → partial (40%), 2 → left unpaid
    const amount = mod === 0 ? o.totalValue : mod === 1 ? Math.floor(o.totalValue * 0.4) : 0
    if (amount > 0) {
      rcpSeq++
      const daysAgo = (i % 25) + 1
      await db.insert(schema.payments).values({
        receiptNo: `RCP-2026-${pad(rcpSeq, 6)}`,
        dealerId: dlr1,
        orderId: o.id,
        amount,
        method: PAY_METHODS[i % PAY_METHODS.length]!,
        reference: `REF-${pad(1000 + i, 4)}`,
        note: null,
        receivedAt: iso(daysAgo),
        createdBy: adminId,
        createdAt: iso(daysAgo),
      })
      await db
        .update(schema.orders)
        .set({ amountPaid: amount, paymentStatus: amount >= o.totalValue ? 'paid' : 'partial' })
        .where(eq(schema.orders.id, o.id))
      paymentCount++
    }
    dlr1Outstanding += o.totalValue - amount
  }

  // Two on-account (no-order) advance payments — release credit directly.
  let onAccountTotal = 0
  for (let k = 0; k < 2; k++) {
    rcpSeq++
    const amount = 5000 * (k + 1)
    onAccountTotal += amount
    await db.insert(schema.payments).values({
      receiptNo: `RCP-2026-${pad(rcpSeq, 6)}`,
      dealerId: dlr1,
      orderId: null,
      amount,
      method: 'transfer',
      reference: `ONACC-${k + 1}`,
      note: 'ชำระเข้าบัญชีล่วงหน้า',
      receivedAt: iso(k + 1),
      createdBy: adminId,
      createdAt: iso(k + 1),
    })
    paymentCount++
  }

  await db
    .update(schema.dealers)
    .set({ creditUsed: Math.max(0, dlr1Outstanding - onAccountTotal) })
    .where(eq(schema.dealers.id, dlr1))

  return { dealers: insertedDealers.length, users: 4, orders: orderCount, payments: paymentCount }
}
