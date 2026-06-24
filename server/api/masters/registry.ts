// ============================================================================
// Master-data registry — Phase B Wave 2 (Dev: Master Data management).
// ----------------------------------------------------------------------------
// A single whitelist mapping `entity name → { drizzle table, Zod create/update
// schemas, editability }`. The generic CRUD routes under server/api/masters/
// resolve every request through this map; unknown names are rejected with 404,
// so there is no way to reach a table that isn't explicitly registered here.
//
// Validation columns mirror server/db/schema.ts exactly. Update schemas are the
// create schema made `.partial()` so PUT can patch a subset of fields.
// ============================================================================
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import type { PgTableWithColumns } from 'drizzle-orm/pg-core'

// Some masters are derived/canonical reference data that the seed owns; we
// expose them read-only in the UI (still creatable via API is not desired, so
// `editable: false` also blocks POST/PUT/DELETE at the route layer).
export interface MasterDef {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTableWithColumns<any>
  create: z.ZodTypeAny
  update: z.ZodTypeAny
  editable: boolean
  // Column used for the default sort (all masters have a stable text key).
  sortKey: string
  // Optional: augment the validated body before INSERT (e.g. inject a server
  // timestamp or a system-managed default the UI must not set). Returns the
  // full row to insert.
  prepareCreate?: (values: Record<string, unknown>) => Record<string, unknown>
  // Optional: block a DELETE when the row is still referenced (FK safety).
  // Throw a createError() to reject; resolve to allow.
  assertDeletable?: (id: number) => Promise<void>
}

const code = z.string().trim().min(1).max(64)
const name = z.string().trim().min(1).max(200)

// ---- per-entity create schemas (mirror schema.ts) --------------------------
const warehousesCreate = z.object({
  code,
  name,
  province: z.string().trim().max(120).nullish(),
})

const partCategoriesCreate = z.object({
  code,
  nameTh: name,
})

const carriersCreate = z.object({
  code,
  name,
})

const suppliersCreate = z.object({
  code,
  name,
  leadTimeDays: z.number().int().min(0).default(0),
  contact: z.string().trim().max(200).nullish(),
})

const creditTermsCreate = z.object({
  code,
  days: z.number().int().min(0),
  nameTh: name,
})

const priceTiersCreate = z.object({
  grade: z.string().trim().min(1).max(8),
  discountPct: z.number().int().min(0).max(100),
  nameTh: z.string().trim().max(200).nullish(),
})

const claimReasonsCreate = z.object({
  code,
  nameTh: name,
})

const provincesCreate = z.object({
  name,
  region: z.string().trim().min(1).max(60),
})

const appConfigCreate = z.object({
  key: code,
  value: z.string().max(2000),
})

const vehicleModelsCreate = z.object({
  name,
  active: z.boolean().default(true),
})

// Dealers are master data and credit (limit/grade) hangs off them, so they are
// fully editable here. `creditUsed` is system-managed (accumulated by orders/
// payments) and `createdAt` is server-stamped — neither is accepted from the
// client; both are injected in prepareCreate. `creditTermId` stays null (the
// text `grade` is the source of truth for tiering).
const dealersCreate = z.object({
  code,
  name,
  province: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  grade: z.enum(['A', 'B', 'C']),
  creditLimit: z.number().int().min(0),
})

// Phase M — parts master incl. model compatibility (empty array = universal).
const partsCreate = z.object({
  sku: code,
  name,
  category: z.string().trim().min(1).max(60),
  oem: z.boolean().default(true),
  warrantyMonths: z.number().int().min(0).default(0),
  leadTimeDays: z.number().int().min(0).default(0),
  price: z.number().int().min(0),
  compatibleModels: z.array(z.string().trim().min(1)).default([]),
  supplierId: z.number().int().positive().nullish(),
})

const claimResolutionsCreate = z.object({
  code,
  nameTh: name,
  refundable: z.boolean().default(false),
  active: z.boolean().default(true),
})

const autologicDevicesCreate = z.object({
  sku: code,
  name,
  description: z.string().trim().max(500).nullish(),
  price: z.number().int().min(0).default(0),
  compatibleModels: z.array(z.string().trim().min(1)).default([]),
  active: z.boolean().default(true),
})

export const MASTERS: Record<string, MasterDef> = {
  // ---- operational masters (full CRUD) ----
  suppliers: {
    table: schema.suppliers,
    create: suppliersCreate,
    update: suppliersCreate.partial(),
    editable: true,
    sortKey: 'code',
  },
  carriers: {
    table: schema.carriers,
    create: carriersCreate,
    update: carriersCreate.partial(),
    editable: true,
    sortKey: 'code',
  },
  creditTerms: {
    table: schema.creditTerms,
    create: creditTermsCreate,
    update: creditTermsCreate.partial(),
    editable: true,
    sortKey: 'code',
  },
  claimReasons: {
    table: schema.claimReasons,
    create: claimReasonsCreate,
    update: claimReasonsCreate.partial(),
    editable: true,
    sortKey: 'code',
  },
  priceTiers: {
    table: schema.priceTiers,
    create: priceTiersCreate,
    update: priceTiersCreate.partial(),
    editable: true,
    sortKey: 'grade',
  },
  appConfig: {
    table: schema.appConfig,
    create: appConfigCreate,
    update: appConfigCreate.partial(),
    editable: true,
    sortKey: 'key',
  },
  dealers: {
    table: schema.dealers,
    create: dealersCreate,
    update: dealersCreate.partial(),
    editable: true,
    sortKey: 'code',
    // Stamp createdAt + start creditUsed at 0; the client can set neither.
    prepareCreate: (v) => ({ ...v, creditUsed: 0, createdAt: new Date().toISOString() }),
    // Don't orphan orders/users: refuse delete while either still points here.
    assertDeletable: async (id) => {
      const order = await db.query.orders.findFirst({ where: eq(schema.orders.dealerId, id) })
      if (order) {
        throw createError({
          statusCode: 409,
          statusMessage: 'ลบไม่ได้: ดีลเลอร์นี้มีคำสั่งซื้อผูกอยู่',
        })
      }
      const user = await db.query.users.findFirst({ where: eq(schema.users.dealerId, id) })
      if (user) {
        throw createError({
          statusCode: 409,
          statusMessage: 'ลบไม่ได้: ดีลเลอร์นี้มีผู้ใช้ผูกอยู่',
        })
      }
    },
  },

  // ---- derived / canonical reference data (read-only) ----
  warehouses: {
    table: schema.warehouses,
    create: warehousesCreate,
    update: warehousesCreate.partial(),
    editable: false,
    sortKey: 'code',
  },
  partCategories: {
    table: schema.partCategories,
    create: partCategoriesCreate,
    update: partCategoriesCreate.partial(),
    editable: false,
    sortKey: 'code',
  },
  provinces: {
    table: schema.provinces,
    create: provincesCreate,
    update: provincesCreate.partial(),
    editable: false,
    sortKey: 'name',
  },
  vehicleModels: {
    table: schema.vehicleModels,
    create: vehicleModelsCreate,
    update: vehicleModelsCreate.partial(),
    editable: true,
    sortKey: 'name',
  },
  // ---- Phase M masters ----
  parts: {
    table: schema.parts,
    create: partsCreate,
    update: partsCreate.partial(),
    editable: true,
    sortKey: 'sku',
  },
  claimResolutions: {
    table: schema.claimResolutions,
    create: claimResolutionsCreate,
    update: claimResolutionsCreate.partial(),
    editable: true,
    sortKey: 'code',
  },
  autologicDevices: {
    table: schema.autologicDevices,
    create: autologicDevicesCreate,
    update: autologicDevicesCreate.partial(),
    editable: true,
    sortKey: 'sku',
  },
}

export type MasterEntity = keyof typeof MASTERS

/** Resolve a registered master or throw a 404 for unknown entity names. */
export function getMaster(entity: string): MasterDef {
  const def = MASTERS[entity as MasterEntity]
  if (!def) {
    throw createError({ statusCode: 404, statusMessage: `ไม่พบชนิดข้อมูล: ${entity}` })
  }
  return def
}

/** The create-schema field keys for a master (used to build import templates). */
export function masterColumns(def: MasterDef): string[] {
  // Zod v3 ZodObject exposes `.shape`; guard in case a schema isn't an object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (def.create as any)?.shape as Record<string, unknown> | undefined
  return shape ? Object.keys(shape) : []
}

/** Guard mutating routes: derived masters are read-only. */
export function assertEditable(entity: string, def: MasterDef): void {
  if (!def.editable) {
    throw createError({
      statusCode: 403,
      statusMessage: `ข้อมูล ${entity} เป็นแบบอ่านอย่างเดียว`,
    })
  }
}
