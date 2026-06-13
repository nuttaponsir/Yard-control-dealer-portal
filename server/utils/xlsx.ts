// ============================================================================
// Excel (.xlsx) helpers — Phase K (Excel import/export across modules).
// ----------------------------------------------------------------------------
// A thin, dependency-light wrapper around exceljs so every module exports and
// imports spreadsheets the same way. Column `key`s double as the header text so
// a file exported from a module round-trips cleanly back through its importer.
// ============================================================================
import ExcelJS from 'exceljs'
import type { H3Event } from 'h3'

export interface XlsxColumn {
  /** Machine key — matches the row object key AND the rendered header text. */
  key: string
  /** Human header. Defaults to `key` when omitted (keeps import round-trippable). */
  header?: string
  width?: number
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Build an .xlsx Buffer from column defs + plain row objects. */
export async function buildXlsx(
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
  sheetName = 'Sheet1',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Dealer Portal'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName)
  ws.columns = columns.map((c) => ({
    header: c.header ?? c.key,
    key: c.key,
    width: c.width ?? Math.max(12, (c.header ?? c.key).length + 4),
  }))
  for (const row of rows) {
    // Normalise undefined → null so exceljs leaves the cell blank, not "undefined".
    const clean: Record<string, unknown> = {}
    for (const c of columns) clean[c.key] = row[c.key] ?? null
    ws.addRow(clean)
  }
  // Bold + frozen header row.
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

/** Set download headers and return the buffer as the handler response. */
export function sendXlsx(event: H3Event, buf: Buffer, filename: string): Buffer {
  setHeader(event, 'Content-Type', XLSX_MIME)
  setHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  return buf
}

/**
 * Read the first worksheet of an .xlsx buffer into header keys + row objects.
 * Row 1 is treated as the header. Blank rows are skipped. Cell values keep
 * their native type (numbers stay numbers, booleans stay booleans).
 */
export async function parseXlsx(
  buffer: Buffer | ArrayBuffer,
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const wb = new ExcelJS.Workbook()
  // exceljs accepts a Node Buffer; cast around @types/node's generic Buffer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any)
  const ws = wb.worksheets[0]
  if (!ws) return { headers: [], rows: [] }

  const headers: string[] = []
  const headerRow = ws.getRow(1)
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col - 1] = cellText(cell.value)
  })

  const rows: Record<string, unknown>[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: Record<string, unknown> = {}
    let hasValue = false
    headers.forEach((key, idx) => {
      if (!key) return
      const v = normaliseCell(row.getCell(idx + 1).value)
      if (v !== null && v !== '') hasValue = true
      obj[key] = v
    })
    if (hasValue) rows.push(obj)
  })

  return { headers: headers.filter(Boolean), rows }
}

/** Stringify a header cell (handles rich text / formula result objects). */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (typeof o.text === 'string') return o.text
    if (o.result != null) return String(o.result)
  }
  return String(v).trim()
}

/** Coerce a data cell to a primitive: number | boolean | string | null. */
function normaliseCell(v: ExcelJS.CellValue): unknown {
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((r) => r.text).join('')
    if (o.result != null) return o.result
    if (typeof o.text === 'string') return o.text
  }
  const s = String(v).trim()
  return s === '' ? null : s
}
