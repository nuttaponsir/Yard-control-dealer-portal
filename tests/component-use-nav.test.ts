// @vitest-environment happy-dom
// Test2 (QA). useNav() role-gating test. Resolves the visible nav per role with
// the SAME can() predicate the sidebar + middleware use, then asserts the list
// matches the SPEC §2.3 matrix / AC-1.1..AC-1.4 cell-for-cell.
import { describe, it, expect } from 'vitest'
import type { Role } from '~/types'

// No Nuxt globals needed by useNav itself, but install a useState shim in case.
;(globalThis as any).useState ??= (_k: string, init: () => unknown) => ({ value: init() })

const { useNav } = await import('~/composables/useNav')

// can() predicate mirrored from useAuth (item visible when it has no roles, or
// the user's role is in the list).
function visibleKeysFor(role: Role): string[] {
  return useNav()
    .filter((item) => !item.roles || item.roles.includes(role))
    .map((item) => item.labelKey)
}

describe('useNav role gating (SPEC §2.3 / AC-1.x)', () => {
  it('exposes exactly the 22 modules in order', () => {
    expect(useNav().map((i) => i.labelKey)).toEqual([
      'nav.dashboard',
      'nav.vin',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.addresses',
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
      'nav.issues',
      'nav.admin',
      'nav.settings',
    ])
  })

  it('AC-1.1: admin sees all 22 modules', () => {
    expect(visibleKeysFor('admin')).toEqual([
      'nav.dashboard',
      'nav.vin',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.addresses',
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
      'nav.issues',
      'nav.admin',
      'nav.settings',
    ])
  })

  it('AC-1.2: owner sees dashboard, vin, telematics, catalog, orders, addresses, payments, returns, claims, warranty', () => {
    expect(visibleKeysFor('owner')).toEqual([
      'nav.dashboard',
      'nav.vin',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.addresses',
      'nav.payments',
      'nav.returns',
      'nav.claims',
      'nav.warranty',
    ])
  })

  it('AC-1.3: sales sees dashboard, vin, telematics, catalog, orders, addresses, payments, returns, warranty', () => {
    expect(visibleKeysFor('sales')).toEqual([
      'nav.dashboard',
      'nav.vin',
      'nav.telematics',
      'nav.catalog',
      'nav.orders',
      'nav.addresses',
      'nav.payments',
      'nav.returns',
      'nav.warranty',
    ])
  })

  it('AC-1.4: warehouse sees ops modules + telematics/warranty (no catalog/admin)', () => {
    expect(visibleKeysFor('warehouse')).toEqual([
      'nav.dashboard',
      'nav.vin',
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

  it('sales never sees claims/warehouse/admin (AC-8.5, AC-1.3)', () => {
    const sales = visibleKeysFor('sales')
    expect(sales).not.toContain('nav.claims')
    expect(sales).not.toContain('nav.warehouse')
    expect(sales).not.toContain('nav.admin')
  })
})
