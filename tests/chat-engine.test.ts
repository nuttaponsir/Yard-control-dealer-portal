// Phase I — unit tests for the demo chat engine's PURE pieces (no DB):
// intent classification (help vs data vs fallback) and the role-aware help
// renderer. The data answerers are exercised via the /api/chat integration
// elsewhere; here we lock the routing logic the whole feature hangs on.
import { describe, it, expect } from 'vitest'
import {
  classifyMessage,
  renderHelp,
  defaultSuggestions,
  HELP_TOPICS,
} from '../server/utils/chat'

describe('classifyMessage — help intents', () => {
  it('routes "วิธีเปิดออเดอร์ใหม่" to the create_order help topic', () => {
    expect(classifyMessage('วิธีเปิดออเดอร์ใหม่')).toEqual({ type: 'help', topicId: 'create_order' })
  })

  it('routes "how to check a vin" to the vin_check help topic', () => {
    expect(classifyMessage('how to check a vin')).toEqual({ type: 'help', topicId: 'vin_check' })
  })

  it('routes a bare help-only keyword (no data overlap) to help', () => {
    // "ตรวจสอบรถ" maps to the VIN topic and is not a data-query noun, so with
    // no data trigger present it falls through to the help lookup.
    expect(classifyMessage('ตรวจสอบรถ')).toEqual({ type: 'help', topicId: 'vin_check' })
  })
})

describe('classifyMessage — data intents', () => {
  it('counts orders', () => {
    expect(classifyMessage('มีออเดอร์กี่รายการ')).toEqual({ type: 'data', dataIntent: 'orders_summary' })
  })

  it('detects pending-orders phrasing', () => {
    expect(classifyMessage('มีออเดอร์ค้างส่งกี่รายการ')).toEqual({
      type: 'data',
      dataIntent: 'orders_pending',
    })
  })

  it('detects low stock', () => {
    expect(classifyMessage('ของใกล้หมดมีอะไรบ้าง')).toEqual({ type: 'data', dataIntent: 'low_stock' })
  })

  it('detects credit balance', () => {
    expect(classifyMessage('เครดิตคงเหลือเท่าไหร่')).toEqual({ type: 'data', dataIntent: 'credit' })
  })

  it('detects outstanding payments', () => {
    expect(classifyMessage('ยอดค้างชำระเท่าไหร่')).toEqual({
      type: 'data',
      dataIntent: 'payments_outstanding',
    })
  })

  it('detects catalog count', () => {
    expect(classifyMessage('มีอะไหล่กี่รายการ')).toEqual({ type: 'data', dataIntent: 'catalog_count' })
  })
})

describe('classifyMessage — fallback', () => {
  it('returns fallback for an empty string', () => {
    expect(classifyMessage('   ')).toEqual({ type: 'fallback' })
  })

  it('returns fallback for an unrelated question', () => {
    expect(classifyMessage('วันนี้อากาศเป็นยังไง')).toEqual({ type: 'fallback' })
  })
})

describe('renderHelp', () => {
  it('returns the topic body for an allowed role', () => {
    const out = renderHelp('create_order', 'sales')
    expect(out).toContain('วิธีเปิดออเดอร์ใหม่')
  })

  it('gives a role-gated message when the role lacks the topic', () => {
    const out = renderHelp('users', 'sales') // users topic is admin-only
    expect(out).toContain('ไม่อยู่ในสิทธิ์')
  })

  it('returns null for an unknown topic', () => {
    expect(renderHelp('nope', 'admin')).toBeNull()
  })

  it('every help topic id is renderable for admin', () => {
    for (const tp of HELP_TOPICS) {
      expect(renderHelp(tp.id, 'admin')).toBeTruthy()
    }
  })
})

describe('defaultSuggestions', () => {
  it('adds the credit prompt for owner/sales', () => {
    expect(defaultSuggestions('sales').some((s) => s.includes('เครดิต'))).toBe(true)
  })

  it('omits the credit prompt for warehouse', () => {
    expect(defaultSuggestions('warehouse').some((s) => s.includes('เครดิต'))).toBe(false)
  })
})
