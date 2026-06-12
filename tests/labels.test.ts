import { describe, it, expect } from 'vitest'
import {
  statusLabel,
  ORDER_STATUS_ORDER,
  ORDER_STATUS_LABELS,
  thb,
} from '~/utils/labels'

describe('status labels', () => {
  it('maps every order status to a Thai label', () => {
    for (const s of ORDER_STATUS_ORDER) {
      expect(ORDER_STATUS_LABELS[s]).toBeTruthy()
      expect(statusLabel(s)).toBe(ORDER_STATUS_LABELS[s])
    }
  })

  it('resolves the documented order workflow order', () => {
    expect(ORDER_STATUS_ORDER).toEqual([
      'pending',
      'confirming',
      'packing',
      'shipped',
      'delivered',
    ])
  })

  it('falls back to the raw status for unknown values', () => {
    expect(statusLabel('mystery')).toBe('mystery')
  })

  it('formats THB amounts', () => {
    expect(thb(1250000)).toBe('฿1,250,000')
  })
})
