// ============================================================================
// Phase 3 — OMS/WMS adapter factory.
// ----------------------------------------------------------------------------
// Resolves the WmsAdapter for the current `wms_mode` config value. Order /
// fulfillment code calls getWmsAdapter() and talks to the interface, never
// branching on the mode itself.
// ============================================================================
import { getWmsMode } from '../config'
import { internalWmsAdapter } from './internal'
import { externalWmsAdapter } from './external'
import type { WmsAdapter } from './types'

export type { WmsAdapter, WmsOrderContext, WmsOrderLine } from './types'
export { postMovement } from './movements'
export { generatePickForOrder } from './picking'

/** The adapter matching the runtime `wms_mode` ('internal' | 'external'). */
export async function getWmsAdapter(): Promise<WmsAdapter> {
  const mode = await getWmsMode()
  return mode === 'external' ? externalWmsAdapter : internalWmsAdapter
}
