// ============================================================================
// Phase 3 — Internal WMS adapter.
// ----------------------------------------------------------------------------
// Fulfillment is handled inside this DB. When an order enters 'packing' and
// wms_auto_pick is on, a pick task is generated for the warehouse to action.
// Best-effort: a failure here is logged and swallowed (the order already
// advanced; picking is an operational overlay, not a gate).
// ============================================================================
import { getConfigBool } from '../config'
import { generatePickForOrder } from './picking'
import type { WmsAdapter, WmsOrderContext } from './types'

export const internalWmsAdapter: WmsAdapter = {
  mode: 'internal',

  async onOrderPacking(ctx: WmsOrderContext): Promise<void> {
    try {
      const auto = await getConfigBool('wms_auto_pick')
      if (!auto) return
      await generatePickForOrder(ctx.orderId, ctx.actorId ?? null)
    } catch (err) {
      console.error('[wms:internal] onOrderPacking failed', { orderId: ctx.orderId }, err)
    }
  },
}
