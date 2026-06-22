// ============================================================================
// useBrand() — the configurable brand logo (SHARED). Reads /api/brand (public)
// once and shares it app-wide. logoUrl is null when unset → the sidebar / login
// fall back to the built-in JWD wordmark. Set it in Settings → brand_logo_url.
// ============================================================================
export function useBrand() {
  const logoUrl = useState<string | null>('brand:logoUrl', () => null)
  const loaded = useState<boolean>('brand:loaded', () => false)

  async function load() {
    if (loaded.value) return
    try {
      const { logoUrl: url } = await $fetch<{ logoUrl: string | null }>('/api/brand')
      logoUrl.value = url
    } catch {
      logoUrl.value = null
    } finally {
      loaded.value = true
    }
  }

  return { logoUrl, load }
}
