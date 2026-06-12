// ============================================================================
// Security response headers (Phase F hardening) — applied to every response.
// ----------------------------------------------------------------------------
// Conservative defaults that don't break the SSR app:
//   • nosniff / frame deny / referrer + permissions policy on all responses
//   • HSTS only in production (avoids poisoning http://localhost during dev)
//   • CSP allows 'unsafe-inline' for styles/scripts because Nuxt+Tailwind inject
//     inline style/hydration; tightening to nonces is a follow-up if needed.
// ============================================================================
import { isProduction } from '../utils/runtime'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response) => {
    response.headers = response.headers || {}
    const h = response.headers as Record<string, string>
    h['X-Content-Type-Options'] = 'nosniff'
    h['X-Frame-Options'] = 'DENY'
    h['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    h['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    h['Content-Security-Policy'] = CSP
    if (isProduction()) {
      h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    }
  })
})
