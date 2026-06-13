// PUT /api/settings — admin only. Accepts { values: { key: value, ... } } and
// upserts each into appConfig. Only catalog keys are accepted (unknown keys →
// 400); every value is validated against its catalog type/enum/bounds so the
// table can never hold a value the readers can't coerce. Audited.
import { z } from 'zod'
import { db, schema } from '../../db'
import { requireUser } from '../../utils/auth'
import { parseBody } from '../../utils/validation'
import { writeAudit } from '../../utils/audit'
import { SETTINGS } from '../../utils/config'

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]))

const bodySchema = z.object({
  values: z.record(z.string(), z.string()),
})

/** Validate one value against its catalog definition; returns the normalised
 *  string to store, or throws a 400 with a Thai message. */
function validate(key: string, raw: string): string {
  const def = BY_KEY.get(key)
  if (!def) throw createError({ statusCode: 400, statusMessage: `ไม่รู้จักค่าตั้งค่า: ${key}` })
  const v = raw.trim()
  switch (def.type) {
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n)) {
        throw createError({ statusCode: 400, statusMessage: `${def.label}: ต้องเป็นตัวเลข` })
      }
      if (def.min != null && n < def.min) {
        throw createError({ statusCode: 400, statusMessage: `${def.label}: ต้องไม่น้อยกว่า ${def.min}` })
      }
      if (def.max != null && n > def.max) {
        throw createError({ statusCode: 400, statusMessage: `${def.label}: ต้องไม่เกิน ${def.max}` })
      }
      return String(n)
    }
    case 'enum': {
      const ok = def.options?.some((o) => o.value === v)
      if (!ok) throw createError({ statusCode: 400, statusMessage: `${def.label}: ค่าไม่ถูกต้อง` })
      return v
    }
    case 'boolean':
      return v === 'true' ? 'true' : 'false'
    default:
      return v
  }
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])
  const { values } = await parseBody(event, bodySchema)

  const entries = Object.entries(values)
  if (entries.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ไม่มีค่าที่จะบันทึก' })
  }

  // Validate everything before writing anything.
  const clean = entries.map(([key, raw]) => ({ key, value: validate(key, raw) }))

  await db.transaction(async (tx) => {
    for (const row of clean) {
      await tx
        .insert(schema.appConfig)
        .values(row)
        .onConflictDoUpdate({ target: schema.appConfig.key, set: { value: row.value } })
    }
  })

  await writeAudit(
    user.id,
    'settings.update',
    'system',
    'settings',
    clean.map((c) => `${c.key}=${c.value}`).join(' '),
  )

  return { ok: true, updated: clean.length }
})
