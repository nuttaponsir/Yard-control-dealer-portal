import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://dealerportal:dealerportal@localhost:5434/dealerportal'

// Cache the client/db on globalThis so Nitro HMR doesn't open a new pool on
// every reload (avoids "too many connections" during development).
const g = globalThis as unknown as {
  __dpSql?: ReturnType<typeof postgres>
  __dpDb?: ReturnType<typeof drizzle<typeof schema>>
}

const sql = g.__dpSql ?? postgres(connectionString, { max: 10 })
if (!g.__dpSql) g.__dpSql = sql

export const db = g.__dpDb ?? drizzle(sql, { schema })
if (!g.__dpDb) g.__dpDb = db

export { schema }
