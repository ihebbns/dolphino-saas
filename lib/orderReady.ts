// ═══════════════════════════════════════════════════════════════════
// Shared "tell the customer their order is ready" step — best-effort,
// independently inert until its own config exists (WhatsApp needs
// WHATSAPP_TOKEN/WHATSAPP_PHONE_ID; push needs VAPID keys and an actual
// subscription for this order). Called from two different triggers that
// both mean "this order is done": staff explicitly tapping "Marquer prêt"
// (see /api/me/online-orders), and kitchen bumping the LAST ticket for an
// order — from the till's own KDS overlay OR the standalone
// /kitchen/[slug] screen, either device (see /api/me/kds). Requires the
// Node.js runtime wherever it's imported (sendOrderReadyPush needs real
// Node crypto for VAPID signing — see lib/webpush.ts).
// ═══════════════════════════════════════════════════════════════════
import { whatsappConfigured, sendWhatsAppOrderReady } from '@/lib/whatsapp'
import { sendOrderReadyPush } from '@/lib/webpush'

export async function notifyOrderReady(order: { id: number; client_name: string; client_phone?: string | null }) {
  if (whatsappConfigured() && order.client_phone) {
    await sendWhatsAppOrderReady(order.client_phone, order.client_name, order.id).catch(() => {})
  }
  await sendOrderReadyPush(order.id, {
    title: 'Commande prête ! 🍽️',
    body: `${order.client_name}, votre commande #${order.id} est prête.`,
  }).catch(() => {})
}
