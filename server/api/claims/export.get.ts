// GET /api/claims/export — download the recent-claims list as .xlsx.
// Mirrors the RBAC of GET /api/claims (admin/owner/warehouse). One row per claim.
import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { buildXlsx, sendXlsx, type XlsxColumn } from '../../utils/xlsx'
import type { Claim } from '../../../app/types'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin', 'owner', 'warehouse'])

  const claims = (await db
    .select()
    .from(schema.claims)
    .orderBy(desc(schema.claims.createdAt))) as Claim[]

  const partRows = await db
    .select({ sku: schema.parts.sku, name: schema.parts.name })
    .from(schema.parts)
  const nameBySku = new Map(partRows.map((p) => [p.sku, p.name]))

  const rows = claims.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    vin: c.vin,
    partSku: c.partSku,
    partName: nameBySku.get(c.partSku) ?? c.partSku,
    reason: c.reason,
    status: c.status,
    amount: c.amount,
    createdAt: c.createdAt,
  }))

  const columns: XlsxColumn[] = [
    { key: 'id' },
    { key: 'claimNumber' },
    { key: 'vin' },
    { key: 'partSku' },
    { key: 'partName' },
    { key: 'reason' },
    { key: 'status' },
    { key: 'amount' },
    { key: 'createdAt' },
  ]

  const buf = await buildXlsx(columns, rows, 'claims')
  return sendXlsx(event, buf, `claims-${new Date().toISOString().slice(0, 10)}.xlsx`)
})
