# Servio POS — How to Use & Test the Complete Production System

This covers every URL in the system, what it's for, who logs into it, and a
step-by-step way to test the whole thing end-to-end on your real production
site (servio.tn). Examples below use **La Coupole** (`la-coupole`) and
**Test Cafe Servio** (`test_cafe_servio-jfx3`) since those are the two most
up-to-date real clients — swap the slug for any other client.

---

## 1. The URLs — what each one is for

| URL | Who uses it | What it's for |
|---|---|---|
| `servio.tn/admin` | **You** (the developer/platform owner) | Create clients, toggle modules, set reward tiers, manage the whole platform. Needs `ADMIN_SECRET_KEY` (see "Known issue" below — currently broken on production). |
| `servio.tn/dashboard` | **Restaurant owners** | Their own back-office: sales, stock, profit, credits, wallet. Log in with the email/password created when the client was set up. |
| `servio.tn/moi/<slug>` | **Customers**, from their own phone (a link or QR code) | Order for pickup/delivery, or at their table via a table QR code. If the restaurant has loyalty (wallet) turned on, ordering *remotely* (no table) requires logging into an account first — no guest checkout for that case. |
| `servio.tn/kiosk/<slug>` | **Customers**, on a screen physically mounted in the restaurant | Self-order touchscreen, like a McDonald's kiosk. Never requires an account — phone number is optional (only used to link loyalty points). |
| `servio.tn/kitchen/<slug>` | **Kitchen staff**, on any device/tablet | Cloud-synced kitchen ticket screen — bump a ticket when it's done. Gated by a simple password (set per-client in `/admin` → client → 🔗 Lien & QR tab), *not* the technical API key. |
| `servio.tn/ready/<slug>` | **A screen mounted near the counter**, left running all day | Pickup board — shows which order numbers are ready for pickup right now, labeled 🏪 Caisse / 🖥️ Kiosque / 🌐 En ligne. No login. Updates itself every 5 seconds. |
| `servio.tn/signup` | New self-service customers | Trial signup flow (separate from you manually creating a client via `/admin`). |
| The POS EXE itself | **Cashiers/staff** | Runs on the till, not a browser page — this is what you build with `node build-<client>.mjs`. |

---

## 2. The full order lifecycle, in order

This is the actual flow, and where to watch each stage:

1. **Customer orders** — via `/moi/<slug>` (account required if remote) or
   `/kiosk/<slug>` (walk-up, no account). They get a small order number
   immediately ("Votre numéro : #12").
2. **Order lands on the till** — the "🌐 Commandes" button in the POS
   pulses and a toast pops in the corner with a chime.
3. **Staff accepts it** — kitchen ticket prints, labeled `KIO001` (kiosk) or
   `WEB001` (moi/online), never a plain number — so it's never confused with
   a regular counter order.
4. **Kitchen finishes it** — staff bump the ticket (till's own 🖥️ Cuisine
   screen, or a separate tablet at `/kitchen/<slug>`).
5. **The number appears on `/ready/<slug>`** automatically — no extra step.
   That's the whole point: one bump action feeds both the kitchen and the
   customer-facing board.

Regular counter orders (typed at the till, nothing online involved) show up
on the same `/ready/<slug>` board too, labeled 🏪 Caisse, the moment their
kitchen ticket is bumped — same mechanism, no special handling needed.

---

## 3. Step-by-step test plan for production

Do these roughly in order — each one builds on the last:

### A. The till itself
1. Install/open the EXE (`La_Coupole_Setup.exe` or `Test_Cafe_Servio_Setup.exe`, both freshly built).
2. Log in, open the register (fond de caisse).
3. Ring up a normal sale, pay cash. Confirm it appears in "Historique."
4. Void that sale (🗑️ next to it) — confirm the stock/ingredient quantities
   actually go back up (check via `/dashboard` → Stock, or the till's own
   stock screen).

### B. Customer ordering — kiosk
1. Open `servio.tn/kiosk/<slug>` on any device.
2. Place an order (name only, phone optional).
3. Confirm you get an order number on screen.
4. On the till, accept the order in "🌐 Commandes" — confirm the corner
   toast + chime fired, and the kitchen ticket printed as `KIO0xx`.

### C. Customer ordering — remote link (account required)
1. Open `servio.tn/moi/<slug>` (no `?table=` in the URL).
2. If the restaurant has wallet/loyalty on, you'll be asked to log in with a
   phone number (and PIN, if that restaurant has PIN protection on) before
   you can even see the menu.
3. Order — confirm your name/phone are never asked again (auto-filled from
   the account) — and check the order lands under the right account.

### D. Kitchen + pickup board
1. Open `servio.tn/kitchen/<slug>` on a second device, enter that client's
   kitchen password (set in `/admin`).
2. Bump the ticket from step B or C.
3. Open `servio.tn/ready/<slug>` on a third device (or just refresh it) —
   confirm the number shows up within 5 seconds, correctly labeled.

### E. Owner back-office
1. Log into `servio.tn/dashboard` with that restaurant's real email/password.
2. Check "Commandes" — the voided sale from step A should show struck-through,
   red, tagged "🗑️ Annulée," and **excluded** from the revenue total at top.
3. Check "Rentabilité"/reward tiers if that client uses loyalty.

---

## 4. Known issues still open (not blocking testing, but real)

- **`/admin` login is currently broken on production** — `ADMIN_SECRET_KEY`
  in Vercel doesn't match what's expected. Fix: Vercel dashboard → your
  project → Settings → Environment Variables → update `ADMIN_SECRET_KEY` →
  redeploy.
- **Only 4 client files have this session's fixes**: `La_Coupole`,
  `test_cafe_servio`, and the two templates (`_template_table`,
  `_template_counter`). Your other real clients — `Cafe_El_Baraka`,
  `Cafe_Milano`, `Cafeina`, `ParaPharma_Plus`, `dolphino`, `mio_food`,
  `COFFE_JASMIN` — are still running **older code** without void-restore,
  the new pickup board support, kiosk/QR gating by business type, etc.
  `Coffee_More` is under a standing rule to never touch. Say the word if you
  want these brought up to date too — it's the same work again, once per file.
- **Wallet PIN protection** (`walletPinProtected` module) needs to be turned
  on per-client in `/admin` if you want the privacy fix from earlier in this
  project to actually apply to a given restaurant — it's off by default.

---

## 5. Creating a brand-new client (new coffee shop/restaurant)

Run the wizard from `servio-pos-package/`:

```bash
node tools/new-client/server.mjs
```

Open the printed `http://localhost:4790` URL. Pick **table service** or
**counter/fast-food** as the base (both are fully up to date with this
session's fixes), tick which features they get, fill in their menu/branding,
and it builds their EXE and creates their real dashboard login — now
correctly pointed at production since the database connection is fixed.
