// GET /api/health — Phase F. Unauthenticated liveness/readiness probe for
// load balancers and uptime monitors. Pings the database; reports 200 when the
// DB answers, 503 when it does not. No sensitive data is exposed.
import { sql } from 'drizzle-orm'
import { db } from '../db'

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  let database: 'up' | 'down'
  try {
    await db.execute(sql`select 1`)
    database = 'up'
  } catch {
    database = 'down'
  }

  const ok = database === 'up'
  if (!ok) setResponseStatus(event, 503)

  return {
    status: ok ? 'ok' : 'degraded',
    database,
    uptime: Math.round(process.uptime()),
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString(),
  }
})
