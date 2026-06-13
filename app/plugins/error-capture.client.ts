// ============================================================================
// Phase H — client-side auto error capture (SHARED).
// ----------------------------------------------------------------------------
// Listens for the four ways a front-end error surfaces and files a DRAFT issue
// for each one, recording:
//   • ระบบ (module)  — derived from the current route's first segment
//   • หน้า (page)    — the full route path
//   • ปุ่ม (action)  — the last button/link the user clicked, or the failing
//                       API endpoint+method for fetch errors
//   • ใครทำ (user)   — resolved server-side from the session cookie
//   • ภาพ (screenshot) — an html2canvas snapshot of the viewport (lazy-loaded,
//                        scaled down, JPEG) attached to the report
//
// Hardening:
//   • never reports its own POST /api/issues (no infinite loop)
//   • de-dupes identical errors within a short window
//   • a re-entrancy guard prevents a capture from triggering another capture
//   • all work is best-effort: a failure here is swallowed, never re-thrown
// ============================================================================
import type { RouteLocationNormalizedLoaded } from 'vue-router'

interface ReportInput {
  source: 'api' | 'unhandled' | 'rejection' | 'vue' | 'manual'
  message: string
  stack?: string | null
  action?: string | null
  detail?: Record<string, unknown> | null
  severity?: 'error' | 'warning' | 'info'
}

export default defineNuxtPlugin((nuxtApp) => {
  if (import.meta.server) return

  const router = useRouter()

  // ---- "ปุ่มไหน": remember the last meaningful control the user activated ---
  let lastAction: string | null = null
  function describeEl(el: Element | null): string | null {
    if (!el) return null
    const ctl = el.closest('button, a, [role="button"], [type="submit"], input, select')
    if (!ctl) return null
    const tag = ctl.tagName.toLowerCase()
    const label =
      (ctl.getAttribute('aria-label') ||
        (ctl as HTMLElement).innerText ||
        ctl.getAttribute('title') ||
        ctl.getAttribute('name') ||
        ctl.getAttribute('placeholder') ||
        '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80)
    return label ? `${tag}: "${label}"` : tag
  }
  window.addEventListener(
    'click',
    (e) => {
      const a = describeEl(e.target as Element)
      if (a) lastAction = a
    },
    { capture: true },
  )

  // ---- module from route ---------------------------------------------------
  function moduleFromRoute(route: RouteLocationNormalizedLoaded): string | null {
    const seg = (route.path || '').split('/').filter(Boolean)[0]
    return seg || 'dashboard'
  }

  // ---- de-dupe + re-entrancy ----------------------------------------------
  const recent = new Map<string, number>()
  const DEDUPE_MS = 5000
  let capturing = false
  function seenRecently(sig: string): boolean {
    const now = Date.now()
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k)
    if (recent.has(sig)) return true
    recent.set(sig, now)
    return false
  }

  // ---- screenshot (lazy) ---------------------------------------------------
  // modern-screenshot serialises the DOM into an SVG <foreignObject> and lets
  // the BROWSER paint it, so it natively supports Tailwind v4's oklch/oklab
  // colours (html2canvas re-implements CSS parsing and chokes on them).
  async function snapshot(): Promise<string | null> {
    try {
      const { domToJpeg } = await import('modern-screenshot')
      return await domToJpeg(document.body, {
        quality: 0.6,
        // Cap the device-pixel scale so the base64 payload stays small.
        scale: Math.min(0.6, window.devicePixelRatio || 1),
        backgroundColor: '#0a0a0a',
        // Don't let one un-fetchable asset abort the whole capture.
        fetch: { requestInit: { cache: 'force-cache' } },
      })
    } catch (err) {
      console.warn('[error-capture] screenshot failed', err)
      return null
    }
  }

  // ---- the reporter --------------------------------------------------------
  async function report(input: ReportInput): Promise<void> {
    if (capturing) return
    const sig = `${input.source}|${input.message}`.slice(0, 200)
    if (seenRecently(sig)) return

    capturing = true
    try {
      const route = router.currentRoute.value
      const screenshot = await snapshot()
      await $fetch('/api/issues', {
        method: 'POST',
        body: {
          source: input.source,
          severity: input.severity ?? 'error',
          message: input.message.slice(0, 2000),
          stack: input.stack ? String(input.stack).slice(0, 8000) : null,
          module: moduleFromRoute(route),
          page: route.fullPath,
          action: input.action ?? lastAction,
          detail: input.detail
            ? JSON.stringify({ ...input.detail, userAgent: navigator.userAgent }).slice(0, 8000)
            : JSON.stringify({ userAgent: navigator.userAgent }),
          screenshot,
        },
      })
    } catch (err) {
      // Never let the reporter's own failure bubble up.
      console.warn('[error-capture] failed to file issue', err)
    } finally {
      capturing = false
    }
  }

  // Extract endpoint/method/status from an ofetch FetchError, if that's what
  // this is. Returns null for non-fetch errors.
  function asFetchError(
    e: unknown,
  ): { endpoint: string; method: string; status: number | null } | null {
    if (!e || typeof e !== 'object') return null
    const any = e as Record<string, any>
    const req = any.request ?? any.response?.url
    if (req == null && any.statusCode == null) return null
    const endpoint =
      typeof req === 'string' ? req : (req?.url ?? any.response?.url ?? 'unknown')
    const method = (any.options?.method ?? any.request?.method ?? 'GET').toUpperCase()
    const status = any.statusCode ?? any.response?.status ?? null
    return { endpoint: String(endpoint), method, status }
  }

  // Calls to the issue sink itself must never be reported (recursion guard).
  function isSelfReport(endpoint: string | undefined): boolean {
    return !!endpoint && endpoint.includes('/api/issues')
  }

  // ---- 1) Vue render / lifecycle errors -----------------------------------
  nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => {
    const e = err as Error
    const fe = asFetchError(err)
    if (fe && isSelfReport(fe.endpoint)) return
    void report({
      source: fe ? 'api' : 'vue',
      message: e?.message ? `${e.message}${info ? ` (${info})` : ''}` : String(err),
      stack: e?.stack ?? null,
      action: fe ? `${fe.method} ${fe.endpoint}` : null,
      detail: fe ? { endpoint: fe.endpoint, method: fe.method, status: fe.status, info } : { info },
    })
    // Preserve default behaviour: still log it.
    console.error('[vue:error]', err)
  }

  // ---- 2) Uncaught synchronous errors -------------------------------------
  window.addEventListener('error', (ev) => {
    if (ev.error || ev.message) {
      void report({
        source: 'unhandled',
        message: ev.message || String(ev.error),
        stack: (ev.error as Error)?.stack ?? null,
        detail: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
      })
    }
  })

  // ---- 3) Unhandled promise rejections (covers awaited $fetch) ------------
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    const fe = asFetchError(reason)
    if (fe && isSelfReport(fe.endpoint)) return
    const msg =
      (reason as Error)?.message ??
      (typeof reason === 'string' ? reason : JSON.stringify(reason))
    void report({
      source: fe ? 'api' : 'rejection',
      message: fe ? `${fe.method} ${fe.endpoint} → ${fe.status ?? 'error'}: ${msg}` : String(msg),
      stack: (reason as Error)?.stack ?? null,
      action: fe ? `${fe.method} ${fe.endpoint}` : null,
      detail: fe ? { endpoint: fe.endpoint, method: fe.method, status: fe.status } : null,
    })
  })

  // ---- manual reporter, exposed for pages' catch blocks --------------------
  // Usage in a page:  const { $reportIssue } = useNuxtApp(); $reportIssue(err, { action })
  return {
    provide: {
      reportIssue: (err: unknown, opts?: { action?: string; severity?: ReportInput['severity'] }) => {
        const e = err as Error
        const fe = asFetchError(err)
        void report({
          source: 'manual',
          severity: opts?.severity ?? 'error',
          message: e?.message ?? String(err),
          stack: e?.stack ?? null,
          action: opts?.action ?? (fe ? `${fe.method} ${fe.endpoint}` : null),
          detail: fe ? { endpoint: fe.endpoint, method: fe.method, status: fe.status } : null,
        })
      },
    },
  }
})
