// GET /api/reports/open-orders-aging (R-S5) — Dev2, Phase D.
// Admin-only. Aging report for open orders (status pending|confirming|packing).
// Bucketed by days-open; rows sorted by daysOpen desc.
import { db } from '../../db'
import { requireUser } from '../../utils/auth'

interface AgingBucket {
  bucket: string
  count: number
  value: number
}

interface AgingRow {
  id: number
  poNumber: string
  status: string
  daysOpen: number
  totalValue: number
}

const OPEN_STATUSES = new Set(['pending', 'confirming', 'packing'])
const BUCKET_ORDER = ['0-3', '4-7', '8-14', '15+'] as const

function bucketFor(daysOpen: number): string {
  if (daysOpen <= 3) return '0-3'
  if (daysOpen <= 7) return '4-7'
  if (daysOpen <= 14) return '8-14'
  return '15+'
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  void user

  const orderRows = await db.query.orders.findMany()
  const now = Date.now()

  const rows: AgingRow[] = []
  const bucketAgg = new Map<string, { count: number; value: number }>()
  for (const b of BUCKET_ORDER) bucketAgg.set(b, { count: 0, value: 0 })

  for (const o of orderRows) {
    if (!OPEN_STATUSES.has(o.status)) continue
    const daysOpen = Math.floor((now - Date.parse(o.createdAt)) / 86400000)
    const b = bucketFor(daysOpen)
    const cur = bucketAgg.get(b)!
    cur.count += 1
    cur.value += o.totalValue
    rows.push({
      id: o.id,
      poNumber: o.poNumber,
      status: o.status,
      daysOpen,
      totalValue: o.totalValue,
    })
  }

  rows.sort((a, b) => b.daysOpen - a.daysOpen)

  const buckets: AgingBucket[] = BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: bucketAgg.get(bucket)!.count,
    value: bucketAgg.get(bucket)!.value,
  }))

  return { buckets, rows }
})
