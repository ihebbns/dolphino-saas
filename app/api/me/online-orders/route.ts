// ═══════════════════════════════════════════════════
// /api/me/online-orders — the till's incoming-order queue.
//
// GET  ?key=API              → pending orders + unpaid-accepted + recent history
//                               (recent[] carries responded_by / paid_by so the
//                               manager's /orders page can show who actioned
//                               each order without any POS-local context)
// POST { key, action:'accept'|'reject', order_id, actor? }
//   → staff-driven only, never auto-transitions. 'accept' does NOT deduct
//     stock or touch sales here — the POS pulls the pending order's items
//     into a normal cart via this same GET response and completes the sale
//     through its own encaisser() flow, so accepted online orders go
//     through EXACTLY the same stock/kitchen-ticket/receipt path as an
//     order typed in by hand. This endpoint only tracks queue status.
// POST { key, action:'markPaid', order_id, actor? }
//   → online orders (phone or kiosk) never carry a payment step at
//     submission — the customer pays at the counter, same as a walk-in.
//     'markPaid' just lets staff record that it happened, separate from
//     accept/reject, so an accepted-but-unpaid order stays visible instead
//     of silently blending into "done".
// POST { key, action:'unmarkPaid', order_id }
//   → reverses markPaid — called by the till when the sale that paid for
//     this order gets voided, so the order goes back to "needs payment"
//     rather than staying marked paid for money that was refunded.
// POST { key, action:'claim'|'release', order_id, actor? }
//   → with more than one till, two cashiers could both pull the same
//     unpaid order into their cart and both complete a real sale for it —
//     duplicate stock deduction, duplicate receipt. 'claim' is the atomic
//     "I've got this one" a till takes BEFORE loading an order into the
//     cart; a second till's claim fails while the first is active. Claims
//     expire after 3 minutes (till crashed, cashier walked away mid-flow)
//     so a stuck claim can't strand an order forever, and 'release' lets
//     a till give it up early if the cashier clears the cart instead.
// POST { key, action:'markReady', order_id, actor? }
//   → orthogonal to paid — kitchen finishing an order and the customer
//     settling the bill are independent events. Lets the customer's own
//     tracking view (see /api/public/[slug]/order-status) show "ready
//     for pickup" without conflating it with payment state.
// ═══════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getApiKey } from '@/lib/auth'
import { serverError } from '@/lib/apiError'
import { notifyOrderReady } from '@/lib/orderReady'

// Node runtime, not edge — the web-push package (see lib/webpush.ts) needs
// real Node crypto internals to sign VAPID requests, which edge's Web
// Crypto subset doesn't cover. This route isn't a latency-sensitive public
// path (POS polling + admin), so the switch costs nothing that matters.

const cors = (r: NextResponse) => {
  r.headers.set('Access-Control-Allow-Origin', '*')
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key')
  return r
}
export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })) }

const clip = (v: any, n: number) => String(v ?? '').slice(0, n)

function getKey(req: Request, body?: any): string {
  return (body && body.key) || getApiKey(req) || new URL(req.url).searchParams.get('key') || ''
}

async function resolveRestaurant(key: string) {
  const rows = await sql`
    SELECT id FROM restaurants WHERE api_key = ${key} AND plan NOT IN ('suspended', 'suspended_exe') LIMIT 1`
  return rows.length ? rows[0] : null
}

export async function GET(req: Request) {
  const key = getKey(req)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))
  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    // paid is included here now that a customer can pay up front with wallet
    // balance (see /api/public/[slug]/order) — a pending order can already
    // be paid before staff ever touch it, and the till needs to know that
    // the moment it accepts, not discover it later via the unpaid queue.
    // daily_num/source feed the kitchen ticket prefix at accept time (see
    // printOnlineOrderKitchenTicket in the POS) — tolerant of either column
    // being absent (migrations not run yet) so the whole queue doesn't 500.
    let pending: any[]
    try {
      pending = await sql`
        SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note, created_at,
               table_num, table_sec, paid, paid_by, daily_num, source
        FROM online_orders
        WHERE restaurant_id = ${rest.id} AND status = 'pending'
        ORDER BY created_at ASC`
    } catch {
      pending = await sql`
        SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note, created_at,
               table_num, table_sec, paid, paid_by
        FROM online_orders
        WHERE restaurant_id = ${rest.id} AND status = 'pending'
        ORDER BY created_at ASC`
    }

    // claimed_by/claimed_at travel to the till so it can gray out a row
    // another till is actively encaissé-ing — a stale claim (>3 min) reads
    // as unclaimed here too, matching the same window 'claim' itself uses.
    // table_num IS NULL is deliberate, not redundant with paid=FALSE — a
    // table-routed order's payment is tracked by the TABLE's own checkout,
    // never by this queue. Excluding it here (not just relying on its paid
    // flag staying accurate) means even a bug elsewhere can't resurrect a
    // "🧾 Encaisser" button for money the table itself will collect —
    // the exact double-billing shape this queue exists to prevent.
    // daily_num/source travel here too now — this is where encaisserOnlineOrder()
    // reads the order it's about to check out from, and it needs the SAME
    // daily_num the customer already saw so the sale it produces carries that
    // exact number instead of drawing a fresh one from the till's own counter.
    let unpaid: any[]
    try {
      unpaid = await sql`
        SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note, responded_at, ready,
               table_num, table_sec, daily_num, source,
               CASE WHEN claimed_at > NOW() - INTERVAL '3 minutes' THEN claimed_by ELSE NULL END AS claimed_by
        FROM online_orders
        WHERE restaurant_id = ${rest.id} AND status = 'accepted' AND paid = FALSE AND table_num IS NULL
        ORDER BY responded_at ASC`
    } catch {
      unpaid = await sql`
        SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note, responded_at, ready,
               table_num, table_sec,
               CASE WHEN claimed_at > NOW() - INTERVAL '3 minutes' THEN claimed_by ELSE NULL END AS claimed_by
        FROM online_orders
        WHERE restaurant_id = ${rest.id} AND status = 'accepted' AND paid = FALSE AND table_num IS NULL
        ORDER BY responded_at ASC`
    }

    // Separate from `unpaid` on purpose — paid and ready are independent
    // (a kiosk order can be paid via wallet before the kitchen is done, or
    // accepted-and-cooking long before anyone's collected payment). Without
    // this, an order paid early would vanish from the till entirely with no
    // way left to ever mark it ready.
    // items_json included so the till can reprint this order's kitchen
    // ticket from the "En préparation" list at any point, not only in the
    // few seconds right after accepting it (before this query ever runs).
    const preparing = await sql`
      SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, responded_at, paid, table_num, table_sec
      FROM online_orders
      WHERE restaurant_id = ${rest.id} AND status = 'accepted' AND ready = FALSE
      ORDER BY responded_at ASC`

    // Includes who acted (responded_by / paid_by) and the full order, not just
    // a summary — this is what the manager's /orders audit page reads, so it
    // has to answer "who accepted this, who took the money" on its own,
    // without the POS's local session context.
    const recent = await sql`
      SELECT id, client_name, client_phone, order_type, items_json, total::float AS total, note,
             status, responded_by, responded_at, paid, paid_by, paid_at, ready, ready_by, ready_at, created_at,
             table_num, table_sec
      FROM online_orders
      WHERE restaurant_id = ${rest.id} AND status != 'pending'
      ORDER BY responded_at DESC LIMIT 100`

    return cors(NextResponse.json({ ok: true, pending, unpaid, preparing, recent }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('online-orders GET', e), { status: 500 }))
  }
}

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return cors(NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 })) }
  const key = getKey(req, body)
  if (!key) return cors(NextResponse.json({ ok: false, error: 'Clé manquante' }, { status: 400 }))

  const action = clip(body?.action, 16)
  const orderId = parseInt(String(body?.order_id))
  if (!['accept', 'reject', 'markPaid', 'unmarkPaid', 'markReady', 'claim', 'release'].includes(action) || !Number.isFinite(orderId)) {
    return cors(NextResponse.json({ ok: false, error: 'Paramètres invalides' }, { status: 400 }))
  }

  try {
    const rest = await resolveRestaurant(key)
    if (!rest) return cors(NextResponse.json({ ok: false, error: 'Compte introuvable ou suspendu' }, { status: 403 }))

    if (action === 'claim') {
      const actor = clip(body?.actor, 80)
      const res = await sql`
        UPDATE online_orders SET claimed_by = ${actor}, claimed_at = NOW()
        WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'accepted' AND paid = FALSE
          AND (claimed_by IS NULL OR claimed_at < NOW() - INTERVAL '3 minutes' OR claimed_by = ${actor})
        RETURNING id`
      if (!res.length) return cors(NextResponse.json({ ok: false, error: 'Déjà en cours d’encaissement sur une autre caisse' }, { status: 409 }))
      return cors(NextResponse.json({ ok: true }))
    }

    if (action === 'release') {
      await sql`
        UPDATE online_orders SET claimed_by = NULL, claimed_at = NULL
        WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND claimed_by = ${clip(body?.actor, 80)}`
      return cors(NextResponse.json({ ok: true }))
    }

    if (action === 'markReady') {
      // daily_num/source let us also flip the matching kds_tickets rows below —
      // tolerant of either column being absent (pre-daily_num restaurants).
      let res: any[]
      try {
        res = await sql`
          UPDATE online_orders SET ready = TRUE, ready_at = NOW(), ready_by = ${clip(body?.actor, 80)}
          WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'accepted' AND ready = FALSE
          RETURNING id, client_name, client_phone, daily_num, source`
      } catch {
        res = await sql`
          UPDATE online_orders SET ready = TRUE, ready_at = NOW(), ready_by = ${clip(body?.actor, 80)}
          WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'accepted' AND ready = FALSE
          RETURNING id, client_name, client_phone`
      }
      if (!res.length) return cors(NextResponse.json({ ok: false, error: 'Commande introuvable ou déjà prête' }, { status: 404 }))
      // The public pickup board (/ready/[slug]) doesn't read online_orders.ready
      // at all — it only lights up a number once every kds_tickets row sharing
      // that order's ticket num is bumped (see printOnlineOrderKitchenTicket's
      // KIO/WEB-prefixed num and /api/public/[slug]/ready-orders). Without this,
      // staff clicking "Marquer prêt" at the till silently does nothing the
      // board can see — this is what actually makes that button work. Ignores
      // restaurants without daily_num (can't compute the ticket num) or
      // without migration-kds.sql (table missing) — best-effort, not required
      // for markReady itself to succeed.
      if (res[0].daily_num != null) {
        const ticketNum = (res[0].source === 'kiosk' ? 'KIO' : 'WEB') + String(res[0].daily_num).padStart(3, '0')
        try {
          await sql`
            UPDATE kds_tickets SET bumped = TRUE, bumped_at = NOW(), bumped_by = ${clip(body?.actor, 80)}
            WHERE restaurant_id = ${rest.id} AND num = ${ticketNum} AND bumped = FALSE`
        } catch {}
      }
      // /moi's own live polling is the guaranteed path; this is a bonus
      // nudge for a customer who's closed the tab — its failure can't fail
      // markReady itself, see notifyOrderReady's own doc comment.
      await notifyOrderReady({ id: orderId, client_name: res[0].client_name, client_phone: res[0].client_phone })
      return cors(NextResponse.json({ ok: true }))
    }

    if (action === 'markPaid') {
      const res = await sql`
        UPDATE online_orders SET paid = TRUE, paid_at = NOW(), paid_by = ${clip(body?.actor, 80)}, claimed_by = NULL, claimed_at = NULL
        WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'accepted' AND paid = FALSE
        RETURNING id`
      if (!res.length) return cors(NextResponse.json({ ok: false, error: 'Commande introuvable ou déjà payée' }, { status: 404 }))
      return cors(NextResponse.json({ ok: true }))
    }

    // Reverses markPaid — called when the till voids the sale that paid for
    // this order. The attempted payment didn't stand, so the order goes back
    // to "needs payment" rather than staying marked paid for money that was
    // refunded. No status guard beyond restaurant ownership: a void can
    // legitimately happen well after the order left 'accepted'.
    if (action === 'unmarkPaid') {
      await sql`
        UPDATE online_orders SET paid = FALSE, paid_at = NULL, paid_by = NULL, claimed_by = NULL, claimed_at = NULL
        WHERE id = ${orderId} AND restaurant_id = ${rest.id}`
      return cors(NextResponse.json({ ok: true }))
    }

    const status = action === 'accept' ? 'accepted' : 'rejected'
    const res = await sql`
      UPDATE online_orders SET status = ${status}, responded_by = ${clip(body?.actor, 80)}, responded_at = NOW()
      WHERE id = ${orderId} AND restaurant_id = ${rest.id} AND status = 'pending'
      RETURNING id`
    if (!res.length) return cors(NextResponse.json({ ok: false, error: 'Commande introuvable ou déjà traitée' }, { status: 404 }))

    return cors(NextResponse.json({ ok: true }))
  } catch (e: any) {
    return cors(NextResponse.json(serverError('online-orders POST', e), { status: 500 }))
  }
}
