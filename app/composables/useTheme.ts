// ============================================================================
// useTheme() — light/dark switch (SHARED). Light is the default; the choice is
// persisted to localStorage ('jwd-theme') and applied by toggling `.dark` on
// <html> (the semantic tokens in main.css key off it). An inline head script
// (nuxt.config) applies the saved value pre-paint to avoid a flash; this
// composable owns the runtime state + toggle.
// ============================================================================
export type ThemeMode = 'light' | 'dark'

export function useTheme() {
  const theme = useState<ThemeMode>('ui:theme', () => 'light')

  function apply(mode: ThemeMode) {
    theme.value = mode
    if (import.meta.client) {
      document.documentElement.classList.toggle('dark', mode === 'dark')
      try {
        localStorage.setItem('jwd-theme', mode)
      } catch {
        // ignore storage failures (private mode, etc.)
      }
    }
  }

  /** Sync state to whatever the pre-paint script already applied. */
  function init() {
    if (import.meta.client) {
      theme.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }
  }

  function toggle() {
    apply(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, apply, toggle, init }
}
