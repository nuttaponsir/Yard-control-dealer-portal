# Mitsubishi Dealer Portal — Functional Specification (SPEC.md)

> **Status:** Source of truth for build & verification.
> **Audience:** 4 dev agents (build from this), 2 test agents (verify against this), 1 architect (owns schema; this doc describes meaning/constraints, not table DDL).
> **Authoring note:** This document is written by the Business Analyst from the live-app exploration notes. Where a fact was confirmed against the running app it is marked **(verified live)**. Thai UI labels are given in quotes next to their English meaning.

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Roles & Permissions (RBAC)](#2-roles--permissions-rbac)
3. [Modules (7)](#3-modules-7)
4. [Order Lifecycle & Status Labels](#4-order-lifecycle--status-labels)
5. [Data Dictionary](#5-data-dictionary)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Glossary of Thai UI Labels](#7-glossary-of-thai-ui-labels)

---

## 1. Overview & Purpose

The **Mitsubishi Dealer Portal** ("พอร์ทัลผู้แทนจำหน่ายมิตซูบิชิ") is a B2B web application that lets a network of car dealers order **Mitsubishi spare parts**. Each dealer has staff who look up vehicles, browse a parts catalog, place purchase orders, track fulfillment, and file warranty claims. A back-office admin oversees the whole dealer network.

### 1.1 The core business rule — VIN-gated ordering

Ordering parts is **VIN-GATED**. A dealer cannot browse or order parts in the abstract. They must:

1. Enter a **17-character VIN** (Vehicle Identification Number) in the **VIN check** module.
2. The system confirms whether that vehicle has an **"Autologic" telematics device** installed (`autologicInstalled = true`).
3. **Only if Autologic is installed** does the parts **Catalog** unlock for that VIN. The catalog is then filtered to parts that fit the VIN's model.
4. If the VIN has **no Autologic device** (`autologicInstalled = false` / `not_installed`), the user sees a **blocked state** and cannot proceed to the catalog or place an order for that VIN.

This rule is the spine of the product. Every order is bound to (a) the dealer the ordering user belongs to and (b) a specific Autologic-verified VIN.

### 1.2 UI & theming

- **Thai-first UI** with a **TH / EN language toggle**. Thai is the default; English is a secondary translation. Throughout this spec, Thai labels appear in quotes.
- **Dark Mitsubishi-red theme** (dark background, Mitsubishi red as the primary accent — the "three-diamond" red `#E60012`-family).
- Responsive layout suitable for desktop dealer workstations.

### 1.3 High-level user journeys

| Journey | Actor | Path |
|---|---|---|
| Order parts for a customer car | sales / owner | Login → VIN check → (Autologic OK) → Catalog → add to cart → checkout → order created |
| Oversee the network | admin | Login → Dashboard → Admin dealer directory |
| Fulfill an order | warehouse | Login → Warehouse Kanban → advance status pending→…→delivered |
| File a warranty claim | warehouse / dealer | Login → Claims → scan VIN → load purchase history → file claim |

---

## 2. Roles & Permissions (RBAC)

### 2.1 Demo accounts

All demo accounts share the password **`demo1234`**.

| Email | Role | Tied to a dealer? | Can place orders? | Data scope |
|---|---|---|---|---|
| `admin@demo.co` | **admin** | No | **No** | All dealers' data (network-wide) |
| `owner@demo.co` | **owner** | Yes (one dealer) | **Yes** | Own dealer only |
| `sales@demo.co` | **sales** | Yes (one dealer) | **Yes** | Own dealer only |
| `warehouse@demo.co` | **warehouse** | (fulfillment role) | No (fulfillment/claims focus) | Fulfillment + claims |

### 2.2 The two hard rules (state explicitly)

1. **Admin cannot order.** The admin account is **not tied to any dealer**, therefore it has no dealer context to attach an order to. The checkout / "order now" action must be **disabled or rejected** for admin. Any attempt to submit an order as admin must fail.
2. **Sales (and owner) are dealer-scoped.** A sales or owner user sees **only their own dealer's** orders, claims, and credit data. They must never see another dealer's POs, claims, or credit usage.

### 2.3 Role → allowed-routes matrix

Routes use the Thai nav labels shown in the sidebar; canonical route paths are suggested for the devs.

| Module (Thai label) | Suggested route | admin | owner | sales | warehouse |
|---|---|:---:|:---:|:---:|:---:|
| Dashboard "ภาพรวม" | `/` or `/dashboard` | ✅ | ✅ | ✅ | ✅ |
| VIN check "ตรวจสอบ VIN" | `/vin` | ✅ | ✅ | ✅ | ✅ |
| Catalog / order "แคตตาล็อก" | `/catalog` | ✅ (browse, no order) | ✅ | ✅ | ❌ |
| Orders "คำสั่งซื้อ" | `/orders` | ✅ (all) | ✅ (own) | ✅ (own) | ✅ |
| Claims "เคลม" | `/claims` | ✅ | ✅ | ❌ | ✅ |
| Warehouse "คลังสินค้า" | `/warehouse` | ✅ | ❌ | ❌ | ✅ |
| Admin "ผู้ดูแลระบบ" | `/admin` | ✅ | ❌ | ❌ | ❌ |

**Notes:**
- **admin** sees **all 7 modules**. Within Catalog, admin may browse but the order/checkout action is disabled (rule 2.2.1).
- **owner** sees the dealer-facing modules and may order; does not see Warehouse fulfillment board or Admin directory.
- **sales** nav is **limited to exactly four items**: ภาพรวม / ตรวจสอบ VIN / แคตตาล็อก / คำสั่งซื้อ (Dashboard / VIN check / Catalog / Orders). Sales does **not** see Claims, Warehouse, or Admin.
- **warehouse** is focused on fulfillment + claims: Dashboard, VIN check, Orders, Claims, Warehouse. No Catalog ordering and no Admin.

> The matrix above is the authoritative definition of "exactly its allowed nav items" referenced in the acceptance criteria. Test agents should assert the nav list per role matches this table cell-for-cell (the ✅ cells, treating Catalog-for-admin as "visible").

### 2.4 Authentication

- The app has a single auth page at **`/auth`** (login form with email + password).
- **Any unauthenticated request to a protected route redirects to `/auth`.**
- After login, the user lands on the Dashboard.
- Session persists until logout; logout returns to `/auth`.

---

## 3. Modules (7)

For each module: **purpose**, **key UI elements**, **behaviors**.

### 3.1 Dashboard — "ภาพรวม"

**Purpose:** At-a-glance operational overview for the logged-in user, scoped to their role/dealer.

**Key UI elements:**
- **KPI cards** (4): **Total orders**, **Pending** ("รอดำเนินการ"), **In-transit** (shipped/"จัดส่งแล้ว"), **Delivered** ("ส่งถึงแล้ว"). Each shows a count.
- **Daily-orders chart:** orders per day over a recent window (bar or line).
- **Low-stock table:** columns **SKU**, **part name**, **warehouse** (กรุงเทพ / เชียงใหม่), **qty on hand**, **reorder point**. Rows where `qtyOnHand < reorderPoint` are highlighted **red**.
- **Dealer credit panel** (owner & sales only): shows **credit used vs credit limit** as a progress bar (e.g., "ใช้ไป ฿X / วงเงิน ฿Y").

**Behaviors:**
- KPI counts and chart are **scoped by role**: admin sees network-wide totals; owner/sales see only their own dealer's orders.
- The credit panel is **hidden for admin and warehouse** (admin is not tied to a dealer; warehouse has no credit context).
- Low-stock table lists **exactly** the inventory rows below their reorder point (see AC 6.7).

---

### 3.2 VIN check — "ตรวจสอบ VIN"

**Purpose:** The gate. Verify a vehicle's Autologic status before any ordering is allowed.

**Key UI elements:**
- **VIN input** accepting a **17-character VIN**. Sample **VIN chips** (quick-fill buttons) for demo VINs — at least one Autologic-installed and one not-installed sample.
- **Result panel** that branches on Autologic status.

**Behaviors — when Autologic IS installed (`autologicInstalled = true`):**
- Show an **installed / OK** state including: vehicle **model + year**, **package name**, **device serial**, **install center / technician**, **firmware version**, **last-connected** timestamp.
- Show an **"order now"** CTA ("สั่งซื้อเลย" / "ไปที่แคตตาล็อก") that navigates to the **Catalog** with this VIN as the active/checked VIN.
- The checked VIN becomes the **active VIN context** used by the Catalog and checkout.

**Behaviors — when Autologic is NOT installed (`autologicInstalled = false` / `not_installed`):**
- Show a **blocked state** (clear message that this vehicle has no Autologic device and parts ordering is unavailable).
- **No "order now" CTA.** The catalog must not unlock for this VIN.

**Validation:**
- VIN must be exactly **17 characters**. Invalid length → inline validation error, no lookup performed (or lookup returns "not found").
- Unknown VIN (not in data) → "not found" state.

---

### 3.3 Catalog / order — "แคตตาล็อก"

**Purpose:** Browse and order parts that fit the Autologic-verified VIN's model.

**Gate precondition:** Catalog is **only usable when an Autologic-verified VIN is active** (selected from VIN check). If a user reaches Catalog without an active verified VIN, show a prompt to check a VIN first (gated/empty state) — no parts and no cart.

**Key UI elements:**
- **Parts cards** — filtered to parts compatible with the **checked VIN's model**.
- **Category filter chips:** กรอง (filters), เบรก (brakes), อุปกรณ์ (accessories), ไฟ (lights), ช่วงล่าง (suspension), ไฟฟ้า (electrical). Selecting a chip filters the cards by category.
- **Each part card shows:** part **name**, **SKU**, **category**, **OEM badge**, **warranty (months)**, **lead time (days)**, **per-warehouse stock** (กรุงเทพ / เชียงใหม่), **price** (฿), and an **add-to-cart** control with a **quantity stepper**.
- **Cart sidebar:** line items with **qty steppers**, **line totals** (qty × unitPrice), a **grand total**, and a **"สั่งซื้อ"** (place order / checkout) button.

**Behaviors:**
- Adding a part to cart with quantity N creates/updates a cart line; line total = `qty × unitPrice`.
- Grand total = Σ of line totals.
- **Checkout ("สั่งซื้อ")** creates an order (PO) — see §4 and AC 6.5. After checkout the cart clears.
- For **admin**, the checkout action is **disabled** (admin cannot order — rule 2.2.1).
- Category chip "กรอง" is the general filter/clear control or the "filter" (กรอง) parts category as labeled in UI; treat the six chips as the category filter set.

---

### 3.4 Orders — "คำสั่งซื้อ"

**Purpose:** List and track purchase orders.

**Key UI elements:**
- **Orders table** with columns: **PO number** (e.g., `PO-2026-089793`), **dealer**, **VIN**, **status badge** (Thai label, color-coded), **tracking no.**, **value** (฿, the order's `totalValue`), **date**.

**Behaviors:**
- **Scope:** **sales / owner** see **only their own dealer's** POs. **admin** sees **all** POs across all dealers. **warehouse** sees orders relevant to fulfillment.
- Status badge color tracks lifecycle (§4).
- Newly checked-out orders appear here with status **pending "รอดำเนินการ"**.

---

### 3.5 Claims — "เคลม"

**Purpose:** File and track warranty claims against previously purchased parts for a given VIN.

**Key UI elements:**
- **VIN scan / input** to load the **purchase history for that VIN**.
- **Purchase-history list** for the scanned VIN (the parts/orders previously bought for it).
- **File-claim form** (select the purchased item/part, reason, etc.).
- **Recent-claims list** with **status badges**.

**Behaviors:**
- Scanning a VIN loads that VIN's purchase history; a claim is filed against an item in that history.
- New claims start at **submitted "ส่งคำร้อง"** and move through **reviewing "กำลังตรวจสอบ"** to **approved** or **rejected "ปฏิเสธ"** (§4.2).
- Visible to admin, owner, warehouse. **Not visible to sales** (per nav matrix 2.3).

---

### 3.6 Warehouse — "คลังสินค้า"

**Purpose:** Fulfillment operations: move orders through the pipeline and manage stock.

**Key UI elements:**
- **Kanban fulfillment board** with **5 columns** in order:
  1. **pending** "รอดำเนินการ"
  2. **confirming** "กำลังยืนยันสินค้า"
  3. **packing** "กำลังแพ็ค"
  4. **shipped** "จัดส่งแล้ว"
  5. **delivered** "ส่งถึงแล้ว"
- **Order cards** in each column, each with an **advance-status action** (move to next column).
- **Sub-tabs:** warehouse dashboard, **pick list**, **pack & ship**, **stock / bin**.

**Behaviors:**
- The advance action moves a card to the **next** status only (forward, one step). It must **not** move backward and must **not** skip a column (see AC 6.6).
- Visible to admin and warehouse only.

---

### 3.7 Admin — "ผู้ดูแลระบบ"

**Purpose:** Network-wide administration: the dealer directory.

**Key UI elements:**
- **Dealer directory** of **100 dealers**, each row showing: **dealer code**, **name**, **province**, **phone**, **grade** (A / B / C), **credit limit** and **credit used** with a **progress bar**.
- **Search** box (by code/name/province).
- **KPI cards:** **total dealers** (100), **grade A count**, **grade B count**, **system status**.

**Behaviors:**
- Search filters the directory list.
- Visible to **admin only**.
- Credit progress bar shows `creditUsed / creditLimit`.

---

## 4. Order Lifecycle & Status Labels

### 4.1 Order status (fulfillment) — strict forward order

| # | Status key | Thai label | Meaning |
|---|---|---|---|
| 1 | `pending` | "รอดำเนินการ" | Awaiting processing (newly created) |
| 2 | `confirming` | "กำลังยืนยันสินค้า" | Confirming stock/items |
| 3 | `packing` | "กำลังแพ็ค" | Being packed |
| 4 | `shipped` | "จัดส่งแล้ว" | Shipped / in transit |
| 5 | `delivered` | "ส่งถึงแล้ว" | Delivered to dealer |

**Transition rule:** Advance moves **exactly one step forward** in the sequence `pending → confirming → packing → shipped → delivered`. No backward moves, no skipping, no advancing past `delivered`.

### 4.2 Claim status

| Status key | Thai label | Meaning |
|---|---|---|
| `submitted` | "ส่งคำร้อง" | Claim filed |
| `reviewing` | "กำลังตรวจสอบ" | Under review |
| `approved` | (approved) | Claim approved |
| `rejected` | "ปฏิเสธ" | Claim rejected |

### 4.3 PO numbering

- Format: **`PO-YYYY-NNNNNN`** — prefix `PO`, the 4-digit year, then a 6-digit sequence/number.
- Example **(verified live):** `PO-2026-089793`.
- Regex for validation: `^PO-\d{4}-\d{6}$`.

### 4.4 Order total computation

- `totalValue = Σ (lineItem.qty × lineItem.unitPrice)` over all order items.
- **Verified live example:** cart of `2 × ฿350` + `1 × ฿420` = **฿1,120**. (`700 + 420 = 1120`.) Test agents should reproduce this exact total.

### 4.5 Side effects of checkout

When an order is created at checkout:
1. A new order is persisted with a new PO number, **status = `pending`**, the computed `totalValue`, tied to **the user's dealer** and **the active (Autologic-verified) VIN**.
2. The order **appears in the Orders list** ("คำสั่งซื้อ").
3. The dealer's **`creditUsed` increases by the order's `totalValue`**.

---

## 5. Data Dictionary

> The **architect owns the physical schema** (table/column DDL, types, indexes). This section describes **entity meaning and constraints** so devs and testers share one mental model. Field names are indicative.

### 5.1 Entities overview

| Entity | Purpose |
|---|---|
| `dealers` | The dealer businesses in the network (100 of them). |
| `users` | Login accounts; each has a role and (except admin) a dealer. |
| `vins` | Vehicles, including their Autologic telematics status/details. |
| `parts` | Catalog of Mitsubishi spare parts. |
| `inventory` | Stock of a part at a specific warehouse. |
| `orders` | Purchase orders (POs) placed by dealers. |
| `orderItems` | Line items within an order. |
| `claims` | Warranty claims filed against purchased parts for a VIN. |

### 5.2 `dealers`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique dealer id. |
| `code` | Dealer code (displayed in directory). |
| `name` | Dealer business name. |
| `province` | Thai province. |
| `phone` | Contact phone. |
| `grade` | One of **A / B / C** (dealer tier). |
| `creditLimit` | Maximum credit (฿). |
| `creditUsed` | Credit consumed (฿). **Constraint: `creditUsed ≤ creditLimit`.** Increases by `totalValue` on each order. |

### 5.3 `users`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique user id. |
| `email` | Login email (unique). |
| `password` | Demo password `demo1234` (hashed in storage). |
| `role` | One of **admin / owner / sales / warehouse**. |
| `dealerId` | FK to `dealers`. **NULL for admin** (admin is not tied to a dealer); set for owner/sales. |

### 5.4 `vins`

| Field | Meaning / constraint |
|---|---|
| `vin` | **Exactly 17 characters** (the VIN, unique). |
| `model` | Mitsubishi model name. Used to filter the Catalog. |
| `year` | Model year. |
| `autologicInstalled` | **Boolean gate.** `true` → catalog unlocks; `false`/`not_installed` → blocked. |
| `packageName` | Autologic package (shown when installed). |
| `deviceSerial` | Autologic device serial (when installed). |
| `installCenter` | Where it was installed (when installed). |
| `technician` | Installing technician (when installed). |
| `firmware` | Firmware version (when installed). |
| `lastConnected` | Last telematics connection timestamp (when installed). |

### 5.5 `parts`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique part id. |
| `sku` | Stock-keeping unit (unique, shown on card). |
| `name` | Part name. |
| `category` | One of: filters "กรอง", brakes "เบรก", accessories "อุปกรณ์", lights "ไฟ", suspension "ช่วงล่าง", electrical "ไฟฟ้า". |
| `oem` | OEM flag → shows **OEM badge**. |
| `warrantyMonths` | Warranty length in months. |
| `leadTimeDays` | Lead time in days. |
| `unitPrice` | Price per unit (฿). |
| `compatibleModels` | Which VIN models this part fits (drives catalog filtering). |

### 5.6 `inventory`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique row id. |
| `partId` | FK to `parts`. |
| `warehouse` | Warehouse location: **กรุงเทพ (Bangkok)** or **เชียงใหม่ (Chiang Mai)**. |
| `qtyOnHand` | Units in stock. |
| `reorderPoint` | Threshold. **Low-stock when `qtyOnHand < reorderPoint`** (red in dashboard). |

### 5.7 `orders`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique order id. |
| `poNumber` | Format `PO-YYYY-NNNNNN` (e.g., `PO-2026-089793`). |
| `dealerId` | FK to `dealers` — the ordering user's dealer. |
| `vin` | FK to `vins` — the Autologic-verified VIN the order is for. |
| `status` | One of pending/confirming/packing/shipped/delivered (§4.1). New orders = `pending`. |
| `trackingNo` | Carrier tracking number (set during fulfillment). |
| `totalValue` | `Σ qty × unitPrice` (฿). |
| `createdAt` | Order date (shown in table). |

### 5.8 `orderItems`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique line id. |
| `orderId` | FK to `orders`. |
| `partId` | FK to `parts`. |
| `qty` | Quantity (≥ 1). |
| `unitPrice` | Price captured at order time. |
| `lineTotal` | `qty × unitPrice`. |

### 5.9 `claims`

| Field | Meaning / constraint |
|---|---|
| `id` | Unique claim id. |
| `vin` | FK to `vins` — the vehicle the claim is for. |
| `orderItemId` / `partId` | The purchased part being claimed (from that VIN's purchase history). |
| `status` | submitted/reviewing/approved/rejected (§4.2). New = `submitted`. |
| `reason` | Claim reason / description. |
| `createdAt` | Filing date. |

---

## 6. Acceptance Criteria

> **MOST IMPORTANT SECTION.** Each criterion is written to be turned 1:1 into a test. IDs (AC-x) are stable references. "Given/When/Then" phrasing where helpful.

### 6.0 Authentication & routing (cross-cutting)

| ID | Criterion |
|---|---|
| AC-0.1 | **Unauthenticated** access to any protected route (`/`, `/vin`, `/catalog`, `/orders`, `/claims`, `/warehouse`, `/admin`) **redirects to `/auth`**. |
| AC-0.2 | Logging in with a valid demo email + `demo1234` succeeds and lands on the Dashboard. |
| AC-0.3 | Logging in with a wrong password fails and stays on `/auth` with an error. |
| AC-0.4 | After logout, the user is returned to `/auth` and protected routes again redirect to `/auth`. |
| AC-0.5 | The TH/EN toggle switches UI language; Thai is the default on first load. |

### 6.1 RBAC / navigation

| ID | Criterion |
|---|---|
| AC-1.1 | **admin** sees all 7 nav modules: ภาพรวม, ตรวจสอบ VIN, แคตตาล็อก, คำสั่งซื้อ, เคลม, คลังสินค้า, ผู้ดูแลระบบ. |
| AC-1.2 | **owner** sees: ภาพรวม, ตรวจสอบ VIN, แคตตาล็อก, คำสั่งซื้อ, เคลม. (No คลังสินค้า, no ผู้ดูแลระบบ.) |
| AC-1.3 | **sales** sees **exactly four** items: ภาพรวม, ตรวจสอบ VIN, แคตตาล็อก, คำสั่งซื้อ. (No เคลม, คลังสินค้า, ผู้ดูแลระบบ.) |
| AC-1.4 | **warehouse** sees: ภาพรวม, ตรวจสอบ VIN, คำสั่งซื้อ, เคลม, คลังสินค้า. (No แคตตาล็อก ordering, no ผู้ดูแลระบบ.) |
| AC-1.5 | A role navigating directly (URL) to a route **not** in its allowed set is denied (redirect/403/not rendered). E.g., sales → `/admin` is blocked; owner → `/warehouse` is blocked. |
| AC-1.6 | **admin CANNOT submit an order**: the checkout/"สั่งซื้อ" / "order now" action is disabled for admin, and any forced submit attempt is rejected (no order created). |
| AC-1.7 | **sales/owner data scope**: the Orders list shows **only the user's own dealer's** POs; no other dealer's PO appears. |
| AC-1.8 | **admin data scope**: the Orders list and admin directory show **all** dealers' data. |

### 6.2 Dashboard

| ID | Criterion |
|---|---|
| AC-2.1 | Four KPI cards render with numeric counts: total orders, pending, in-transit (shipped), delivered. |
| AC-2.2 | KPI counts for owner/sales reflect **only their dealer's** orders; for admin, network-wide. |
| AC-2.3 | The daily-orders chart renders with data points for the recent window. |
| AC-2.4 | The **credit panel** is shown for **owner and sales** and **hidden** for admin and warehouse. |
| AC-2.5 | The credit panel bar reflects `creditUsed / creditLimit` for the user's dealer. |

### 6.3 VIN check (the gate)

| ID | Criterion |
|---|---|
| AC-3.1 | Entering an **Autologic-installed** VIN shows: model+year, package name, device serial, install center/technician, firmware, last-connected, and an **"order now"** CTA. |
| AC-3.2 | Entering a **not-installed** VIN shows a **blocked state** and **no "order now" CTA**. |
| AC-3.3 | A VIN that is not exactly **17 characters** is rejected (inline validation; no successful lookup). |
| AC-3.4 | Sample VIN chips quick-fill the input; at least one installed and one not-installed sample exist. |
| AC-3.5 | Clicking "order now" sets the active VIN context and navigates to the Catalog with that VIN. |

### 6.4 Catalog / VIN gate

| ID | Criterion |
|---|---|
| AC-4.1 | **Catalog/order is blocked until a VIN with `autologicInstalled = true` is selected.** Reaching Catalog without a verified active VIN shows a gated/empty prompt (no parts, no cart). |
| AC-4.2 | With a verified VIN active, the Catalog shows **only parts compatible with that VIN's model**. |
| AC-4.3 | Selecting a category chip (กรอง/เบรก/อุปกรณ์/ไฟ/ช่วงล่าง/ไฟฟ้า) filters the cards to that category. |
| AC-4.4 | Each part card displays name, SKU, category, OEM badge (when OEM), warranty months, lead time days, per-warehouse stock (กรุงเทพ/เชียงใหม่), and price. |
| AC-4.5 | The qty stepper and add-to-cart add a line; line total = qty × unitPrice; cart grand total = Σ line totals. |
| AC-4.6 | A not-installed VIN can **never** reach a usable catalog or cart (negative test of the gate). |

### 6.5 Checkout → order creation

| ID | Criterion |
|---|---|
| AC-5.1 | Checkout ("สั่งซื้อ") creates a **PO** whose number matches `^PO-\d{4}-\d{6}$`. |
| AC-5.2 | The created order has **status = `pending`** ("รอดำเนินการ"). |
| AC-5.3 | `totalValue = Σ (qty × unitPrice)`. Concrete check: cart `2×฿350 + 1×฿420` → `totalValue = ฿1,120` **(verified live)**. |
| AC-5.4 | The order is **tied to the ordering user's dealer** (`dealerId`) and to the **active Autologic-verified VIN**. |
| AC-5.5 | After checkout, the new order **appears in the Orders list** ("คำสั่งซื้อ"). |
| AC-5.6 | After checkout, the dealer's **`creditUsed` increases by exactly the order's `totalValue`**. |
| AC-5.7 | Checkout is unavailable to admin (ties back to AC-1.6); no order is created. |

### 6.6 Warehouse fulfillment

| ID | Criterion |
|---|---|
| AC-6.1 | The Kanban board shows 5 columns in order: pending "รอดำเนินการ" → confirming "กำลังยืนยันสินค้า" → packing "กำลังแพ็ค" → shipped "จัดส่งแล้ว" → delivered "ส่งถึงแล้ว". |
| AC-6.2 | The advance action moves an order to **the next status in sequence** (one step forward). |
| AC-6.3 | The advance action **cannot move backward** and **cannot skip** a column. |
| AC-6.4 | An order at `delivered` cannot be advanced further. |
| AC-6.5 | Advancing reflects in the Orders table status badge for that PO. |

### 6.7 Low-stock table

| ID | Criterion |
|---|---|
| AC-7.1 | The Dashboard low-stock table lists **exactly** the inventory rows where `qtyOnHand < reorderPoint` — no more, no fewer. |
| AC-7.2 | Each such row is visually flagged **red**. |
| AC-7.3 | Columns present: SKU, part name, warehouse, qty on hand, reorder point. |

### 6.8 Claims

| ID | Criterion |
|---|---|
| AC-8.1 | Scanning a VIN loads **that VIN's purchase history**. |
| AC-8.2 | Filing a claim against a purchased item creates a claim with **status = `submitted`** ("ส่งคำร้อง"). |
| AC-8.3 | The new claim appears in the recent-claims list with a status badge. |
| AC-8.4 | Claim statuses progress submitted → reviewing → approved/rejected (no invalid jumps). |
| AC-8.5 | Claims module is **not** accessible to **sales** (per nav matrix). |

### 6.9 Admin directory

| ID | Criterion |
|---|---|
| AC-9.1 | The dealer directory lists **100 dealers** with code, name, province, phone, grade (A/B/C), and credit limit/used progress bar. |
| AC-9.2 | KPI cards show total dealers (100), grade A count, grade B count, system status. |
| AC-9.3 | Search filters the directory by code/name/province. |
| AC-9.4 | Each dealer's credit progress bar reflects `creditUsed / creditLimit` and `creditUsed ≤ creditLimit` always holds. |
| AC-9.5 | The Admin module is accessible to **admin only**. |

### 6.10 Seed data

| ID | Criterion |
|---|---|
| AC-10.1 | Seeding produces **exactly 100 dealers**. |
| AC-10.2 | Seeding produces the **4 demo users**: `admin@demo.co` (admin, no dealer), `owner@demo.co` (owner, dealer), `sales@demo.co` (sales, dealer), `warehouse@demo.co` (warehouse). All with password `demo1234`. |
| AC-10.3 | Seed includes VINs covering **both** Autologic states (at least one installed, one not-installed) matching the sample VIN chips. |
| AC-10.4 | Seed includes parts across all six categories with per-warehouse inventory for กรุงเทพ and เชียงใหม่, including at least some rows where `qtyOnHand < reorderPoint` so the low-stock table is non-empty. |
| AC-10.5 | Every seeded dealer satisfies `creditUsed ≤ creditLimit`. |

### 6.11 Cross-cutting integrity

| ID | Criterion |
|---|---|
| AC-11.1 | Every order references a valid dealer and a valid VIN; the VIN on any order has `autologicInstalled = true`. |
| AC-11.2 | A dealer's `creditUsed` equals the sum of its orders' `totalValue` after seeding + any new checkouts (within the credit limit). |
| AC-11.3 | PO numbers are unique across all orders. |
| AC-11.4 | All status/Thai labels render exactly as specified in §4 and §7. |

---

## 7. Glossary of Thai UI Labels

| Thai | English / meaning |
|---|---|
| ภาพรวม | Dashboard / Overview |
| ตรวจสอบ VIN | VIN check |
| แคตตาล็อก | Catalog (parts catalog / order) |
| คำสั่งซื้อ | Orders (purchase orders) |
| เคลม | Claims |
| คลังสินค้า | Warehouse |
| ผู้ดูแลระบบ | Admin (system administrator) |
| สั่งซื้อ | Place order / checkout |
| สั่งซื้อเลย / ไปที่แคตตาล็อก | Order now / go to catalog (CTA) |
| รอดำเนินการ | pending |
| กำลังยืนยันสินค้า | confirming |
| กำลังแพ็ค | packing |
| จัดส่งแล้ว | shipped / in-transit |
| ส่งถึงแล้ว | delivered |
| ส่งคำร้อง | (claim) submitted |
| กำลังตรวจสอบ | (claim) reviewing |
| ปฏิเสธ | (claim) rejected |
| กรุงเทพ | Bangkok (warehouse) |
| เชียงใหม่ | Chiang Mai (warehouse) |
| กรอง | filters (part category) |
| เบรก | brakes |
| อุปกรณ์ | accessories |
| ไฟ | lights |
| ช่วงล่าง | suspension |
| ไฟฟ้า | electrical |
| วงเงิน / ใช้ไป | credit limit / used |

---

*End of SPEC.md*
