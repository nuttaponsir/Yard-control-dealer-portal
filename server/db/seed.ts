// ============================================================================
// Mitsubishi Dealer Portal — CLI seed entrypoint
// Run with: npm run db:seed  (after `npm run db:up` + `npm run db:push`)
// ============================================================================
import { seedDatabase } from './seed-data'

seedDatabase()
  .then((r) => {
    console.log(
      `Seeded: ${r.dealers} dealers, ${r.users} demo users, ${r.orders} orders.`,
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
