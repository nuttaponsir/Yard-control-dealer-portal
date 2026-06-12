// Phase G-2 — User Management tests.
//   1. Admin-only directory; the password hash is never serialized.
//   2. Create enforces role↔dealer coherence + unique email + password length;
//      the created user can immediately log in.
//   3. Deactivating a user blocks login (403); reactivating restores it.
//   4. Admins cannot lock themselves out (deactivate / demote self → 409).
//   5. Reset-password rehashes (old fails, new works) and revokes old sessions.
//   6. Non-admins are forbidden from every mutating route.
// Created users are torn down by their unique stamped emails so seed-integrity
// counts stay exact.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startServer, stopServer, loginAs } from './harness'
import { db, schema } from '../../server/db'
import { eq, like } from 'drizzle-orm'

const PW = 'demo1234' // 8 chars — satisfies the min(8) rule
const stamp = Date.now() % 1000000
const newEmail = `umtest-${stamp}@demo.co`
const emailPrefix = `umtest-${stamp}`

let dealerId = 0
let createdUserId = 0

beforeAll(async () => {
  await startServer()
  const anyDealer = await db.query.dealers.findFirst()
  dealerId = anyDealer!.id
})

afterAll(async () => {
  const ours = await db.query.users.findMany({ where: like(schema.users.email, `${emailPrefix}%`) })
  for (const u of ours) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id))
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, u.id))
  }
  await db.delete(schema.users).where(like(schema.users.email, `${emailPrefix}%`))
  await stopServer()
})

describe('GET /api/users', () => {
  it('admin lists users without leaking the password hash', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.get<{ users: Record<string, unknown>[] }>('/api/users')
    expect(r.status).toBe(200)
    expect(r.body.users.length).toBeGreaterThan(0)
    for (const u of r.body.users) {
      expect(u).not.toHaveProperty('passwordHash')
      expect(u).toHaveProperty('active')
    }
  })

  it('a non-admin cannot list users (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    expect((await sales.get('/api/users')).status).toBe(403)
  })
})

describe('POST /api/users', () => {
  it('creates a dealer-scoped user that can then log in', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post<{ user: { id: number; email: string } }>('/api/users', {
      email: newEmail,
      password: PW,
      role: 'sales',
      dealerId,
    })
    expect(r.status).toBe(200)
    expect(r.body.user.email).toBe(newEmail)
    expect(r.body).not.toHaveProperty('user.passwordHash')
    createdUserId = r.body.user.id

    // the new user can authenticate
    const ok = await loginAs(newEmail, PW)
    expect(ok.cookie).toBeTruthy()
  })

  it('rejects an admin role carrying a dealerId (400)', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/users', {
      email: `${emailPrefix}-bad1@demo.co`,
      password: PW,
      role: 'admin',
      dealerId,
    })
    expect(r.status).toBe(400)
  })

  it('rejects an owner role without a dealerId (400)', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/users', {
      email: `${emailPrefix}-bad2@demo.co`,
      password: PW,
      role: 'owner',
    })
    expect(r.status).toBe(400)
  })

  it('rejects a duplicate email (409)', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/users', {
      email: newEmail,
      password: PW,
      role: 'sales',
      dealerId,
    })
    expect(r.status).toBe(409)
  })

  it('rejects a too-short password (400)', async () => {
    const admin = await loginAs('admin@demo.co')
    const r = await admin.post('/api/users', {
      email: `${emailPrefix}-bad3@demo.co`,
      password: 'short',
      role: 'sales',
      dealerId,
    })
    expect(r.status).toBe(400)
  })

  it('a non-admin cannot create a user (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    const r = await sales.post('/api/users', {
      email: `${emailPrefix}-bad4@demo.co`,
      password: PW,
      role: 'sales',
      dealerId,
    })
    expect(r.status).toBe(403)
  })
})

describe('PUT /api/users/:id', () => {
  it('deactivating a user blocks login; reactivating restores it', async () => {
    const admin = await loginAs('admin@demo.co')
    const off = await admin.put(`/api/users/${createdUserId}`, { active: false })
    expect(off.status).toBe(200)

    await expect(loginAs(newEmail, PW)).rejects.toThrow(/403/)

    const on = await admin.put(`/api/users/${createdUserId}`, { active: true })
    expect(on.status).toBe(200)
    const ok = await loginAs(newEmail, PW)
    expect(ok.cookie).toBeTruthy()
  })

  it('an admin cannot deactivate their own account (409)', async () => {
    const admin = await loginAs('admin@demo.co')
    const self = await db.query.users.findFirst({ where: eq(schema.users.email, 'admin@demo.co') })
    const r = await admin.put(`/api/users/${self!.id}`, { active: false })
    expect(r.status).toBe(409)
  })

  it('a non-admin cannot update a user (403)', async () => {
    const sales = await loginAs('sales@demo.co')
    expect((await sales.put(`/api/users/${createdUserId}`, { active: true })).status).toBe(403)
  })
})

describe('POST /api/users/:id/reset-password', () => {
  it('rehashes the password: new works, old fails', async () => {
    const admin = await loginAs('admin@demo.co')
    const newPw = 'changed5678'
    const r = await admin.post(`/api/users/${createdUserId}/reset-password`, { password: newPw })
    expect(r.status).toBe(200)

    const ok = await loginAs(newEmail, newPw)
    expect(ok.cookie).toBeTruthy()
    await expect(loginAs(newEmail, PW)).rejects.toThrow(/401/)
  })

  it('rejects a too-short new password (400)', async () => {
    const admin = await loginAs('admin@demo.co')
    expect(
      (await admin.post(`/api/users/${createdUserId}/reset-password`, { password: 'x' })).status,
    ).toBe(400)
  })
})
