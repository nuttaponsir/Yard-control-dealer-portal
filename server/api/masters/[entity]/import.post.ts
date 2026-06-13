// POST /api/masters/:entity/import — bulk-create rows from an uploaded .xlsx.
// Admin only; read-only masters → 403. Multipart form with a single `file`.
//   ?mode=preview (default) — validate every row, write nothing, return a
//                             summary + per-row errors so the UI can confirm.
//   ?mode=commit            — insert the valid rows in one transaction.
// Each row is validated through the entity's Zod create schema (unknown columns
// like id/createdAt are stripped) and passed through prepareCreate on insert.
import { db } from '../../../db'
import { requireUser } from '../../../utils/auth'
import { getMaster, assertEditable } from '../registry'
import { parseXlsx } from '../../../utils/xlsx'

interface RowError {
  row: number // 1-based data row (spreadsheet row = this + 1 for the header)
  errors: string[]
}

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const entity = getRouterParam(event, 'entity') as string
  const def = getMaster(entity)
  assertEditable(entity, def)

  const mode = getQuery(event).mode === 'commit' ? 'commit' : 'preview'

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file' && p.data?.length)
  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่พบไฟล์ที่อัปโหลด' })
  }

  let parsed: Awaited<ReturnType<typeof parseXlsx>>
  try {
    parsed = await parseXlsx(file.data)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'อ่านไฟล์ Excel ไม่สำเร็จ' })
  }

  const valid: Record<string, unknown>[] = []
  const invalid: RowError[] = []

  parsed.rows.forEach((raw, i) => {
    const result = def.create.safeParse(raw)
    if (result.success) {
      const data = result.data as Record<string, unknown>
      valid.push(def.prepareCreate ? def.prepareCreate(data) : data)
    } else {
      invalid.push({
        row: i + 1,
        errors: result.error.issues.map(
          (iss) => `${iss.path.join('.') || '(row)'}: ${iss.message}`,
        ),
      })
    }
  })

  const summary = {
    entity,
    total: parsed.rows.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 50), // cap the payload
  }

  if (mode === 'preview') {
    return { ok: true, mode, ...summary, committed: 0 }
  }

  // commit: insert valid rows transactionally; duplicates surface as a 409.
  let committed = 0
  try {
    await db.transaction(async (tx) => {
      for (const values of valid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(def.table).values(values as any)
        committed++
      }
    })
  } catch {
    throw createError({
      statusCode: 409,
      statusMessage: 'นำเข้าไม่สำเร็จ: มีข้อมูลซ้ำหรือผิดเงื่อนไข (rollback แล้ว)',
    })
  }

  return { ok: true, mode, ...summary, committed }
})
