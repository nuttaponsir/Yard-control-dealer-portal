// ============================================================================
// Mitsubishi Dealer Portal — audit-log helper (Phase B Wave 2)
// ----------------------------------------------------------------------------
// Best-effort writer for the `audit_log` table. Records significant state
// changes (order creation, fulfillment advances, warranty claims, ...).
//
// IMPORTANT: this must NEVER break the main request. The insert is wrapped in
// try/catch and any failure is logged and swallowed — an audit write failing
// must not fail the order/claim it describes. createdAt follows the project's
// ISO-text timestamp convention.
// ============================================================================
import { db, schema } from '../db'

/**
 * Append a row to the audit log. Fire-and-await, but never throws.
 *
 * @param userId   acting user's id, or null for system/anonymous actions
 * @param action   dotted verb, e.g. 'order.create' | 'order.advance' | 'claim.create'
 * @param entity   logical entity name, e.g. 'order' | 'claim'
 * @param entityId business identifier (PO/claim number or row id) as a string
 * @param detail   optional human-readable context
 */
export async function writeAudit(
  userId: number | null,
  action: string,
  entity: string,
  entityId: string,
  detail?: string,
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      userId: userId ?? null,
      action,
      entity,
      entityId,
      detail: detail ?? null,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    // Swallow: audit failure must not break the originating request.
    console.error('[audit] failed to write audit row', { action, entity, entityId }, err)
  }
}
