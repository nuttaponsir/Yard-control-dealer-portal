// i18n key-parity guard (#10). The TH and EN dictionaries must expose the exact
// same key set — a key present in one but not the other means a screen falls
// back to the raw key string in that language. This catches drift whenever a
// feature adds copy to only one locale.
import { describe, it, expect } from 'vitest'
import { th } from '~/locales/th'
import { en } from '~/locales/en'

describe('i18n TH/EN parity', () => {
  const thKeys = Object.keys(th).sort()
  const enKeys = Object.keys(en).sort()

  it('TH and EN have identical key sets', () => {
    const missingInEn = thKeys.filter((k) => !(k in en))
    const missingInTh = enKeys.filter((k) => !(k in th))
    expect(missingInEn, `keys in TH but missing in EN: ${missingInEn.join(', ')}`).toEqual([])
    expect(missingInTh, `keys in EN but missing in TH: ${missingInTh.join(', ')}`).toEqual([])
  })

  it('no empty values in either locale', () => {
    const emptyTh = thKeys.filter((k) => !th[k]?.trim())
    const emptyEn = enKeys.filter((k) => !en[k]?.trim())
    expect(emptyTh, `empty TH values: ${emptyTh.join(', ')}`).toEqual([])
    expect(emptyEn, `empty EN values: ${emptyEn.join(', ')}`).toEqual([])
  })
})
