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
    { to: '/telematics', labelKey: 'nav.telematics', icon: '📡', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/catalog', labelKey: 'nav.catalog', icon: '🧰', roles: ['admin', 'owner', 'sales'] },
    { to: '/orders', labelKey: 'nav.orders', icon: '📦', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/addresses', labelKey: 'nav.addresses', icon: '📍', roles: ['admin', 'owner', 'sales'] },
    { to: '/payments', labelKey: 'nav.payments', icon: '💰', roles: ['admin', 'owner', 'sales'] },
    { to: '/returns', labelKey: 'nav.returns', icon: '↩', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/claims', labelKey: 'nav.claims', icon: '🛡', roles: ['admin', 'owner', 'warehouse'] },
    { to: '/warranty', labelKey: 'nav.warranty', icon: '📜', roles: ['admin', 'owner', 'sales', 'warehouse'] },
    { to: '/warehouse', labelKey: 'nav.warehouse', icon: '🏭', roles: ['admin', 'warehouse'] },
    { to: '/picking', labelKey: 'nav.picking', icon: '📋', roles: ['admin', 'warehouse'] },
    { to: '/locations', labelKey: 'nav.locations', icon: '🗄', roles: ['admin', 'warehouse'] },
    { to: '/movements', labelKey: 'nav.movements', icon: '📈', roles: ['admin', 'warehouse'] },
    { to: '/procurement', labelKey: 'nav.procurement', icon: '🚚', roles: ['admin', 'warehouse'] },
    { to: '/stock-ops', labelKey: 'nav.stockOps', icon: '🔁', roles: ['admin', 'warehouse'] },
    { to: '/reports', labelKey: 'nav.reports', icon: '📊', roles: ['admin'] },
    { to: '/masters', labelKey: 'nav.masters', icon: '🗂', roles: ['admin'] },
    { to: '/users', labelKey: 'nav.users', icon: '👤', roles: ['admin'] },
    { to: '/issues', labelKey: 'nav.issues', icon: '🐞', roles: ['admin'] },
    { to: '/admin', labelKey: 'nav.admin', icon: '⚙', roles: ['admin'] },
    { to: '/settings', labelKey: 'nav.settings', icon: '🛠', roles: ['admin'] },
  ]
}
