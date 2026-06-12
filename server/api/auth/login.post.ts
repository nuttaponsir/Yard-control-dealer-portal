// POST /api/auth/login — Dev1 owns. Reference Zod-validated endpoint.
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { loginSchema, parseBody } from '../../utils/validation'
import { createSession } from '../../utils/auth'
import { checkRateLimit, clearRateLimit, recordFailure } from '../../utils/rate-limit'
import type { Role, SessionUser } from '../../../app/types'

// Phase F: brute-force throttle. Up to 8 failed attempts per IP+email within a
// 15-minute window; the 9th is rejected with 429 until the window resets.
// Successful logins clear the counter, so normal use is never throttled.
const LOGIN_MAX_FAILURES = 8
const LOGIN_WINDOW_MS = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
  const { email, password } = await parseBody(event, loginSchema)

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const rlKey = `login:${ip}:${email.toLowerCase()}`

  const limited = checkRateLimit(rlKey, LOGIN_MAX_FAILURES)
  if (limited.blocked) {
    setResponseHeader(event, 'Retry-After', limited.retryAfter)
    throw createError({
      statusCode: 429,
      statusMessage: 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่',
    })
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email.toLowerCase()),
  })
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    recordFailure(rlKey, LOGIN_WINDOW_MS)
    throw createError({ statusCode: 401, statusMessage: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' })
  }

  // Phase G: a deactivated account authenticates but is denied entry. Counts as
  // a failure for rate-limiting; never reveals whether the password was right.
  if (user.active === false) {
    recordFailure(rlKey, LOGIN_WINDOW_MS)
    throw createError({ statusCode: 403, statusMessage: 'บัญชีนี้ถูกระงับการใช้งาน' })
  }

  clearRateLimit(rlKey)
  await createSession(event, user.id)

  // Resolve the session user from the just-authenticated record. We cannot rely
  // on getUser(event) here because the session cookie is only set on the
  // *response* of this request and is not yet readable from the request.
  let dealerName: string | null = null
  if (user.dealerId != null) {
    const dealer = await db.query.dealers.findFirst({
      where: eq(schema.dealers.id, user.dealerId),
    })
    dealerName = dealer?.name ?? null
  }
  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    dealerId: user.dealerId ?? null,
    dealerName,
  }
  return { user: sessionUser }
})
