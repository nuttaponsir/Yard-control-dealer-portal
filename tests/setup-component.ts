// Component-test setup (happy-dom project). Nuxt auto-imports aren't present
// when mounting bare SFCs, so shim the two the shared components rely on:
//   • useState — keyed shared ref (backs useI18n's lang).
//   • useI18n  — the real app composable, so t('...') returns actual locale
//     strings (defaults to Thai), keeping component assertions meaningful.
import { ref } from 'vue'
import { useI18n } from '../app/composables/useI18n'

const store = new Map<string, ReturnType<typeof ref>>()
;(globalThis as Record<string, unknown>).useState = (key: string, init: () => unknown) => {
  if (!store.has(key)) store.set(key, ref(init()))
  return store.get(key)!
}
;(globalThis as Record<string, unknown>).useI18n = useI18n
