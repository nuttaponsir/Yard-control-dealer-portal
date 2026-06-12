// ============================================================================
// Global route protection (SHARED; SA owns).
//  - Resolves the session (server + client) via useAuth().fetchMe().
//  - Unauthenticated users are redirected to /auth.
//  - Role-gated routes (declared in useNav()) redirect disallowed roles to
//    /dashboard.
// ============================================================================
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchMe, can } = useAuth()

  // Resolve the session once if we don't have it yet (runs on server + client).
  if (user.value == null) {
    try {
      await fetchMe()
    } catch {
      /* no session */
    }
  }

  // /auth is always reachable; bounce authed users to the dashboard.
  if (to.path === '/auth') {
    if (user.value) return navigateTo('/dashboard')
    return
  }

  if (!user.value) return navigateTo('/auth')

  // Role-gate routes declared in the nav.
  for (const item of useNav()) {
    const match = to.path === item.to || to.path.startsWith(item.to + '/')
    if (match && item.roles && !can(item.roles)) {
      return navigateTo('/dashboard')
    }
  }
})
