import { readFileSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit does not auto-load .env — read it ourselves (no extra dep).
function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(new URL('./.env', import.meta.url), 'utf8')
    const m = env.match(/^DATABASE_URL=(.*)$/m)
    if (m) return m[1]!.trim()
  } catch {
    /* ignore */
  }
  return 'postgres://dealerportal:dealerportal@localhost:5434/dealerportal'
}

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: dbUrl() },
  strict: true,
  verbose: true,
})
