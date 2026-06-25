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
    // ---- Sales & service (dealer-facing). Telematics/Autologic lives here
    // (VIN check is consolidated into it) — no longer its own 1-item group. ----
    { to: '/accessories', labelKey: 'nav.telematics', icon: '📡', roles: ['admin', 'owner', 'sales', 'warehouse'], group: 'navGroup.sales' },
    { to: '/catalog', labelKey: 'nav.catalog', icon: '🧰', roles: ['admin', 'owner', 'sales'], group: 'navGroup.sales' },
    { to: '/orders', labelKey: 'nav.orders', icon: '📦', roles: ['admin', 'owner', 'sales', 'warehouse'], group: 'navGroup.sales' },
    { to: '/payments', labelKey: 'nav.payments', icon: '💰', roles: ['admin', 'owner', 'sales'], group: 'navGroup.sales' },
    { to: '/returns', labelKey: 'nav.returns', icon: '↩', roles: ['admin', 'owner', 'sales', 'warehouse'], group: 'navGroup.sales' },
    { to: '/claims', labelKey: 'nav.claims', icon: '🛡', roles: ['admin', 'owner', 'warehouse'], group: 'navGroup.sales' },
    { to: '/warranty', labelKey: 'nav.warranty', icon: '📜', roles: ['admin', 'owner', 'sales', 'warehouse'], group: 'navGroup.sales' },
    // owner/sales self-service: their own dealer profile + ship-to/bill-to book.
    { to: '/addresses', labelKey: 'nav.myDealer', icon: '🏪', roles: ['owner', 'sales'], group: 'navGroup.sales' },
    // ---- Warehouse / WMS ----
    { to: '/warehouse', labelKey: 'nav.warehouse', icon: '🏭', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    { to: '/picking', labelKey: 'nav.picking', icon: '📋', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    { to: '/locations', labelKey: 'nav.locations', icon: '🗄', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    { to: '/movements', labelKey: 'nav.movements', icon: '📈', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    { to: '/procurement', labelKey: 'nav.procurement', icon: '🚚', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    { to: '/stock-ops', labelKey: 'nav.stockOps', icon: '🔁', roles: ['admin', 'warehouse'], group: 'navGroup.warehouse' },
    // ---- System & settings (admin). /admin folded into masters → dealers. ----
    { to: '/reports', labelKey: 'nav.reports', icon: '📊', roles: ['admin'], group: 'navGroup.system' },
    { to: '/masters', labelKey: 'nav.masters', icon: '🗂', roles: ['admin'], group: 'navGroup.system' },
    { to: '/users', labelKey: 'nav.users', icon: '👤', roles: ['admin'], group: 'navGroup.system' },
    { to: '/settings', labelKey: 'nav.settings', icon: '🛠', roles: ['admin'], group: 'navGroup.system' },
    { to: '/issues', labelKey: 'nav.issues', icon: '🐞', roles: ['admin'], group: 'navGroup.system' },
    // Admin manages every dealer's addresses from masters → dealers (this opens
    // /addresses?dealerId=…). Gated to admin but not shown as its own item.
    { to: '/addresses', labelKey: 'nav.dealerAddresses', icon: '📍', roles: ['admin'], group: 'navGroup.system', hidden: true },
  ]
}
