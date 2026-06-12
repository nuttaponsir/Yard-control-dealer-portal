// GET /api/auth/me — Dev1 owns. Returns the current session user or null.
import { getUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  return { user: await getUser(event) }
})
