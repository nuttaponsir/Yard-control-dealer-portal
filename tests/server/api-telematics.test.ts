// Phase 5 — Autologic Telematics: device registry + event feed + firmware push.
// ----------------------------------------------------------------------------
// Exercises GET /api/telematics (devices from installed VINs with a
// deviceSerial + the recent event feed) and POST /api/telematics/firmware
// (admin/warehouse only). A firmware push mutates vins.firmware +
// lastConnectedAt AND appends a 'firmware_update' telematics_events row, so the
// suite captures the VIN's original firmware/lastConnectedAt in beforeAll and
// restores them in afterAll, and deletes every telematics_events row it created
// (tracked by id). The shared DB is left exactly as seeded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { startServer, stopServer, loginAs, Client } from './harness'
import { db, schema } from '../../server/db'

const INSTALLED_VIN = 'MMTJNKB40NH000001'
const TEST_FIRMWARE = 'v9.9.9-test'

interface Device {
  vin: string
  model: string
  deviceSerial: string | null
  firmware: string | null
  lastConnectedAt: string | null
}
interface TelematicsEvent {
  id: number
  vin: string
  type: string
  message: string
}

let admin: Client
let owner: Client // DLR0001
let warehouse: Client
let base = ''

// Capture for exact restore.
let origFirmware: string | null = null
let origLastConnectedAt: string | null = null
// Track created telematics_events rows so afterAll can purge them.
const createdEventIds: number[] = []

beforeAll(async () => {
  base = await startServer()
  admin = await loginAs('admin@demo.co')
  owner = await loginAs('owner@demo.co') // DLR0001
  warehouse = await loginAs('warehouse@demo.co')

  const vinRow = await db.query.vins.findFirst({ where: eq(schema.vins.vin, INSTALLED_VIN) })
  origFirmware = vinRow!.firmware
  origLastConnectedAt = vinRow!.lastConnectedAt
})

afterAll(async () => {
  // Delete only the events our firmware pushes created.
  if (createdEventIds.length) {
    await db
      .delete(schema.telematicsEvents)
      .where(inArray(schema.telematicsEvents.id, createdEventIds))
  }
  // Restore the VIN's firmware + lastConnectedAt to the seeded values.
  await db
    .update(schema.vins)
    .set({ firmware: origFirmware, lastConnectedAt: origLastConnectedAt })
    .where(eq(schema.vins.vin, INSTALLED_VIN))
  // Remove the ingest token row this suite set (back to the seeded default).
  await db.delete(schema.appConfig).where(eq(schema.appConfig.key, 'telematics_ingest_token'))
  await stopServer()
})

describe('GET /api/telematics', () => {
  it('returns non-empty devices + events for warehouse', async () => {
    const r = await warehouse.get<{ devices: Device[]; events: TelematicsEvent[] }>('/api/telematics')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.devices)).toBe(true)
    expect(Array.isArray(r.body.events)).toBe(true)
    expect(r.body.devices.length).toBeGreaterThan(0)
    expect(r.body.events.length).toBeGreaterThan(0)
    // The installed VIN with a device serial is in the registry.
    const dev = r.body.devices.find((d) => d.vin === INSTALLED_VIN)
    expect(dev).toBeTruthy()
    expect(dev!.deviceSerial).toBeTruthy()
  })

  it('also accessible by admin', async () => {
    const r = await admin.get<{ devices: Device[]; events: TelematicsEvent[] }>('/api/telematics')
    expect(r.status).toBe(200)
    expect(r.body.devices.length).toBeGreaterThan(0)
  })
})

describe('POST /api/telematics/firmware', () => {
  it('admin pushes firmware → 200, updates vins.firmware + adds a firmware_update event', async () => {
    const r = await admin.post<{ ok: boolean }>('/api/telematics/firmware', {
      vin: INSTALLED_VIN,
      firmware: TEST_FIRMWARE,
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    // vins.firmware now equals the pushed value.
    const vinRow = await db.query.vins.findFirst({ where: eq(schema.vins.vin, INSTALLED_VIN) })
    expect(vinRow!.firmware).toBe(TEST_FIRMWARE)

    // A new firmware_update event exists for this vin mentioning the version.
    const ev = await db.query.telematicsEvents.findFirst({
      where: eq(schema.telematicsEvents.vin, INSTALLED_VIN),
      orderBy: (e, { desc }) => [desc(e.id)],
    })
    expect(ev).toBeTruthy()
    expect(ev!.type).toBe('firmware_update')
    expect(ev!.message).toContain(TEST_FIRMWARE)
    createdEventIds.push(ev!.id)
  })

  it('owner (dealer-scoped) is forbidden (403)', async () => {
    const r = await owner.post('/api/telematics/firmware', {
      vin: INSTALLED_VIN,
      firmware: TEST_FIRMWARE,
    })
    expect(r.status).toBe(403)
  })

  it('unknown but valid-length VIN → 404', async () => {
    const r = await admin.post('/api/telematics/firmware', {
      vin: 'ZZZZZZZZZZZZZZZZZ', // 17 chars, not in registry
      firmware: TEST_FIRMWARE,
    })
    expect(r.status).toBe(404)
  })

  it('bad VIN length → 400', async () => {
    const r = await admin.post('/api/telematics/firmware', {
      vin: 'TOO-SHORT',
      firmware: TEST_FIRMWARE,
    })
    expect(r.status).toBe(400)
  })
})

describe('POST /api/telematics/ingest (#4 device event ingestion)', () => {
  it('admin session ingests an event → 200, creates it + bumps lastConnectedAt', async () => {
    const r = await admin.post<{ ok: boolean; event: { id: number; severity: string } }>(
      '/api/telematics/ingest',
      { vin: INSTALLED_VIN, type: 'fault' },
    )
    expect(r.status).toBe(200)
    expect(r.body.event.severity).toBe('critical') // default for 'fault'
    createdEventIds.push(r.body.event.id)

    const vinRow = await db.query.vins.findFirst({ where: eq(schema.vins.vin, INSTALLED_VIN) })
    expect(vinRow!.lastConnectedAt).toBeTruthy()
  })

  it('unauthenticated (no session, no token) → 401', async () => {
    const res = await fetch(`${base}/api/telematics/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vin: INSTALLED_VIN, type: 'heartbeat' }),
    })
    expect(res.status).toBe(401)
  })

  it('device token (x-ingest-token) is accepted without a session', async () => {
    // Set the ingest token via config, then post as an unauthenticated device.
    await db
      .insert(schema.appConfig)
      .values({ key: 'telematics_ingest_token', value: 'test-ingest-tok' })
      .onConflictDoUpdate({ target: schema.appConfig.key, set: { value: 'test-ingest-tok' } })

    const res = await fetch(`${base}/api/telematics/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': 'test-ingest-tok' },
      body: JSON.stringify({ vin: INSTALLED_VIN, type: 'heartbeat' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; event: { id: number } }
    expect(body.ok).toBe(true)
    createdEventIds.push(body.event.id)

    // A wrong token is still rejected.
    const bad = await fetch(`${base}/api/telematics/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': 'wrong' },
      body: JSON.stringify({ vin: INSTALLED_VIN, type: 'heartbeat' }),
    })
    expect(bad.status).toBe(401)
  })

  it('unknown VIN → 404', async () => {
    const r = await admin.post('/api/telematics/ingest', { vin: 'ZZZZZZZZZZZZZZZZZ', type: 'connect' })
    expect(r.status).toBe(404)
  })
})
