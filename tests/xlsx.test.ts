// Phase K — unit tests for the Excel helper that every module's import/export
// hangs on. buildXlsx → parseXlsx must round-trip values with their native
// types preserved and blank rows dropped. (Endpoint wiring + RBAC are covered
// by live verification; this locks the pure serialise/parse core.)
import { describe, it, expect } from 'vitest'
import { buildXlsx, parseXlsx } from '../server/utils/xlsx'

describe('buildXlsx → parseXlsx round-trip', () => {
  it('preserves headers and native cell types', async () => {
    const columns = [{ key: 'code' }, { key: 'qty' }, { key: 'active' }, { key: 'note' }]
    const rows = [
      { code: 'A1', qty: 5, active: true, note: 'hello' },
      { code: 'B2', qty: 0, active: false, note: 'ทดสอบ' },
    ]
    const buf = await buildXlsx(columns, rows, 'sheet')
    const out = await parseXlsx(buf)

    expect(out.headers).toEqual(['code', 'qty', 'active', 'note'])
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]).toMatchObject({ code: 'A1', qty: 5, active: true, note: 'hello' })
    // Thai text survives the round-trip; numbers stay numbers (not strings).
    expect(out.rows[1]!.note).toBe('ทดสอบ')
    expect(typeof out.rows[1]!.qty).toBe('number')
    expect(typeof out.rows[0]!.active).toBe('boolean')
  })

  it('writes null for missing keys and drops fully-blank rows on read', async () => {
    const columns = [{ key: 'code' }, { key: 'name' }]
    const rows = [{ code: 'X' }] // name missing → blank cell
    const buf = await buildXlsx(columns, rows)
    const out = await parseXlsx(buf)
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]!.code).toBe('X')
    expect(out.rows[0]!.name).toBeNull()
  })

  it('produces a non-empty .xlsx buffer even with zero rows', async () => {
    const buf = await buildXlsx([{ key: 'code' }], [], 'empty')
    expect(buf.byteLength).toBeGreaterThan(0)
    const out = await parseXlsx(buf)
    expect(out.headers).toEqual(['code'])
    expect(out.rows).toEqual([])
  })
})
