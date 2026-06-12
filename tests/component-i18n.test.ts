// @vitest-environment happy-dom
// Test2 (QA). useI18n() TH/EN toggle test. Maps to AC-0.5 (TH/EN toggle switches
// language; Thai is the default).
import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'

// Nuxt useState shim (keyed shared ref).
const __store = new Map<string, ReturnType<typeof ref>>()
;(globalThis as any).useState = (key: string, init: () => unknown) => {
  if (!__store.has(key)) __store.set(key, ref(init()))
  return __store.get(key)!
}

const { useI18n } = await import('~/composables/useI18n')

describe('useI18n', () => {
  beforeEach(() => {
    // reset to default by toggling back to 'th' if needed
    const { lang } = useI18n()
    if (lang.value !== 'th') useI18n().toggle()
  })

  it('AC-0.5: Thai is the default language', () => {
    expect(useI18n().lang.value).toBe('th')
    expect(useI18n().t('nav.vin')).toBe('ตรวจสอบ VIN')
  })

  it('AC-0.5: toggling switches a known key to its English string', () => {
    const i18n = useI18n()
    expect(i18n.t('nav.vin')).toBe('ตรวจสอบ VIN')
    i18n.toggle()
    expect(i18n.lang.value).toBe('en')
    expect(i18n.t('nav.vin')).toBe('VIN Check')
  })

  it('toggling twice returns to Thai', () => {
    const i18n = useI18n()
    i18n.toggle()
    i18n.toggle()
    expect(i18n.lang.value).toBe('th')
    expect(i18n.t('nav.orders')).toBe('คำสั่งซื้อ')
  })

  it('falls back to the key when the dictionary has no entry', () => {
    expect(useI18n().t('does.not.exist')).toBe('does.not.exist')
  })

  it('shares language state across composable instances', () => {
    useI18n().toggle() // -> en
    expect(useI18n().lang.value).toBe('en')
  })
})
