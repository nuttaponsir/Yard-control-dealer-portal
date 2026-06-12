// ============================================================================
// Nitro startup guard (Phase F hardening) — runs once when the server boots.
// ----------------------------------------------------------------------------
// Refuses to start a PRODUCTION server that is still using the dev session
// secret. Shipping the public default secret would let anyone forge sessions,
// so we fail fast and loud rather than booting an insecure box. In dev/test we
// only warn, so local work and the test harness are unaffected.
// ============================================================================
import { DEV_SESSION_SECRET, isProduction } from '../utils/runtime'

export default defineNitroPlugin(() => {
  const secret = useRuntimeConfig().sessionSecret

  if (isProduction() && (!secret || secret === DEV_SESSION_SECRET)) {
    throw new Error(
      '[security] Refusing to start: NUXT_SESSION_SECRET is unset or still the dev default. ' +
        'Set a strong, unique NUXT_SESSION_SECRET in production.',
    )
  }

  if (!isProduction() && secret === DEV_SESSION_SECRET) {
    console.warn(
      '[security] Using the built-in dev session secret. Override NUXT_SESSION_SECRET before deploying.',
    )
  }
})
