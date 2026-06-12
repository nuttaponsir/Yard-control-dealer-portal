// ============================================================================
// Phase E — outbound channel providers (the integration seam)
// ----------------------------------------------------------------------------
// Pluggable providers for each delivery channel. In dev/test these are "log"
// providers: they record the dispatch and succeed deterministically, so the
// notification pipeline is fully exercisable without real SMTP / LINE creds.
// Production (Phase F) swaps these for a real mail client + LINE Messaging API
// via setProvider() — nothing else in the pipeline changes.
// ============================================================================
import type { NotificationChannel } from '../../app/types'

export interface OutboundMessage {
  channel: NotificationChannel
  to: string // email address, or LINE user ref
  title: string
  body: string
}

export type ChannelProvider = (msg: OutboundMessage) => Promise<boolean>

function logProvider(label: string): ChannelProvider {
  return async (msg) => {
    // Real SMTP / LINE client goes here. Mock: optionally log, always succeed.
    if (process.env.DP_NOTIFY_DEBUG) {
      console.log(`[notify:${label}] → ${msg.to} :: ${msg.title}`)
    }
    return true
  }
}

const providers: Record<NotificationChannel, ChannelProvider> = {
  inapp: async () => true, // in-app rows need no external dispatch
  email: logProvider('email'),
  line: logProvider('line'),
}

/** Swap a channel provider (used by production wiring or tests). */
export function setProvider(channel: NotificationChannel, p: ChannelProvider) {
  providers[channel] = p
}

/** Dispatch one message; never throws — returns false on provider failure. */
export async function dispatch(msg: OutboundMessage): Promise<boolean> {
  try {
    return await providers[msg.channel](msg)
  } catch {
    return false
  }
}
