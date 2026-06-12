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
