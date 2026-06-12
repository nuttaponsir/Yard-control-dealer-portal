// POST /api/users/:id/reset-password — Phase G (User Management). Admin-only:
// set a new password for a user. The new password is bcrypt-hashed; the hash is
// never returned. Existing sessions are revoked so the old password can't ride
// on a live cookie.
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { writeAudit } from '../../../utils/audit'

const resetSchema = z.object({
  password: z.string().min(8),
})

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['admin'])

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'รหัสผู้ใช้ไม่ถูกต้อง' })
  }

  const target = await db.query.users.findFirst({ where: eq(schema.users.id, id) })
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบผู้ใช้งาน' })
  }

  const { password } = await parseBody(event, resetSchema)
  const passwordHash = await bcrypt.hash(password, 10)

  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, id))
    // Revoke the target's active sessions (skip the admin's own if resetting self).
    if (id !== admin.id) {
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id))
    }
  })

  await writeAudit(admin.id, 'user.reset_password', 'user', String(id), `email=${target.email}`)

  return { ok: true }
})
