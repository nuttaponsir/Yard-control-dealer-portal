// @vitest-environment happy-dom
// Test2 (QA). useNav() role-gating test. Resolves the visible nav per role with
// the SAME predicate the sidebar uses (role-allowed AND not hidden), then
// asserts the list matches the nav spec cell-for-cell.
import { describe, it, expect } from 'vitest'
import type { Role } from '~/types'

// No Nuxt globals needed by useNav itself, but install a useState shim in case.
;(globalThis as any).useState ??= (_k: string, init: () => unknown) => ({ value: init() })

const { useNav } = await import('~/composables/useNav')

// Mirror the sidebar: an item is visible when it isn't hidden and either has no
// roles or includes the user's role.
function visibleKeysFor(role: Role): string[] {
  return useNav()
    .filter((item) => !item.hidden && (!item.roles || item.roles.includes(role)))
    .map((item) => item.labelKey)
}

describe('useNav role gating', () => {
  it('exposes exactly the 21 modules in order (incl. the hidden admin addresses entry)', () => {
    expect(useNav().map((i) => i.labelKey)).toEqual([
      'nav.dashboard',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.payments',
      'nav.returns',
      'nav.claims',
      'nav.warranty',
      'nav.myDealer',
      'nav.warehouse',
      'nav.picking',
      'nav.locations',
      'nav.movements',
      'nav.procurement',
      'nav.stockOps',
      'nav.reports',
      'nav.masters',
      'nav.users',
      'nav.settings',
      'nav.issues',
      'nav.dealerAddresses',
    ])
  })

  it('admin sees all modules except owner/sales "my dealer" and the hidden addresses entry', () => {
    expect(visibleKeysFor('admin')).toEqual([
      'nav.dashboard',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.payments',
      'nav.returns',
      'nav.claims',
      'nav.warranty',
      'nav.warehouse',
      'nav.picking',
      'nav.locations',
      'nav.movements',
      'nav.procurement',
      'nav.stockOps',
      'nav.reports',
      'nav.masters',
      'nav.users',
      'nav.settings',
      'nav.issues',
    ])
  })

  it('owner sees dashboard, telematics, catalog, orders, payments, returns, claims, warranty, my dealer', () => {
    expect(visibleKeysFor('owner')).toEqual([
      'nav.dashboard',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.payments',
      'nav.returns',
      'nav.claims',
      'nav.warranty',
      'nav.myDealer',
    ])
  })

  it('sales sees the owner set minus claims', () => {
    expect(visibleKeysFor('sales')).toEqual([
      'nav.dashboard',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.payments',
      'nav.returns',
      'nav.warranty',
      'nav.myDealer',
    ])
  })

  it('warehouse sees ops modules + telematics/orders/returns/claims/warranty (no catalog/system)', () => {
    expect(visibleKeysFor('warehouse')).toEqual([
      'nav.dashboard',
      'nav.telematics',
      'nav.orders',
      'nav.returns',
      'nav.claims',
      'nav.warranty',
      'nav.warehouse',
      'nav.picking',
      'nav.locations',
      'nav.movements',
      'nav.procurement',
      'nav.stockOps',
    ])
  })

  it('sales never sees claims/warehouse/system masters', () => {
    const sales = visibleKeysFor('sales')
    expect(sales).not.toContain('nav.claims')
    expect(sales).not.toContain('nav.warehouse')
    expect(sales).not.toContain('nav.masters')
  })

  it('the hidden admin addresses entry is gated to admin but never shown in any sidebar', () => {
    const hidden = useNav().filter((i) => i.hidden)
    expect(hidden.map((i) => i.labelKey)).toEqual(['nav.dealerAddresses'])
    for (const role of ['admin', 'owner', 'sales', 'warehouse'] as Role[]) {
      expect(visibleKeysFor(role)).not.toContain('nav.dealerAddresses')
    }
  })
})
