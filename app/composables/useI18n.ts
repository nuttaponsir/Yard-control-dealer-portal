// ============================================================================
// useI18n() — minimal TH/EN dictionary lookup (Dev4 fleshes out locales).
// SHARED contract: components call t('nav.vin'); Dev4 expands app/locales/*.
// ============================================================================
import { computed } from 'vue'
import { th } from '~/locales/th'
import { en } from '~/locales/en'

export type Lang = 'th' | 'en'

export function useI18n() {
  const lang = useState<Lang>('i18n:lang', () => 'th')
  const dict = computed(() => (lang.value === 'th' ? th : en))

  function t(key: string, params?: Record<string, string | number>): string {
    let str = (dict.value as Record<string, string>)[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      }
    }
    return str
  }
  function toggle() {
    lang.value = lang.value === 'th' ? 'en' : 'th'
  }
  return { lang, t, toggle }
}
