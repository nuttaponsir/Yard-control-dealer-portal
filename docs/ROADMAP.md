# Mitsubishi Dealer Portal — Master Data, Reports & Development Roadmap

> **Status:** Planning artifact (PM/BA/SA). Big-picture plan that combines clone-parity
> gaps, real business gaps, the master-data layer, and the reporting suite.
> **Baseline:** clone is ~85% parity with the live app, 102 tests green on Postgres.
> Current tables: `dealers, users, vins, parts, inventory, orders, orderItems, claims, sessions`.

---

## 1. Master Data Analysis (ข้อมูลหลัก)

### 1.1 Masters we already have
| Master | Table | State |
|---|---|---|
| Dealers (ดีลเลอร์) | `dealers` | OK — code, name, province, phone, grade, credit |
| Users (ผู้ใช้) | `users` | OK — role + dealerId |
| Parts (อะไหล่) | `parts` | OK but category/warehouse are inline strings |
| VINs / Vehicles (รถ) | `vins` | OK — Autologic details |
| Inventory (สต็อก) | `inventory` | OK but `warehouse` is a free-text string |

### 1.2 Masters that are MISSING (needed for real operations)
Ranked by how much they block business logic & reporting.

| # | Master (TH) | Why it's needed | Unblocks |
|---|---|---|---|
| M1 | **Vehicle Model** รุ่นรถ (Triton, Pajero Sport, Outlander PHEV, Attrage…) + ปีรุ่น | VIN currently stores model as free text; no canonical list | Catalog model-filtering, model-level reports |
| M2 | **Part ⇄ Model compatibility** ตารางความเข้ากันได้ (many-to-many) | The #1 parity gap — `compatibleModels` doesn't exist | VIN-gated catalog actually filters correct parts |
| M3 | **Warehouse / Location** คลัง + ตำแหน่งเก็บ (bin) | `warehouse` is a string "กรุงเทพ/เชียงใหม่"; no address, no bin | Pick list, multi-WH stock, stock movement report |
| M4 | **Part Category** หมวดอะไหล่ | 6 categories are inline strings everywhere | Consistent filtering, category sales report |
| M5 | **Carrier / Shipping** ผู้ขนส่ง (Flash, SCG…) | `carrier` is free text on orders | Delivery SLA report, tracking links |
| M6 | **Supplier / Vendor** ซัพพลายเออร์ | No record of where parts are sourced | Reorder/PO-to-supplier, lead-time accuracy |
| M7 | **Price List / Tier** ราคาตามเกรดดีลเลอร์ + โปรโมชัน | One flat `unitPrice`; grade A/B/C get same price | Tiered pricing, margin reports, promotions |
| M8 | **Credit Term** เงื่อนไขเครดิต (net 30/60, วงเงิน) | Credit is just a number; no terms, no aging | AR aging, credit policy enforcement |
| M9 | **Claim Reason / Type** รหัสสาเหตุการเคลม | `reason` is free text | Defect analysis, warranty cost report |
| M10 | **Workflow / Status config** | Statuses hardcoded in `labels.ts` | Configurable pipelines (future) |
| M11 | **Tax / VAT + Currency config** | No tax handling | Invoice, tax report |
| M12 | **Province / Region** ภูมิภาค | Province is free text on dealer | Regional sales rollup |
| M13 | **Audit Log** บันทึกการเปลี่ยนแปลง | None — no who/when on status changes | Compliance, dispute resolution |
| M14 | **Notification template** เทมเพลตแจ้งเตือน | None | Email/LINE notifications |

> **Critical path:** M1 + M2 unblock the single most important parity gap (catalog
> filtering). M3 + M4 are quick normalizations that clean up reporting. M7 + M8 are the
> backbone of any real finance/margin reporting.

---

## 2. Master Reports Catalog (รายงานที่ธุรกิจต้องมี)

Grouped by audience. Each report needs: filters (date range, dealer, region, category),
on-screen view, and **export to Excel/PDF**.

### 2.1 Sales & Orders (ฝ่ายขาย / ผู้บริหาร)
| ID | Report | Key dimensions |
|---|---|---|
| R-S1 | ยอดขายตามดีลเลอร์ (Sales by Dealer) | dealer × period, ฿ + qty |
| R-S2 | ยอดขายตามอะไหล่/หมวด (Sales by Part / Category) | part, category × period |
| R-S3 | ยอดขายตามภูมิภาค/จังหวัด (Sales by Region) | province/region × period |
| R-S4 | แนวโน้มยอดขาย (Sales Trend: daily/weekly/monthly + YoY) | time series |
| R-S5 | ออเดอร์ค้าง / Aging (Open Orders Aging) | status, days-in-status |
| R-S6 | Top-N อะไหล่ขายดี / ขายช้า | rank by qty/฿ |

### 2.2 Inventory & Fulfillment (คลังสินค้า)
| ID | Report | Key dimensions |
|---|---|---|
| R-I1 | สต็อกคงเหลือต่อคลัง (Stock on Hand) | part × warehouse |
| R-I2 | สินค้าต่ำกว่าจุดสั่งซื้อ (Low-Stock / Reorder) | qtyOnHand < reorderPoint |
| R-I3 | การเคลื่อนไหวสต็อก (Stock Movement / Ledger) | in/out, reason, date |
| R-I4 | มูลค่าสินค้าคงคลัง (Inventory Valuation) | qty × cost per WH |
| R-I5 | สินค้าค้างนาน (Dead / Slow-moving Stock) | last-movement age |
| R-I6 | SLA การจัดส่ง (Fulfillment Cycle-Time) | per-status duration, carrier |

### 2.3 Credit & Finance (การเงิน)
| ID | Report | Key dimensions |
|---|---|---|
| R-F1 | การใช้วงเงินเครดิต (Credit Utilization) | creditUsed/creditLimit per dealer |
| R-F2 | ดีลเลอร์ใกล้/เกินวงเงิน (Credit Risk) | utilization > threshold |
| R-F3 | ลูกหนี้คงค้าง / AR Aging | invoice age buckets (needs M8 + payments) |

### 2.4 Warranty / Claims (ฝ่ายเคลม / คุณภาพ)
| ID | Report | Key dimensions |
|---|---|---|
| R-C1 | เคลมตามสถานะ (Claims by Status) | status × period |
| R-C2 | อัตราการเคลมตามอะไหล่ (Claim/Defect Rate by Part) | claims ÷ qty sold |
| R-C3 | เคลมตามดีลเลอร์ | dealer × period |
| R-C4 | ระยะเวลาดำเนินการเคลม (Claim Turnaround SLA) | submitted→resolved days |

### 2.5 Network / Executive (ผู้บริหารเครือข่าย)
| ID | Report | Key dimensions |
|---|---|---|
| R-N1 | สรุปดีลเลอร์ตามเกรด (Dealer Mix by Grade) | A/B/C counts, ฿ |
| R-N2 | Dealer Performance Scorecard | sales, credit, claim-rate, SLA |
| R-N3 | การติดตั้ง Autologic (Installed vs Not) | install rate, opportunity list |
| R-N4 | Executive KPI Dashboard | one-page rollup of all above |

---

## 3. Big-Picture Development Roadmap (แผนภาพใหญ่)

Six phases. Team = **1 PM (orchestrate) · 1 BA · 1 SA · 4 Dev · 2 Test**, run in waves.
Each phase ends with a green test gate before the next starts.

### Phase 0 — Foundation ✅ DONE
Clone built (8 agents, 3 waves), integrated on Postgres, 102 tests green, ~85% parity.

### Phase A — Close Parity Gaps ✅ DONE
Made the clone match the live app exactly. (14 test files / 109 tests green.)
| Task | Owner | Note | Status |
|---|---|---|---|
| Add `vehicle_models` master + `parts.compatibleModels`; filter catalog by VIN's model | SA + Dev2 | **#1 gap** | ✅ |
| Activate `t()` on all 7 pages; TH/EN parity (190 keys each) | Dev4 | i18n | ✅ |
| Server-side RBAC guard on `POST` **and** `GET /api/claims` (block sales) | Dev3 + PM | security | ✅ |
| Rename route `/fulfillment` → `/warehouse` end-to-end (page, API, nav, locales, tests) | SA | spec parity | ✅ |
| Persisted active-VIN context (`useCart` state, not just `?vin=` query) | Dev1 | robustness | ✅ |
| Regression suite (catalog filtering + claims RBAC) — `tests/server/api-phase-a.test.ts` | Test1 | gate | ✅ |

### Phase B — Master Data Layer (1–2 waves)
Normalize free-text into real masters; build CRUD admin screens.
| Task | Owner |
|---|---|
| `warehouses` (M3), `part_categories` (M4), `carriers` (M5) + FKs/migration | SA + Dev2 |
| `suppliers` (M6), `price_lists`/tiers (M7), `credit_terms` (M8) | SA + Dev2 |
| `claim_reasons` (M9), `provinces/regions` (M12), VAT/currency config (M11) | Dev3 + Dev4 |
| Admin CRUD UIs for each master + role-gated | Dev4 |
| `audit_log` table + write-hooks on status changes (M13) | Dev1 |
| Migration + seed updates + tests | Test1 |

### Phase C — Business Rules Hardening (1 wave) — ✅ CORE DONE
Turned the demo into a transactionally-correct system. (16 test files / 121 tests green.)
| Task | Owner | Status |
|---|---|---|
| **Enforce credit limit at checkout** (`creditUsed + total ≤ creditLimit`, else 409) | Dev2 | ✅ |
| **Stock decrement** on order (greedy per warehouse); block over-sell (409); restore on cancel | Dev2 + Dev3 | ✅ |
| Order **cancel + restore** flow (`POST /api/orders/:id/cancel`, dealer-scoped, pending/confirming only) | Dev3 | ✅ |
| Tiered pricing applied from price-tier master (M7): grade → discountPct | Dev2 | ✅ |
| VAT calc (appConfig `vat_rate`) + invoice number (`INV-2026-######`); `orders.subtotal/discount/vat` columns | Dev4 | ✅ |
| Concurrency-safe transactions (`db.transaction`: order + items + stock + credit atomic) | SA | ✅ |
| Edge-case + integrity tests (`tests/server/api-phase-c.test.ts`) | Test1 + Test2 | ✅ |
| Full return / RMA workflow (refund-on-approve, restocking) + admin UI | Dev3 | ✅ done — `returns`/`return_items` tables; `GET`/`POST /api/returns`, `POST /api/returns/:id/decision`, `GET /api/orders/:id`; `/returns` page (dealer request form + admin approve/reject); proportional server-side refund; approve restocks + releases credit in one txn; 9 tests |

### Phase D — Reporting & Analytics (1–2 waves) ✅ CORE DONE
Build the report suite from §2 on top of the now-clean masters.
| Task | Owner | Status |
|---|---|---|
| Reporting data layer + 15 `GET /api/reports/*` endpoints (admin-only) | SA + Dev1 | ✅ done |
| Sales reports: sales-by-dealer/category/region, open-orders-aging, top-parts | Dev2 | ✅ done |
| Inventory reports: stock-on-hand, low-stock, inventory-valuation | Dev3 | ✅ done |
| Finance: credit-utilization, credit-risk · Claims: by-status, rate-by-part, by-model | Dev3 + Dev4 | ✅ done |
| Executive: dealer-mix-by-grade, autologic-install | Dev4 | ✅ done |
| Report accuracy tests (numbers tie to source, cancelled excluded) — 19 files / 140 tests green | Test1 + Test2 | ✅ done |
| `/reports` admin page: grouped picker + summary chips + DataTable; nav entry; TH/EN locales | Dev4 | ✅ done |
| Charts (R-N* visualisations) + Excel/PDF export | Dev2 + Dev4 | ⏳ deferred |

### Phase E — Integrations & Notifications (1 wave)
| Task | Owner |
|---|---|
| Email/LINE notifications on order-status & claim events (M14 templates) | Dev1 |
| Carrier tracking integration (Flash/SCG) | Dev3 |
| Scheduled jobs: low-stock alert, credit-risk alert, daily summary | Dev2 |
| (Optional) ERP/accounting export | SA |

### Phase F — Production Hardening (1 wave)
| Task | Owner |
|---|---|
| Password hashing review, rate-limit, session security, CSRF | SA + Dev1 |
| RBAC server-guards on **every** endpoint (audit) | Test1 |
| Performance: indexes, pagination on big lists (100+ dealers, orders) | SA |
| Observability: logging, error tracking, health checks | Dev4 |
| Backup/restore, CI/CD, env config, load test | SA |
| Full E2E + security review | Test1 + Test2 |

---

## 4. Dependency Map (ลำดับสำคัญ)

```
Phase 0 ✅ ──► Phase A ──► Phase B ──► Phase C ──► Phase D ──► Phase E ──► Phase F
                 │            │            │
   catalog filter│            │ price/credit masters feed ──► credit enforce + tiered price
   needs M1/M2 ──┘            └──────────────────────────────► reports need clean masters
```

- **B before C/D:** reports & business rules depend on normalized masters (M3–M9).
- **M1/M2 can ship in Phase A** (catalog filter) ahead of the rest of B.
- **C before D:** report numbers must reflect correct credit/stock/price logic.

---

## 5. Suggested First Move
Start **Phase A** immediately (small, high-value, closes the visible gaps) and run
**M1/M2 (vehicle model + compatibility)** as the first task since it fixes the core
VIN-gating value proposition. Phase B's master layer is the foundation everything
else (rules + reports) stands on.

---

*End of ROADMAP.md*
