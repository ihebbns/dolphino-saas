═══════════════════════════════════════════════════════════
  DOLPHINO POS SaaS — Vercel + Neon Deployment Guide
═══════════════════════════════════════════════════════════

STEP 1 — SETUP NEON DATABASE
──────────────────────────────
1. Go to https://neon.tech → your project → SQL Editor
2. Paste and run the contents of database.sql
3. Done — tables created, test restaurant inserted


STEP 2 — PUSH TO GITHUB
──────────────────────────
1. Create a new repo on github.com (name: dolphino-saas)
2. Open terminal in this folder and run:

   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/YOURNAME/dolphino-saas.git
   git push -u origin main


STEP 3 — DEPLOY ON VERCEL
───────────────────────────
1. Go to https://vercel.com → New Project → Import from GitHub
2. Select your dolphino-saas repo
3. Go to Settings → Environment Variables → Add:

   DATABASE_URL = postgresql://neondb_owner:npg_zD29OAQSbGhY@ep-odd-union-as0b3p7b-pooler.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   JWT_SECRET   = dolphino-saas-secret-2026-iheb-kelibia
   NEXT_PUBLIC_API_URL = https://YOUR-PROJECT.vercel.app

4. Click Deploy — done in 2 minutes!


STEP 4 — UPDATE ELECTRON APP
──────────────────────────────
In servio-pos-package/index.html, find:

   const SYNC_API_URL  = '...'

Change it to:

   const SYNC_API_URL  = 'https://YOUR-PROJECT.vercel.app/api/sync'

Then rebuild the EXE:
   node node_modules\electron-builder\cli.js --win --x64


STEP 5 — ADD A CLIENT RESTAURANT
───────────────────────────────────
1. Go to Neon SQL Editor and run:

   INSERT INTO restaurants (name, owner_email, password_hash, api_key, city, phone, plan)
   VALUES (
     'Restaurant Name',
     'owner@email.com',
     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uZutLjAu2',
     'DOLPH-CLIENT-001',
     'City',
     '+216 XX XXX XXX',
     'active'
   );

   Note: default password = dolphino123
   Generate a new hash at: https://bcrypt-generator.com (rounds=10)

2. Set SYNC_API_KEY = 'DOLPH-CLIENT-001' in the Electron app for that client


DASHBOARD URL
──────────────
https://YOUR-PROJECT.vercel.app

Owner logs in with their email + password.
Works on phone, tablet, PC — any browser.


TEST CREDENTIALS
─────────────────
Email    : iheb@dolphino.tn
Password : dolphino123
API Key  : DOLPH-TEST-KEY-001

═══════════════════════════════════════════════════════════
