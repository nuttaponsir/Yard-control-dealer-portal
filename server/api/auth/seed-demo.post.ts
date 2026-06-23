// POST /api/auth/seed-demo — Dev1 owns.
// Create/refresh the 4 demo users + base dataset. Wired to the "สร้าง/รีเฟรช
// ข้อมูลตัวอย่าง" button on /auth. Re-runs the full idempotent seed.
//
// Phase F hardening: this endpoint reseeds the ENTIRE database and is
// unauthenticated by design (you need data before you can log in). That makes
// it destructive, so it is disabled in production by default — seeding a prod
// box is normally an ops task (`npm run db:seed`), never a public HTTP call.
//
// EXCEPTION for hosted demo/trial instances (so others can try the app without
// shell access to run the ops seed): set ALLOW_DEMO_SEED=true on that instance
// to re-enable it. The data is throwaway; turn the flag off again once seeded.
import { seedDatabase } from '../../db/seed-data'
import { isProduction } from '../../utils/runtime'

export default defineEventHandler(async () => {
  const demoSeedAllowed = process.env.ALLOW_DEMO_SEED === 'true'
  if (isProduction() && !demoSeedAllowed) {
    throw createError({ statusCode: 403, statusMessage: 'Demo seeding is disabled in production' })
  }
  const result = await seedDatabase()
  return { ok: true, ...result }
})
