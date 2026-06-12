// ============================================================================
// Programmatic migration runner (deployment) — applies every pending migration
// in server/db/migrations against DATABASE_URL, then exits.
// ----------------------------------------------------------------------------
// Pure ESM (no TypeScript / no tsx) so the production container runs it with
// stock `node`. This is what runs on container boot and via `npm run db:deploy`.
// It uses a dedicated short-lived connection (max: 1) and tracks applied
// migrations in drizzle's __drizzle_migrations journal, so it is safe to run on
// every deploy — already-applied migrations are skipped.
// ============================================================================
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://dealerportal:dealerportal@localhost:5434/dealerportal'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

const sql = postgres(connectionString, { max: 1 })
try {
  const db = drizzle(sql)
  console.log('[migrate] applying migrations from', migrationsFolder)
  await migrate(db, { migrationsFolder })
  console.log('[migrate] done — database is up to date')
} catch (err) {
  console.error('[migrate] failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
