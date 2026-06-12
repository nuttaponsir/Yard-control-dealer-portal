// ============================================================================
// Mitsubishi Dealer Portal — runtime environment helpers (Phase F hardening)
// ----------------------------------------------------------------------------
// Single source of truth for "are we in production?" so security gates
// (seed-demo lockout, secure cookies, HSTS, secret guard) all agree.
// ============================================================================

/** True only for a real production deployment (NODE_ENV=production). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** The dev fallback session secret shipped in nuxt.config — never safe in prod. */
export const DEV_SESSION_SECRET = 'dev-mitsubishi-dealer-portal-secret-change-me'
