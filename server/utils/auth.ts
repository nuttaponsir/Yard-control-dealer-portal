// ============================================================================
// Mitsubishi Dealer Portal — server auth helpers
// ----------------------------------------------------------------------------
// SHARED FILE — owned by the SA / Dev1. Session-based auth backed by a DB
// `sessions` table; the session id lives in an httpOnly cookie. Use
// `requireUser(event, roles?)` at the top of any protected API route.
// ============================================================================
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { isProduction } from './runtime'
import type { Role, SessionUser } from '../../app/types'

const COOKIE = 'dp_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

export async function createSession(event: import('h3').H3Event, userId: number) {
  const id = randomUUID()
  const now = Date.now()
  await db.insert(schema.sessions).values({
    id,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
  })
  setCookie(event, COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    // Phase F: only send the cookie over HTTPS in production. Left off in
    // dev/test so http://localhost and the test harness keep working.
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function destroySession(event: import('h3').H3Event) {
  const id = getCookie(event, COOKIE)
  if (id) await db.delete(schema.sessions).where(eq(schema.sessions.id, id))
  deleteCookie(event, COOKIE, { path: '/' })
}

/** Resolve the current user from the session cookie, or null. */
export async function getUser(event: import('h3').H3Event): Promise<SessionUser | null> {
  const sid = getCookie(event, COOKIE)
  if (!sid) return null
  const sess = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sid),
  })
  if (!sess) return null

  // Phase F: enforce server-side expiry. Expired sessions are deleted and
  // treated as logged-out, regardless of the cookie's own maxAge.
  if (sess.expiresAt && Date.parse(sess.expiresAt) <= Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sid))
    deleteCookie(event, COOKIE, { path: '/' })
    return null
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, sess.userId),
  })
  if (!user) return null

  let dealerName: string | null = null
  if (user.dealerId != null) {
    const dealer = await db.query.dealers.findFirst({
      where: eq(schema.dealers.id, user.dealerId),
    })
    dealerName = dealer?.name ?? null
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    dealerId: user.dealerId ?? null,
    dealerName,
  }
}

/**
 * Require an authenticated user; optionally restrict to roles.
 * Throws 401 when not logged in, 403 when role is not allowed.
 */
export async function requireUser(
  event: import('h3').H3Event,
  roles?: Role[],
): Promise<SessionUser> {
  const user = await getUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  if (roles && roles.length && !roles.includes(user.role)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
  return user
}
