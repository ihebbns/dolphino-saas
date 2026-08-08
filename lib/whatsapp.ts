// ═══════════════════════════════════════════════════════════════════
// WhatsApp order-ready notification via Meta's WhatsApp Cloud API.
//
// Inert until WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set — this can't go
// live without a Meta Business Manager account, WhatsApp Business API
// access, and an approved message template, none of which can be created
// on the client's behalf. See SETUP-WHATSAPP.md for the exact steps.
//
// Business-initiated WhatsApp messages MUST use a pre-approved template —
// free-form text only works inside a 24h window the customer themselves
// opened by messaging first, which doesn't apply here. The template name
// is configurable (WHATSAPP_TEMPLATE_ORDER_READY) since Meta may require
// the customer to submit it under a specific naming/language combination.
// ═══════════════════════════════════════════════════════════════════

export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID)
}

// Tunisia-specific default: an 8-digit local number gets the 216 country
// code prefixed. Anything already longer is assumed to carry its own code.
// Returns null for anything that can't plausibly be a phone number, so a
// caller never sends to garbage input.
export function normalizePhone(raw: string): string | null {
  const digits = String(raw || '').replace(/[^\d]/g, '')
  if (!digits) return null
  if (digits.startsWith('216') && digits.length === 11) return digits
  if (digits.length === 8) return '216' + digits
  if (digits.length > 8) return digits
  return null
}

export async function sendWhatsAppOrderReady(phone: string, clientName: string, orderNum: string | number) {
  if (!whatsappConfigured()) return { ok: false, skipped: true, reason: 'not-configured' }
  const to = normalizePhone(phone)
  if (!to) return { ok: false, skipped: true, reason: 'no-phone' }

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_ORDER_READY || 'order_ready',
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'fr' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: String(clientName || 'Client').slice(0, 60) },
              { type: 'text', text: String(orderNum) },
            ],
          }],
        },
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: data?.error?.message || `WhatsApp API ${res.status}` }
    return { ok: true, messageId: data?.messages?.[0]?.id }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}
