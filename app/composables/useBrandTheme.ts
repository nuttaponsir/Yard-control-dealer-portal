// Which screens wear the Mitsubishi-red portal accent (#e60012) vs the default
// JWD-blue ramp. Dealer-facing pages + the login screen are red; back-office
// operation screens (warehouse/WMS, procurement, telematics, admin, system)
// keep blue. Single source of truth, shared by the client theme plugin.
const DEALER_PATHS = [
  '/dashboard',
  '/telematics',
  '/catalog',
  '/orders',
  '/addresses',
  '/payments',
  '/returns',
  '/claims',
  '/warranty',
]

/** True for the login screen and every dealer-facing route (incl. sub-paths). */
export function isPortalPath(path: string): boolean {
  if (!path) return false
  const clean = path.split('?')[0]!.replace(/\/+$/, '') || '/'
  if (clean === '/' || clean === '/auth') return true
  return DEALER_PATHS.some((p) => clean === p || clean.startsWith(p + '/'))
}
