# TECHHUB — Tech Shop Management System

Private inventory + point-of-sale platform for a tech shop. One backend and one PostgreSQL database are shared by the **web app** and the **mobile app**, so stock is always in sync.

```
techhub/
  api/     Node.js + Express + PostgreSQL  (all business rules and security live here)
  web/     Next.js + React + TypeScript    (owner dashboard, POS, reports …)
  mobile/  Expo + React Native + TypeScript (Android + iOS: sell, search, alerts)
```

## IMPORTANT — what has and has not been verified

This project was written in a workspace that could not download npm packages, so **the Node/Next/Expo code has never been executed**.
What *was* verified: every file parses without syntax errors, the PostgreSQL schema applies cleanly (twice), and the critical SQL
(atomic stock deduction, no overselling under 20 simultaneous buyers, no-duplicate alerts, receipt numbering, profit math, search, refunds)
was run against real PostgreSQL 16. **Run the test suite first (below)** — expect to fix a few small things on first run.

## 1. Run it locally (10 minutes)

Requirements: Node 20+, PostgreSQL 14+.

```bash
# --- API ---
cd api
cp .env.example .env            # edit DATABASE_URL and JWT_SECRET
npm install
npm run migrate                 # creates all tables
SEED_OWNER_PASSWORD='ChangeMe123' npm run seed   # optional: demo shop + DEMO products
npm run dev                     # http://localhost:4000/api/health

# --- Web (second terminal) ---
cd web
cp .env.example .env.local      # API_URL=http://localhost:4000
npm install && npm run dev      # http://localhost:3000   (register your business, or log in as 'owner')

# --- Mobile (third terminal) ---
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000 npx expo start   # scan the QR with the Expo Go app
```

## 2. Run the automated tests (do this before deploying)

```bash
createdb techhub_test
cd api
DATABASE_URL=postgres://USER:PASS@localhost:5432/techhub_test npm test
```
**The tests WIPE the target database — never point them at real data.** They cover your 10 required scenarios
(create product → search → sell → 10→9 → second employee sees 9 → low-stock alert → OUT OF STOCK → restock 20 → permission denials →
ledger accuracy) plus: 25 simultaneous sales on 10 units (exactly 10 succeed), duplicate submissions, returns/refunds,
tenant isolation, deactivated-employee lockout, PO receiving, and report math.

## 3. Deploying (JoyTree or any host)

I don't have JoyTree's documentation, so these steps are generic. You need three things running:

1. **PostgreSQL** — create a database on JoyTree and copy its connection string.
2. **API** (`api/`) — deploy from your GitHub repo. Start command: `npm start`. Set environment variables:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | connection string from JoyTree (add `DATABASE_SSL=true` if it requires SSL) |
   | `JWT_SECRET` | long random string (`openssl rand -hex 48`) — **required in production** |
   | `NODE_ENV` | `production` |
   | `CORS_ORIGINS` | your web app URL (e.g. `https://techhub.yourdomain`) |
   | `UPLOAD_DIR` | a **persistent volume** path for product photos/logos (otherwise they vanish on redeploy) |
   | `BUSINESS_TZ` | `Africa/Accra` (default) |
   | `SMTP_*` | optional, for email alerts |
   Tables are created automatically on every start (`schema.sql` is idempotent).
3. **Web** (`web/`) — deploy; set `API_URL` to the API's public URL. (Dockerfile included.)
4. **Mobile** — NOT deployed on JoyTree (it is a phone app, not a website). Until you publish it to the stores, staff can simply open the website on their phone: it is fully responsive. To build the real app: set `extra.apiUrl` in `mobile/app.json` to the API URL, then build with EAS (`npx eas build`) for the Play Store / App Store, or share via Expo Go while testing.

Never put your database password in the code, chat, or GitHub. Keep it only in the host's environment variables.

## 4. Backups & recovery
```bash
DATABASE_URL=... bash api/scripts/backup.sh                    # schedule daily; copy files off the server
DATABASE_URL=... bash api/scripts/restore.sh backups/FILE.dump # restore (replaces data)
```
Also enable your hosting provider's automatic database backups. Test a restore once before you rely on it.

## 5. How the important rules are enforced
- **No overselling:** a single conditional `UPDATE inventory SET quantity = quantity - n WHERE quantity - n >= 0` inside the sale transaction, plus a database `CHECK (quantity >= 0)`. Concurrent sales queue on the row lock.
- **No duplicate sales:** every checkout carries an idempotency key; a retry after a network drop returns the original sale instead of selling twice.
- **Complete history:** every quantity change goes through one function that also writes `stock_movements` (before / change / after / who / why) in the same transaction.
- **Alerts:** one active alert per product per condition (unique index) → no spam; resolved automatically on restock; "restocked" notice when 0 → available.
- **Security:** bcrypt passwords, server-side sessions re-checked on every request (deactivation is instant), permissions enforced in the API, every query scoped to the caller's business, magic-byte image validation, rate limiting, account lockout, audit log. The web session token lives in an httpOnly cookie.
- **Profit:** Revenue = sales − refunds. Gross profit = revenue − cost of goods (cost frozen at time of sale). Net profit = gross profit − recorded expenses.
- **Sample data** is flagged `DEMO` everywhere and removable from Settings.

## 6. Known limitations (be aware)
- Not run end-to-end yet (see top). `web/next.config.mjs` ignores lint/type errors at build so a minor typing nit can't block your first deploy — tighten later.
- PDFs show prices as `GHS 30.00` (built-in PDF fonts cannot draw ₵); on-screen and Excel use `GH₵`.
- Mobile app: sell, search, alerts, dashboard. Product entry, reports, employees, suppliers and settings are on the website.
- Push notifications need an Expo/EAS project ID and a real device. Email alerts need SMTP settings.
- Product photos are stored on the API server's disk; for several API servers switch `src/files.ts` to cloud object storage (S3/R2).
- Barcode scanning on web works with USB/Bluetooth scanners (they type the code + Enter in the POS search box).
- Offline mode is not included: when the connection drops, actions fail safely with a clear message and can be retried without double-selling.

## Upgrade v2 (in progress, staged)
Done: navy/electric-blue palette, Light/Dark/Auto theme (saved per user), customers, credit sales + customer payments, warranties/serial/IMEI + claims, warranty and overdue alerts.
New permissions: `customers.manage`, `customers.credit`, `warranty.manage` (existing roles must be edited by the owner to grant them; the owner has them automatically).
Behaviour change: a sale with an unpaid balance now requires a registered customer and `customers.credit`.
Stage 2 added: cash-flow report (with opening balance), customer/supplier balance reports, payments-by-method, sales-by-category, stock-movement reports, CSV export on every report, expense payment method, dashboard cards (owed by customers / to suppliers) + monthly profit & loss + expense breakdown charts, Code-128 barcode generation (EAN-13 in-store range), barcode display and label printing.
Not yet built: QR codes, camera scanning, scanning when receiving stock, dashboard date-range filter, backup/restore module, 'other income' in cash flow, user-defined payment methods, serial capture at POS.
Nothing in this upgrade has been executed end-to-end yet: SQL was verified on Postgres, TS/TSX only syntax-checked. Run `npm test` in api/ and a manual pass before production.
