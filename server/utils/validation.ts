import { z } from 'zod'

// ============================================================================
// Mitsubishi Dealer Portal — request-body validation (zod)
// ----------------------------------------------------------------------------
// REFERENCE PATTERN for dev agents. The login schema below is fully wired in
// server/api/auth/login.post.ts — copy this shape for module endpoints:
//   1. define a z.object() schema next to the route (or here for shared ones),
//   2. call `parseBody(event, schema)` and let it throw a typed 400.
// ============================================================================

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

/**
 * Read + validate an H3 request body against a zod schema.
 * Throws a 400 createError carrying the zod issues in `data` on failure.
 */
export async function parseBody<T extends z.ZodTypeAny>(
  event: import('h3').H3Event,
  schema: T,
): Promise<z.infer<T>> {
  const body = await readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: { issues: result.error.issues },
    })
  }
  return result.data
}
