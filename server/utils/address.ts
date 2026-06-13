// ============================================================================
// Phase 2 — dealer address helpers (bill-to / ship-to address book + geo).
// ----------------------------------------------------------------------------
// Shared by the /api/addresses CRUD routes and the order-placement guard.
// Kept in server/utils (NOT under api/) so it is not treated as a Nitro route.
// ============================================================================
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { db, schema } from '../db'
import type { SessionUser } from '../../app/types'

// The transaction object handed to a db.transaction(callback) — derived so the
// helper accepts both the top-level db and an in-flight tx without `any`.
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const ADDRESS_KINDS = ['billing', 'shipping', 'both'] as const

// lat/lng are optional but, when present, must be valid WGS-84 ranges.
const latSchema = z.number().min(-90).max(90)
const lngSchema = z.number().min(-180).max(180)

export const addressCreateSchema = z.object({
  // admin may target any dealer; for owner/sales this is ignored and forced to
  // their own dealerId in the route.
  dealerId: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(ADDRESS_KINDS).default('both'),
  line1: z.string().trim().min(1).max(300),
  subDistrict: z.string().trim().max(120).nullish(),
  district: z.string().trim().max(120).nullish(),
  province: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().max(20).nullish(),
  country: z.string().trim().min(2).max(2).default('TH'),
  lat: latSchema.nullish(),
  lng: lngSchema.nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  isDefaultBilling: z.boolean().default(false),
  isDefaultShipping: z.boolean().default(false),
})

// Partial update: every field optional, but at least one must be present.
export const addressUpdateSchema = addressCreateSchema
  .omit({ dealerId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'ไม่มีข้อมูลที่จะแก้ไข' })

export type AddressCreateInput = z.infer<typeof addressCreateSchema>
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>

/**
 * Resolve which dealer a write targets, enforcing scope:
 *   • owner/sales — always their own dealer (any body.dealerId is ignored).
 *   • admin       — must specify a dealerId (network-wide, no implicit dealer).
 * Throws 403/400 on violation.
 */
export function resolveDealerId(user: SessionUser, bodyDealerId?: number): number {
  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null
  if (scoped) return user.dealerId as number
  if (user.role === 'admin') {
    if (bodyDealerId == null) {
      throw createError({ statusCode: 400, statusMessage: 'ต้องระบุดีลเลอร์ (dealerId)' })
    }
    return bodyDealerId
  }
  // warehouse or unbound owner/sales — no dealer context to write addresses for.
  throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่มีสิทธิ์จัดการที่อยู่ดีลเลอร์' })
}

/**
 * Guard a single-address read/write. owner/sales may only touch rows of their
 * own dealer; admin may touch any. warehouse is rejected. Throws 403 on
 * cross-dealer access.
 */
export function assertAddressAccess(user: SessionUser, addrDealerId: number): void {
  const scoped = (user.role === 'owner' || user.role === 'sales') && user.dealerId != null
  if (scoped) {
    if (addrDealerId !== user.dealerId) {
      throw createError({ statusCode: 403, statusMessage: 'ไม่มีสิทธิ์เข้าถึงที่อยู่นี้' })
    }
    return
  }
  if (user.role === 'admin') return
  throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ไม่มีสิทธิ์จัดการที่อยู่ดีลเลอร์' })
}

/**
 * Within a transaction, ensure a dealer has at most one default-billing and one
 * default-shipping address: clear the matching flag on every OTHER row of the
 * same dealer before the new/updated row becomes the default. `keepId` is the
 * row that is allowed to keep the flag (the one being written), or null on create.
 */
export async function clearDefaultFlags(
  tx: DbTx,
  dealerId: number,
  opts: { billing?: boolean; shipping?: boolean; keepId?: number | null },
): Promise<void> {
  const keepId = opts.keepId ?? null
  const others = keepId
    ? and(eq(schema.dealerAddresses.dealerId, dealerId), ne(schema.dealerAddresses.id, keepId))
    : eq(schema.dealerAddresses.dealerId, dealerId)

  if (opts.billing) {
    await tx.update(schema.dealerAddresses).set({ isDefaultBilling: false }).where(others)
  }
  if (opts.shipping) {
    await tx.update(schema.dealerAddresses).set({ isDefaultShipping: false }).where(others)
  }
}
