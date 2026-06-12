// PUT /api/users/:id — Phase G (User Management). Admin-only: edit a user's
// email / role / dealer / active flag. Password is NOT changed here (use the
// reset-password route). Guards against an admin locking themselves out.
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import type { Role } from '../../../app/types'

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['admin', 'owner', 'sales', 'warehouse']).optional(),
  dealerId: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
})

const DEALER_SCOPED: Role[] = ['owner', 'sales']

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

  const body = await parseBody(event, updateUserSchema)

  // Resolve the post-update role + dealer to validate coherence as a unit.
  const nextRole = (body.role ?? target.role) as Role
  const nextDealerId = body.dealerId !== undefined ? body.dealerId : target.dealerId
  const dealerScoped = DEALER_SCOPED.includes(nextRole)
  if (dealerScoped && nextDealerId == null) {
    throw createError({ statusCode: 400, statusMessage: 'บทบาทนี้ต้องระบุดีลเลอร์' })
  }
  if (!dealerScoped && nextDealerId != null) {
    throw createError({ statusCode: 400, statusMessage: 'บทบาทนี้ต้องไม่ผูกกับดีลเลอร์' })
  }

  // Lock-out guards: an admin cannot demote or deactivate their own account.
  if (id === admin.id) {
    if (body.active === false) {
      throw createError({ statusCode: 409, statusMessage: 'ไม่สามารถระงับบัญชีของตนเองได้' })
    }
    if (body.role && body.role !== 'admin') {
      throw createError({ statusCode: 409, statusMessage: 'ไม่สามารถลดสิทธิ์บัญชีของตนเองได้' })
    }
  }

  // Unique email when changing it.
  if (body.email) {
    const email = body.email.toLowerCase()
    if (email !== target.email) {
      const clash = await db.query.users.findFirst({ where: eq(schema.users.email, email) })
      if (clash) {
        throw createError({ statusCode: 409, statusMessage: 'อีเมลนี้ถูกใช้งานแล้ว' })
      }
    }
  }

  // Validate the dealer exists when set.
  if (nextDealerId != null) {
    const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, nextDealerId) })
    if (!dealer) {
      throw createError({ statusCode: 400, statusMessage: 'ไม่พบดีลเลอร์ที่ระบุ' })
    }
  }

  const patch: Partial<typeof schema.users.$inferInsert> = {}
  if (body.email) patch.email = body.email.toLowerCase()
  if (body.role) patch.role = body.role
  if (body.dealerId !== undefined || body.role) patch.dealerId = nextDealerId
  if (body.active !== undefined) patch.active = body.active

  const [updated] = await db
    .update(schema.users)
    .set(patch)
    .where(eq(schema.users.id, id))
    .returning()

  await writeAudit(admin.id, 'user.update', 'user', String(id), JSON.stringify(patch))

  return {
    ok: true,
    user: {
      id: updated!.id,
      email: updated!.email,
      role: updated!.role,
      dealerId: updated!.dealerId,
      active: updated!.active,
      createdAt: updated!.createdAt,
    },
  }
})
