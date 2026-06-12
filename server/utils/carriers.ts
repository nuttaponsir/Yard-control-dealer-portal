// ============================================================================
// Phase E — carrier tracking integration (Flash / SCG)
// ----------------------------------------------------------------------------
// A provider-agnostic tracking abstraction. Real Flash/SCG REST clients would
// implement `CarrierProvider`; here we ship deterministic MOCK providers that
// synthesise a believable timeline from the order's own status + createdAt, so
// the tracking UI and tests work without external creds. Swap via registerCarrier()
// in production (Phase F).
// ============================================================================

export interface TrackingEvent {
  code: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered'
  label: string // Thai
  at: string // ISO
  location: string
}

export interface TrackingResult {
  trackingNo: string | null
  carrier: string | null
  status: 'pending' | 'in_transit' | 'delivered'
  events: TrackingEvent[]
}

interface TrackableOrder {
  status: string // order status
  trackingNo: string | null
  carrier: string | null
  createdAt: string
}

export interface CarrierProvider {
  hub: string
  /** Build the timeline for an order known to be shipped/delivered. */
  timeline(order: TrackableOrder): TrackingEvent[]
}

const STEP_LABELS: Record<TrackingEvent['code'], string> = {
  picked_up: 'รับพัสดุเข้าระบบ',
  in_transit: 'อยู่ระหว่างขนส่ง',
  out_for_delivery: 'กำลังนำส่ง',
  delivered: 'ส่งมอบสำเร็จ',
}

function hoursAfter(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3600_000).toISOString()
}

/** Shared mock timeline generator parameterised by the carrier hub. */
function mockProvider(hub: string): CarrierProvider {
  return {
    hub,
    timeline(order) {
      const base = order.createdAt
      const delivered = order.status === 'delivered'
      const events: TrackingEvent[] = [
        { code: 'picked_up', label: STEP_LABELS.picked_up, at: hoursAfter(base, 6), location: hub },
        { code: 'in_transit', label: STEP_LABELS.in_transit, at: hoursAfter(base, 18), location: hub },
      ]
      if (delivered) {
        events.push({ code: 'out_for_delivery', label: STEP_LABELS.out_for_delivery, at: hoursAfter(base, 30), location: 'ศูนย์กระจายปลายทาง' })
        events.push({ code: 'delivered', label: STEP_LABELS.delivered, at: hoursAfter(base, 36), location: 'ผู้รับปลายทาง' })
      }
      return events
    },
  }
}

// Registry keyed by the carrier name stored on orders ('Flash' | 'SCG').
const carriers: Record<string, CarrierProvider> = {
  Flash: mockProvider('ศูนย์คัดแยก Flash กรุงเทพ'),
  SCG: mockProvider('คลังกระจายสินค้า SCG'),
}

/** Register/override a carrier provider (production wiring or tests). */
export function registerCarrier(name: string, provider: CarrierProvider) {
  carriers[name] = provider
}

/** Resolve the tracking timeline for an order. Never throws. */
export function getTracking(order: TrackableOrder): TrackingResult {
  if (!order.trackingNo || !order.carrier) {
    return { trackingNo: null, carrier: order.carrier ?? null, status: 'pending', events: [] }
  }
  const provider = carriers[order.carrier]
  if (!provider) {
    return { trackingNo: order.trackingNo, carrier: order.carrier, status: 'in_transit', events: [] }
  }
  const events = provider.timeline(order)
  const status: TrackingResult['status'] = order.status === 'delivered' ? 'delivered' : 'in_transit'
  return { trackingNo: order.trackingNo, carrier: order.carrier, status, events }
}
