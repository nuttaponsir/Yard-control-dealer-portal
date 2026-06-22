// GET /api/brand — public (no auth). Returns the configurable brand logo so the
// sidebar AND the pre-auth login page can render it. Empty logoUrl → the client
// falls back to the built-in JWD wordmark.
import { getConfig } from '../utils/config'

export default defineEventHandler(async () => {
  const logoUrl = (await getConfig('brand_logo_url')).trim()
  return { logoUrl: logoUrl || null }
})
