// POST /api/users — Phase G (User Management). Admin-only: create a user
// account. The initial password is hashed with bcrypt before storage; the hash
// is never returned. Dealer-scoped roles (owner/sales) require a dealerId;
// admin/warehouse must NOT carry one.
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import type { Role } from '../../../app/types'

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'owner', 'sales', 'warehouse']),
  dealerId: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
})

const DEALER_SCOPED: Role[] = ['owner', 'sales']

export default defineEventHandler(async (event) => {
  const admin = await requireUser(event, ['admin'])

  const body = await parseBody(event, createUserSchema)
  const email = body.email.toLowerCase()

  // Role ↔ dealer coherence (mirrors the SCAFFOLD rule: admin is NOT tied to a
  // dealer; owner/sales must be).
  const dealerScoped = DEALER_SCOPED.includes(body.role)
  if (dealerScoped && body.dealerId == null) {
    throw createError({ statusCode: 400, statusMessage: 'บทบาทนี้ต้องระบุดีลเลอร์' })
  }
  if (!dealerScoped && body.dealerId != null) {
    throw createError({ statusCode: 400, statusMessage: 'บทบาทนี้ต้องไม่ผูกกับดีลเลอร์' })
  }

  // Unique email.
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'อีเมลนี้ถูกใช้งานแล้ว' })
  }

  // Validate the dealer exists when supplied.
  if (body.dealerId != null) {
    const dealer = await db.query.dealers.findFirst({ where: eq(schema.dealers.id, body.dealerId) })
    if (!dealer) {
      throw createError({ statusCode: 400, statusMessage: 'ไม่พบดีลเลอร์ที่ระบุ' })
    }
  }

  const passwordHash = await bcrypt.hash(body.password, 10)

  const [created] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash,
      role: body.role,
      dealerId: body.dealerId ?? null,
      active: body.active ?? true,
      createdAt: new Date().toISOString(),
    })
    .returning()

  await writeAudit(admin.id, 'user.create', 'user', String(created!.id), `email=${email} role=${body.role}`)

  // Never leak the hash.
  return {
    ok: true,
    user: {
      id: created!.id,
      email: created!.email,
      role: created!.role,
      dealerId: created!.dealerId,
      active: created!.active,
      createdAt: created!.createdAt,
    },
  }
})
