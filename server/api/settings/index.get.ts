// GET /api/settings — admin only. Returns the typed config catalog merged with
// the current appConfig values (missing rows fall back to the catalog default),
// so the Settings page can render grouped, typed inputs without a second call.
import { requireUser } from '../../utils/auth'
import { SETTINGS, getConfigMap } from '../../utils/config'

export default defineEventHandler(async (event) => {
  await requireUser(event, ['admin'])

  const values = await getConfigMap(SETTINGS.map((s) => s.key))
  const settings = SETTINGS.map((s) => ({ ...s, value: values[s.key]! }))
  return { ok: true, settings }
})
