// POST /api/wms/pick-tasks — Phase 3 (WMS). Manually generate (or return the
// existing live) pick task for an order. admin/warehouse only. Delegates to the
// SA-owned generatePickForOrder helper, which is idempotent and throws 404 when
// the order is missing — we let that propagate.
import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { parseBody } from '../../../utils/validation'
import { generatePickForOrder } from '../../../utils/wms'

const generateSchema = z.object({
  orderId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin', 'warehouse'])

  const { orderId } = await parseBody(event, generateSchema)

  const result = await generatePickForOrder(orderId, user.id)

  return { ok: true, pickTask: result.pickTask, created: result.created }
})
