// Toggles the Mitsubishi-red portal accent on <html> per route: login +
// dealer-facing screens get `.theme-portal` (red brand ramp), operation
// screens drop it (default JWD-blue ramp). See app/assets/css/main.css and
// app/composables/useBrandTheme.ts.
export default defineNuxtPlugin(() => {
  const router = useRouter()

  const apply = (path: string) => {
    document.documentElement.classList.toggle('theme-portal', isPortalPath(path))
  }

  apply(router.currentRoute.value.path)
  router.afterEach((to) => apply(to.path))
})
