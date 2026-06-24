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

  // Role-gate routes declared in the nav. A path may be declared by more than
  // one item (e.g. /addresses is exposed to owner/sales and, separately, to
  // admin): allow when ANY matching item permits the role; redirect only if the
  // path is declared and no matching item allows this role.
  const matches = useNav().filter(
    (item) => to.path === item.to || to.path.startsWith(item.to + '/'),
  )
  if (matches.length && !matches.some((item) => !item.roles || can(item.roles))) {
    return navigateTo('/dashboard')
  }
})
