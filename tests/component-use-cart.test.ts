// @vitest-environment happy-dom
// Test2 (QA). Composable test for useCart — add/setQty/remove/clear, count &
// total math, and the activeVin hand-off shape.
// Maps to AC-4.5 (line total = qty x unitPrice; grand total = sum) and
// AC-5.3 (2x350 + 1x420 = 1120). activeVin shape supports AC-3.5/AC-5.4.
import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { Part } from '~/types'

// --- Nuxt `useState` shim: a keyed, module-global shared ref (matches Nuxt's
// shared-state semantics so the composable behaves as in the app). ---
const __stateStore = new Map<string, ReturnType<typeof ref>>()
;(globalThis as any).useState = (key: string, init: () => unknown) => {
  if (!__stateStore.has(key)) __stateStore.set(key, ref(init()))
  return __stateStore.get(key)!
}

// Import after the shim is installed.
const { useCart } = await import('~/composables/useCart')

const part = (id: number, price: number, sku = `SKU-${id}`): Part => ({
  id,
  sku,
  name: `Part ${id}`,
  category: 'กรอง',
  oem: true,
  warrantyMonths: 12,
  leadTimeDays: 1,
  price,
})

describe('useCart', () => {
  beforeEach(() => {
    useCart().clear()
    useCart().setActiveVin(null)
  })

  it('adds a line and computes count/total', () => {
    const cart = useCart()
    cart.add(part(1, 350), 2)
    expect(cart.lines.value).toHaveLength(1)
    expect(cart.count.value).toBe(2)
    expect(cart.total.value).toBe(700)
    expect(cart.qtyOf(1)).toBe(2)
  })

  it('reproduces the verified live total: 2x350 + 1x420 = 1120 (AC-5.3)', () => {
    const cart = useCart()
    cart.add(part(1, 350), 2)
    cart.add(part(2, 420), 1)
    expect(cart.count.value).toBe(3)
    expect(cart.total.value).toBe(1120)
    // line totals
    const l1 = cart.lines.value.find((l) => l.partId === 1)!
    const l2 = cart.lines.value.find((l) => l.partId === 2)!
    expect(l1.qty * l1.unitPrice).toBe(700)
    expect(l2.qty * l2.unitPrice).toBe(420)
  })

  it('merges quantity when the same part is added twice', () => {
    const cart = useCart()
    cart.add(part(1, 350), 1)
    cart.add(part(1, 350), 2)
    expect(cart.lines.value).toHaveLength(1)
    expect(cart.qtyOf(1)).toBe(3)
  })

  it('setQty updates the quantity', () => {
    const cart = useCart()
    cart.add(part(1, 350), 1)
    cart.setQty(1, 5)
    expect(cart.qtyOf(1)).toBe(5)
    expect(cart.total.value).toBe(1750)
  })

  it('setQty to 0 (or negative) removes the line', () => {
    const cart = useCart()
    cart.add(part(1, 350), 3)
    cart.setQty(1, 0)
    expect(cart.qtyOf(1)).toBe(0)
    expect(cart.lines.value).toHaveLength(0)
  })

  it('remove deletes only the targeted line', () => {
    const cart = useCart()
    cart.add(part(1, 350), 1)
    cart.add(part(2, 420), 1)
    cart.remove(1)
    expect(cart.lines.value).toHaveLength(1)
    expect(cart.qtyOf(2)).toBe(1)
  })

  it('clear empties the cart', () => {
    const cart = useCart()
    cart.add(part(1, 350), 2)
    cart.clear()
    expect(cart.lines.value).toHaveLength(0)
    expect(cart.count.value).toBe(0)
    expect(cart.total.value).toBe(0)
  })

  it('exposes the activeVin hand-off shape used by VIN->catalog->checkout', () => {
    const cart = useCart()
    expect(cart.activeVin.value).toBeNull()
    cart.setActiveVin('MMTJNKB40NH000001')
    expect(cart.activeVin.value).toBe('MMTJNKB40NH000001')
    // shared state: a fresh useCart() instance sees the same active VIN
    expect(useCart().activeVin.value).toBe('MMTJNKB40NH000001')
  })

  it('produces a line shape matching the CartLine contract', () => {
    const cart = useCart()
    cart.add(part(7, 1850, 'MIT-BP-003'), 1)
    const line = cart.lines.value[0]!
    expect(line).toMatchObject({
      partId: 7,
      sku: 'MIT-BP-003',
      name: 'Part 7',
      unitPrice: 1850,
      qty: 1,
    })
  })
})
