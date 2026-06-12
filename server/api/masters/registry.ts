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
import { schema } from '../../db'
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
    editable: false,
    sortKey: 'name',
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

/** Guard mutating routes: derived masters are read-only. */
export function assertEditable(entity: string, def: MasterDef): void {
  if (!def.editable) {
    throw createError({
      statusCode: 403,
      statusMessage: `ข้อมูล ${entity} เป็นแบบอ่านอย่างเดียว`,
    })
  }
}
