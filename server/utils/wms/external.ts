// ============================================================================
// Phase 3 — External WMS adapter (stub).
// ----------------------------------------------------------------------------
// Represents handing fulfillment to a third-party WMS. We do not own that
// system, so this is a stubbed integration boundary: on →packing it records a
// dispatch in the audit log + raises an admin notification, and writes one
// 'external_dispatch' ledger row per line (qty 0 — informational; the external
// system owns the physical move). No pick task is created. Best-effort.
//
// In a real deployment this is where an HTTP call to the external WMS would go;
// the endpoint/credentials would come from app-config keys.
// ============================================================================
import { db } from '../../db'
import { writeAudit } from '../audit'
import { notify } from '../notify'
import { postMovement } from './movements'
import type { WmsAdapter, WmsOrderContext } from './types'

export const externalWmsAdapter: WmsAdapter = {
  mode: 'external',

  async onOrderPacking(ctx: WmsOrderContext): Promise<void> {
    try {
      // Record the hand-off in the ledger (informational, qty 0) per line.
      for (const line of ctx.lines) {
        await postMovement(db, {
          partId: line.partId,
          warehouse: 'external',
          kind: 'external_dispatch',
          qty: 0,
          refType: 'external',
          refId: ctx.poNumber,
          note: 'ส่งคำสั่งจัดสินค้าให้ WMS ภายนอก',
          createdBy: ctx.actorId ?? null,
        })
      }
      await writeAudit(
        ctx.actorId ?? null,
        'wms.external.dispatch',
        'order',
        ctx.poNumber,
        `dispatched ${ctx.lines.length} line(s) to external WMS`,
      )
      await notify({
        event: 'order.shipped', // reuse existing event taxonomy; body conveys WMS context
        entity: 'order',
        entityId: ctx.poNumber,
        dealerId: ctx.dealerId,
        toAdmins: true,
        vars: { po: ctx.poNumber, carrier: 'WMS ภายนอก', tracking: '-' },
      })
    } catch (err) {
      console.error('[wms:external] onOrderPacking failed', { orderId: ctx.orderId }, err)
    }
  },
}
