// POST /api/jobs/[name]/run — Phase E. Admin-only manual trigger for a scheduled
// job (low-stock | credit-risk | daily-summary). Runs the job now, which emits
// the matching admin notification, and returns the computed summary. The same
// JOBS registry is what a production scheduler (cron / Nitro task) invokes.
import { JOBS, type JobName } from '../../../utils/jobs'
import { requireUser } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['admin'])

  const name = getRouterParam(event, 'name') as JobName
  const job = JOBS[name]
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบงานตามชื่อที่ระบุ' })
  }

  const result = await job()
  await writeAudit(user.id, 'job.run', 'system', name, JSON.stringify(result))
  return { job: name, result }
})
