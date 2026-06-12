// ============================================================================
// useNav() — single source of truth for the sidebar (SHARED; SA owns).
// Each item declares allowed `roles`; the sidebar + middleware both gate on it.
// admin sees all 12; sales/owner: overview, vin, catalog, orders, payments,
// returns; warehouse: warehouse + claims + returns (+ overview).
// ============================================================================
import type { NavItem } from '~/types'

export type NavItemResolved = NavItem

export function useNav(): NavItemResolved[] {
  return [
    { to: '/dashboard', labelKey: 'nav.dashboard', icon: '◧' },
    { to: '/vin', labelKey: 'nav.vin', icon: '🔎', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/catalog', labelKey: 'nav.catalog', icon: '🧰', roles: ['admin', 'owner', 'sales'] },
    { to: '/orders', labelKey: 'nav.orders', icon: '📦', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/payments', labelKey: 'nav.payments', icon: '💰', roles: ['admin', 'owner', 'sales'] },
    { to: '/returns', labelKey: 'nav.returns', icon: '↩', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/claims', labelKey: 'nav.claims', icon: '🛡', roles: ['admin', 'owner', 'warehouse'] },
    { to: '/warehouse', labelKey: 'nav.warehouse', icon: '🏭', roles: ['admin', 'warehouse'] },
    { to: '/reports', labelKey: 'nav.reports', icon: '📊', roles: ['admin'] },
    { to: '/masters', labelKey: 'nav.masters', icon: '🗂', roles: ['admin'] },
    { to: '/users', labelKey: 'nav.users', icon: '👤', roles: ['admin'] },
    { to: '/admin', labelKey: 'nav.admin', icon: '⚙', roles: ['admin'] },
  ]
}
