import { describe, it, expect } from 'vitest'
import { loginSchema } from '../server/utils/validation'

describe('loginSchema', () => {
  it('accepts a valid login body', () => {
    const r = loginSchema.safeParse({ email: 'admin@demo.co', password: 'demo1234' })
    expect(r.success).toBe(true)
  })

  it('rejects a malformed email', () => {
    const r = loginSchema.safeParse({ email: 'nope', password: 'x' })
    expect(r.success).toBe(false)
  })

  it('rejects an empty password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.co', password: '' })
    expect(r.success).toBe(false)
  })
})
