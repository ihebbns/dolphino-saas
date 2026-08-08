# Activating WhatsApp order-ready notifications

The code is already built and wired in (`lib/whatsapp.ts`, called from
`markReady` in `app/api/me/online-orders/route.ts`) — it's just inert until
the account/API pieces below exist. Nothing here can be done on your behalf:
Meta requires a real business to verify ownership.

## What it does today without any of this

`/moi/[slug]` already polls for order status live — the customer sees
"prête" the moment staff mark it, as long as that tab is open. WhatsApp is a
bonus nudge for a customer who's closed the tab, not the only path.

## Steps

1. **Meta Business Manager account** — [business.facebook.com](https://business.facebook.com), if you don't already have one for the business.
2. **Create a Meta App** — [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App → type "Business" → add the **WhatsApp** product to it.
3. **Get a phone number** — the App's WhatsApp → API Setup page gives you a free test number immediately (fine for trying it out, but it can only message a short allow-list of numbers you add manually). For real customers, add and verify your own business phone number instead — takes a verification code, no waiting.
4. **Create the message template** — WhatsApp requires every business-initiated message to use a pre-approved template; you can't send free text. In WhatsApp Manager → Message Templates → Create Template:
   - Name: `order_ready` (or anything — just tell me what you used)
   - Category: Utility
   - Language: French
   - Body: `Bonjour {{1}}, votre commande #{{2}} est prête ! 🍽️`
   - Submit for review — usually approved within a few hours, sometimes up to 24-48h.
5. **Collect two values** from the API Setup page:
   - A permanent access token (System User token — the temporary 24h one shown by default won't survive a day; generate a permanent one under Business Settings → System Users)
   - The **Phone Number ID** (not the phone number itself — a numeric ID shown right next to it)
6. **Give me those two values** (or set them yourself) as environment variables — in Vercel: Project Settings → Environment Variables:
   ```
   WHATSAPP_TOKEN=<your permanent access token>
   WHATSAPP_PHONE_ID=<the phone number id>
   WHATSAPP_TEMPLATE_ORDER_READY=order_ready   (only if you used a different template name)
   ```
7. Redeploy (or wait for the next deploy) — that's it, no code changes needed. The next order marked "prêt" for a customer who gave a phone number will get a WhatsApp message automatically.

## Cost

Meta charges per conversation (a 24h window), not per message — roughly
$0.01–0.09 depending on the country and message category, billed to whatever
payment method is on the Meta Business account. There's no cost from this
codebase's side beyond that.

## If you'd rather not do the Meta setup

The alternative discussed: browser push notifications (free, no account
needed, but only works if the customer keeps `/moi` open or installs it to
their home screen) — say the word and I'll build that path instead.
