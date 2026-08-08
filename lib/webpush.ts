// ═══════════════════════════════════════════════════════════════════
// Web Push sender — free order-ready notification path, no external
// account needed (unlike WhatsApp, see lib/whatsapp.ts). Uses the
// `web-push` package, which needs real Node crypto internals — this is
// why any route that imports this file must run on the Node.js runtime,
// NOT edge (`export const runtime = 'edge'` must be absent/removed there).
//
// Subscriptions are scoped to one order (see migration-push-subscriptions),
// not a persistent customer identity, so this is called with an order_id
// and pushes to every browser that subscribed to THAT order.
// ═══════════════════════════════════════════════════════════════════
import webpush from 'web-push'
import { sql } from '@/lib/db'

export function webPushConfigured(): boolean {
  return !!(process.env.WEB_PUSH_VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY)
}

function configureVapid() {
  webpush.setVapidDetails(
    process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:contact@servio.tn',
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY!,
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY!,
  )
}

export async function sendOrderReadyPush(orderId: number, payload: { title: string; body: string; url?: string }) {
  if (!webPushConfigured()) return { ok: false, skipped: true, reason: 'not-configured' }

  const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE order_id = ${orderId}`
  if (!subs.length) return { ok: false, skipped: true, reason: 'no-subscriptions' }

  configureVapid()
  let sent = 0
  const deadIds: number[] = []

  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e: any) {
      // 404/410 = the browser unsubscribed or the endpoint expired — clean it
      // up so future orders don't keep trying a dead subscription forever.
      if (e?.statusCode === 404 || e?.statusCode === 410) deadIds.push(s.id)
    }
  }))

  if (deadIds.length) {
    await sql`DELETE FROM push_subscriptions WHERE id = ANY(${deadIds})`.catch(() => {})
  }

  return { ok: sent > 0, sent, total: subs.length }
}
