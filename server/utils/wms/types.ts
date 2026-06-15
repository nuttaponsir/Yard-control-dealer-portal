// ============================================================================
// Phase 3 — OMS/WMS integration adapter contract.
// ----------------------------------------------------------------------------
// The order/fulfillment code talks to a single WmsAdapter interface and never
// branches on the mode itself. getWmsAdapter() (see index.ts) returns the
// concrete adapter for the current `wms_mode` config value:
//   • internal → InternalWmsAdapter (generates pick tasks in this DB)
//   • external → ExternalWmsAdapter (hands off to a stubbed external system)
// Hooks are best-effort: they must never throw into the originating request
// (the order is already persisted). Implementations swallow + log their own
// errors, mirroring notify()/writeAudit().
// ============================================================================
import type { WmsMode } from '../../../app/types'

export interface WmsOrderLine {
  partId: number
  qty: number
}

export interface WmsOrderContext {
  orderId: number
  poNumber: string
  dealerId: number
  lines: WmsOrderLine[]
  /** The acting user id (for audit / movement attribution), or null. */
  actorId?: number | null
}

export interface WmsAdapter {
  readonly mode: WmsMode
  /**
   * Fired when an order enters 'packing'. Internal mode generates a pick task;
   * external mode dispatches the order to the external WMS. Best-effort.
   */
  onOrderPacking(ctx: WmsOrderContext): Promise<void>
}
