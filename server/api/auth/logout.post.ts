// POST /api/auth/logout — Dev1 owns.
import { destroySession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await destroySession(event)
  return { ok: true }
})
