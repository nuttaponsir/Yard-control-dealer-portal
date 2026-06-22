// ============================================================================
// Test1 (QA, backend) — HTTP test harness for the Nitro/h3 API handlers.
// ----------------------------------------------------------------------------
// The route handlers under server/api/** call h3 utilities (defineEventHandler,
// createError, readBody, getQuery, getCookie, setCookie, ...) as Nuxt
// AUTO-IMPORTS — i.e. they reference them as globals with no explicit import.
// To exercise the *real* handlers + *real* Postgres without booting all of
// Nuxt, we:
//   1. inject the h3 helpers onto globalThis (mirrors Nuxt's auto-import),
//   2. import each handler module and mount it on an h3 router,
//   3. serve over a real HTTP port and drive it with fetch + cookie jar.
// This is an INTEGRATION harness: it hits the actual DB seeded on :5434.
// ============================================================================
import { createServer, type Server } from 'node:http'
import { createApp, createRouter, toNodeListener, eventHandler } from 'h3'
import * as h3 from 'h3'

// --- 1. expose h3 utilities as globals (Nuxt auto-import shim) --------------
const g = globalThis as Record<string, unknown>
for (const key of [
  'defineEventHandler', 'eventHandler', 'createError', 'readBody', 'getQuery',
  'getRouterParam', 'getRouterParams', 'getCookie', 'setCookie', 'deleteCookie',
  'getHeader', 'getHeaders', 'setResponseStatus', 'sendNoContent',
  'getRequestIP', 'setResponseHeader',
] as const) {
  if ((h3 as Record<string, unknown>)[key]) g[key] = (h3 as Record<string, unknown>)[key]
}

let server: Server | null = null
let baseUrl = ''

export async function startServer(): Promise<string> {
  if (server) return baseUrl

  const app = createApp()
  const router = createRouter()

  // Import handlers lazily so the globals above are set first.
  const login = (await import('../../server/api/auth/login.post')).default
  const logout = (await import('../../server/api/auth/logout.post')).default
  const me = (await import('../../server/api/auth/me.get')).default
  const dashboard = (await import('../../server/api/dashboard.get')).default
  const vin = (await import('../../server/api/vin/[vin].get')).default
  const parts = (await import('../../server/api/parts/index.get')).default
  const ordersGet = (await import('../../server/api/orders/index.get')).default
  const ordersPost = (await import('../../server/api/orders/index.post')).default
  const ordersCancel = (await import('../../server/api/orders/[id]/cancel.post')).default
  const orderDetail = (await import('../../server/api/orders/[id].get')).default
  const warehouseGet = (await import('../../server/api/warehouse.get')).default
  const warehousePatch = (await import('../../server/api/warehouse/[id].patch')).default
  const claimsGet = (await import('../../server/api/claims/index.get')).default
  const claimsPost = (await import('../../server/api/claims/index.post')).default
  const dealers = (await import('../../server/api/dealers/index.get')).default
  const returnsGet = (await import('../../server/api/returns/index.get')).default
  const returnsPost = (await import('../../server/api/returns/index.post')).default
  const returnsDecision = (await import('../../server/api/returns/[id]/decision.post')).default
  const mastersGet = (await import('../../server/api/masters/[entity]/index.get')).default
  const mastersPost = (await import('../../server/api/masters/[entity]/index.post')).default
  const mastersPut = (await import('../../server/api/masters/[entity]/[id].put')).default
  const mastersDelete = (await import('../../server/api/masters/[entity]/[id].delete')).default
  // Phase D — report endpoints
  const rptSalesByDealer = (await import('../../server/api/reports/sales-by-dealer.get')).default
  const rptSalesByCategory = (await import('../../server/api/reports/sales-by-category.get')).default
  const rptSalesByRegion = (await import('../../server/api/reports/sales-by-region.get')).default
  const rptOpenOrdersAging = (await import('../../server/api/reports/open-orders-aging.get')).default
  const rptTopParts = (await import('../../server/api/reports/top-parts.get')).default
  const rptStockOnHand = (await import('../../server/api/reports/stock-on-hand.get')).default
  const rptLowStock = (await import('../../server/api/reports/low-stock.get')).default
  const rptInventoryValuation = (await import('../../server/api/reports/inventory-valuation.get')).default
  const rptCreditUtilization = (await import('../../server/api/reports/credit-utilization.get')).default
  const rptCreditRisk = (await import('../../server/api/reports/credit-risk.get')).default
  const rptClaimsByStatus = (await import('../../server/api/reports/claims-by-status.get')).default
  const rptClaimRateByPart = (await import('../../server/api/reports/claim-rate-by-part.get')).default
  const rptClaimsByModel = (await import('../../server/api/reports/claims-by-model.get')).default
  const rptDealerMixByGrade = (await import('../../server/api/reports/dealer-mix-by-grade.get')).default
  const rptAutologicInstall = (await import('../../server/api/reports/autologic-install.get')).default
  // Phase E — notifications, tracking, jobs
  const notificationsGet = (await import('../../server/api/notifications/index.get')).default
  const notificationRead = (await import('../../server/api/notifications/[id]/read.post')).default
  const notificationsReadAll = (await import('../../server/api/notifications/read-all.post')).default
  const orderTracking = (await import('../../server/api/orders/[id]/tracking.get')).default
  const jobRun = (await import('../../server/api/jobs/[name]/run.post')).default
  // Phase F — hardening
  const health = (await import('../../server/api/health.get')).default
  const seedDemo = (await import('../../server/api/auth/seed-demo.post')).default
  // Phase G — payments / AR + user management
  const paymentsGet = (await import('../../server/api/payments/index.get')).default
  const paymentsPost = (await import('../../server/api/payments/index.post')).default
  const rptArAging = (await import('../../server/api/reports/ar-aging.get')).default
  const usersGet = (await import('../../server/api/users/index.get')).default
  const usersPost = (await import('../../server/api/users/index.post')).default
  const usersPut = (await import('../../server/api/users/[id].put')).default
  const usersResetPassword = (await import('../../server/api/users/[id]/reset-password.post')).default
  // Phase 2 — dealer address book (bill-to / ship-to + geo)
  const addressesGet = (await import('../../server/api/addresses/index.get')).default
  const addressesPost = (await import('../../server/api/addresses/index.post')).default
  const addressesPut = (await import('../../server/api/addresses/[id].put')).default
  const addressesDelete = (await import('../../server/api/addresses/[id].delete')).default
  // Phase 3 — WMS: storage locations, stock movements, pick tasks
  const locationsGet = (await import('../../server/api/wms/locations/index.get')).default
  const locationsPost = (await import('../../server/api/wms/locations/index.post')).default
  const locationsPut = (await import('../../server/api/wms/locations/[id].put')).default
  const locationsDelete = (await import('../../server/api/wms/locations/[id].delete')).default
  const movementsGet = (await import('../../server/api/wms/movements/index.get')).default
  const movementsPost = (await import('../../server/api/wms/movements/index.post')).default
  const pickTasksGet = (await import('../../server/api/wms/pick-tasks/index.get')).default
  const pickTaskGet = (await import('../../server/api/wms/pick-tasks/[id].get')).default
  const pickTasksPost = (await import('../../server/api/wms/pick-tasks/index.post')).default
  const pickAssign = (await import('../../server/api/wms/pick-tasks/[id]/assign.post')).default
  const pickComplete = (await import('../../server/api/wms/pick-tasks/[id]/complete.post')).default
  // Phase 5 — Telematics, Procurement, Stock-ops, Warranty
  const telemetryGet = (await import('../../server/api/telematics/index.get')).default
  const telemetryFirmware = (await import('../../server/api/telematics/firmware.post')).default
  const procurementGet = (await import('../../server/api/procurement/index.get')).default
  const procurementSuppliers = (await import('../../server/api/procurement/suppliers.get')).default
  const procurementReorder = (await import('../../server/api/procurement/reorder.get')).default
  const procurementDetail = (await import('../../server/api/procurement/[id].get')).default
  const procurementPost = (await import('../../server/api/procurement/index.post')).default
  const procurementReceive = (await import('../../server/api/procurement/[id]/receive.post')).default
  const transfersGet = (await import('../../server/api/stock-ops/transfers/index.get')).default
  const transfersPost = (await import('../../server/api/stock-ops/transfers/index.post')).default
  const transferComplete = (await import('../../server/api/stock-ops/transfers/[id]/complete.post')).default
  const countsGet = (await import('../../server/api/stock-ops/counts/index.get')).default
  const countsPost = (await import('../../server/api/stock-ops/counts/index.post')).default
  const countPost = (await import('../../server/api/stock-ops/counts/[id]/post.post')).default
  const warrantyGet = (await import('../../server/api/warranty/index.get')).default
  const warrantyPost = (await import('../../server/api/warranty/index.post')).default
  const warrantyVoid = (await import('../../server/api/warranty/[id]/void.post')).default

  router.post('/api/auth/login', eventHandler(login))
  router.post('/api/auth/logout', eventHandler(logout))
  router.get('/api/auth/me', eventHandler(me))
  router.get('/api/dashboard', eventHandler(dashboard))
  router.get('/api/vin/:vin', eventHandler(vin))
  router.get('/api/parts', eventHandler(parts))
  router.get('/api/orders', eventHandler(ordersGet))
  router.post('/api/orders', eventHandler(ordersPost))
  router.get('/api/orders/:id', eventHandler(orderDetail))
  router.post('/api/orders/:id/cancel', eventHandler(ordersCancel))
  router.get('/api/warehouse', eventHandler(warehouseGet))
  router.patch('/api/warehouse/:id', eventHandler(warehousePatch))
  router.get('/api/claims', eventHandler(claimsGet))
  router.post('/api/claims', eventHandler(claimsPost))
  router.get('/api/dealers', eventHandler(dealers))
  router.get('/api/returns', eventHandler(returnsGet))
  router.post('/api/returns', eventHandler(returnsPost))
  router.post('/api/returns/:id/decision', eventHandler(returnsDecision))
  router.get('/api/masters/:entity', eventHandler(mastersGet))
  router.post('/api/masters/:entity', eventHandler(mastersPost))
  router.put('/api/masters/:entity/:id', eventHandler(mastersPut))
  router.delete('/api/masters/:entity/:id', eventHandler(mastersDelete))
  router.get('/api/reports/sales-by-dealer', eventHandler(rptSalesByDealer))
  router.get('/api/reports/sales-by-category', eventHandler(rptSalesByCategory))
  router.get('/api/reports/sales-by-region', eventHandler(rptSalesByRegion))
  router.get('/api/reports/open-orders-aging', eventHandler(rptOpenOrdersAging))
  router.get('/api/reports/top-parts', eventHandler(rptTopParts))
  router.get('/api/reports/stock-on-hand', eventHandler(rptStockOnHand))
  router.get('/api/reports/low-stock', eventHandler(rptLowStock))
  router.get('/api/reports/inventory-valuation', eventHandler(rptInventoryValuation))
  router.get('/api/reports/credit-utilization', eventHandler(rptCreditUtilization))
  router.get('/api/reports/credit-risk', eventHandler(rptCreditRisk))
  router.get('/api/reports/claims-by-status', eventHandler(rptClaimsByStatus))
  router.get('/api/reports/claim-rate-by-part', eventHandler(rptClaimRateByPart))
  router.get('/api/reports/claims-by-model', eventHandler(rptClaimsByModel))
  router.get('/api/reports/dealer-mix-by-grade', eventHandler(rptDealerMixByGrade))
  router.get('/api/reports/autologic-install', eventHandler(rptAutologicInstall))
  // Phase E — notifications, tracking, jobs
  router.get('/api/notifications', eventHandler(notificationsGet))
  router.post('/api/notifications/read-all', eventHandler(notificationsReadAll))
  router.post('/api/notifications/:id/read', eventHandler(notificationRead))
  router.get('/api/orders/:id/tracking', eventHandler(orderTracking))
  router.post('/api/jobs/:name/run', eventHandler(jobRun))
  // Phase F — hardening
  router.get('/api/health', eventHandler(health))
  router.post('/api/auth/seed-demo', eventHandler(seedDemo))
  // Phase G — payments / AR + user management
  router.get('/api/payments', eventHandler(paymentsGet))
  router.post('/api/payments', eventHandler(paymentsPost))
  router.get('/api/reports/ar-aging', eventHandler(rptArAging))
  router.get('/api/users', eventHandler(usersGet))
  router.post('/api/users', eventHandler(usersPost))
  router.put('/api/users/:id', eventHandler(usersPut))
  router.post('/api/users/:id/reset-password', eventHandler(usersResetPassword))
  router.get('/api/addresses', eventHandler(addressesGet))
  router.post('/api/addresses', eventHandler(addressesPost))
  router.put('/api/addresses/:id', eventHandler(addressesPut))
  router.delete('/api/addresses/:id', eventHandler(addressesDelete))
  router.get('/api/wms/locations', eventHandler(locationsGet))
  router.post('/api/wms/locations', eventHandler(locationsPost))
  router.put('/api/wms/locations/:id', eventHandler(locationsPut))
  router.delete('/api/wms/locations/:id', eventHandler(locationsDelete))
  router.get('/api/wms/movements', eventHandler(movementsGet))
  router.post('/api/wms/movements', eventHandler(movementsPost))
  router.get('/api/wms/pick-tasks', eventHandler(pickTasksGet))
  router.get('/api/wms/pick-tasks/:id', eventHandler(pickTaskGet))
  router.post('/api/wms/pick-tasks', eventHandler(pickTasksPost))
  router.post('/api/wms/pick-tasks/:id/assign', eventHandler(pickAssign))
  router.post('/api/wms/pick-tasks/:id/complete', eventHandler(pickComplete))
  router.get('/api/telematics', eventHandler(telemetryGet))
  router.post('/api/telematics/firmware', eventHandler(telemetryFirmware))
  router.get('/api/procurement/suppliers', eventHandler(procurementSuppliers))
  router.get('/api/procurement/reorder', eventHandler(procurementReorder))
  router.get('/api/procurement', eventHandler(procurementGet))
  router.get('/api/procurement/:id', eventHandler(procurementDetail))
  router.post('/api/procurement', eventHandler(procurementPost))
  router.post('/api/procurement/:id/receive', eventHandler(procurementReceive))
  router.get('/api/stock-ops/transfers', eventHandler(transfersGet))
  router.post('/api/stock-ops/transfers', eventHandler(transfersPost))
  router.post('/api/stock-ops/transfers/:id/complete', eventHandler(transferComplete))
  router.get('/api/stock-ops/counts', eventHandler(countsGet))
  router.post('/api/stock-ops/counts', eventHandler(countsPost))
  router.post('/api/stock-ops/counts/:id/post', eventHandler(countPost))
  router.get('/api/warranty', eventHandler(warrantyGet))
  router.post('/api/warranty', eventHandler(warrantyPost))
  router.post('/api/warranty/:id/void', eventHandler(warrantyVoid))

  app.use(router)

  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`
  return baseUrl
}

export async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
    baseUrl = ''
  }
}

export interface ApiResponse<T = unknown> {
  status: number
  body: T
  cookie: string | null
}

/** A tiny client that carries a single session cookie across calls. */
export class Client {
  cookie: string | null = null

  async req<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (this.cookie) headers['cookie'] = this.cookie
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]! // keep "name=value"
    let parsed: unknown
    const text = await res.text()
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    return { status: res.status, body: parsed as T, cookie: this.cookie }
  }

  get<T = unknown>(path: string) {
    return this.req<T>('GET', path)
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.req<T>('POST', path, body)
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.req<T>('PATCH', path, body)
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.req<T>('PUT', path, body)
  }
  delete<T = unknown>(path: string, body?: unknown) {
    return this.req<T>('DELETE', path, body)
  }
}

/** Log in a demo user and return a Client carrying their session. */
export async function loginAs(email: string, password = 'demo1234'): Promise<Client> {
  const c = new Client()
  const r = await c.post('/api/auth/login', { email, password })
  if (r.status !== 200) {
    throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`)
  }
  return c
}
