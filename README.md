# Order ledger — deployment guide

This turns your order ledger into a real website anyone on your team can open
from any phone or computer, with:

- **Its own database** (Supabase, a free Postgres database) — this is
  where the app actually reads and writes data, every time.
- **A Google Sheet backup** — every order, expense, and withdrawal also gets
  logged as a row in a Google Sheet the moment it happens. If the app or
  database ever has a problem, your data still exists in a sheet you own and
  can open yourself, any time, with no app required.

Follow these sections in order. None of it requires coding — it's all
clicking through web dashboards.

---

## Part 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new,
   blank spreadsheet. Name it something like **Order Ledger Backup**.
2. At the bottom, you'll see one tab called "Sheet1". Rename it to **Orders**
   (double-click the tab name).
3. Create two more tabs (click the **+** at the bottom) named exactly
   **Expenses** and **Withdrawals**. Tab names must match exactly — the app
   writes to tabs by these names.
4. In the **Orders** tab, add this header row (row 1):
   `Timestamp | Action | Order ID | Customer | Items | Total | Status`
5. In the **Expenses** tab, add this header row:
   `Timestamp | Action | Expense ID | Category | Amount | Note`
6. In the **Withdrawals** tab, add this header row:
   `Timestamp | Action | Withdrawal ID | Partner | Amount | Note`
7. Look at the URL of your sheet. It looks like:
   `https://docs.google.com/spreadsheets/d/THIS_LONG_ID_HERE/edit`
   Copy that long ID — you'll need it soon as `GOOGLE_SHEET_ID`.

---

## Part 2 — Create a Google Cloud service account

A "service account" is a special account the app itself uses to write to
your sheet — it's not your personal Google login, and it can't do anything
except what you specifically allow.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   sign in with your normal Google account.
2. At the top, click the project dropdown → **New Project**. Name it
   `order-ledger` (or anything) → **Create**. Wait a few seconds and make
   sure this new project is selected in the dropdown.
3. In the search bar at the top, type **Google Sheets API** → click it →
   click **Enable**.
4. In the left sidebar, go to **APIs & Services → Credentials**.
5. Click **+ Create Credentials → Service account**.
6. Give it a name like `order-ledger-writer` → **Create and Continue** →
   you can skip the optional role/access steps → **Done**.
7. You'll now see your new service account in the list. Click on it.
8. Go to the **Keys** tab → **Add Key → Create new key** → choose **JSON** →
   **Create**. A `.json` file downloads to your computer. Keep this file
   private — treat it like a password.
9. Open that downloaded JSON file in a text editor. You need two values from
   it:
   - `client_email` — a long address ending in
     `...iam.gserviceaccount.com`. This is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
   - `private_key` — a long block starting with
     `-----BEGIN PRIVATE KEY-----`. This is your `GOOGLE_PRIVATE_KEY`. Copy
     the whole thing, including the BEGIN/END lines.

## Part 3 — Share your Sheet with the service account

This is the step people most often forget, and without it the backup will
silently fail.

1. Open your Google Sheet from Part 1.
2. Click **Share** (top right).
3. Paste in the `client_email` address from step 9 above.
4. Set its permission to **Editor**.
5. Click **Send** (or **Share** — it won't actually email anyone, this just
   grants access).

---

## Part 4 — Push the project to GitHub

1. Download the project folder I've built for you (see the file shared in
   this conversation).
2. Create a new, empty repository on [github.com](https://github.com/new)
   — don't initialize it with a README, since you already have files.
3. From your computer, in the project folder:
   ```
   git init
   git add .
   git commit -m "Order ledger app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

---

## Part 5 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub
   repository you just pushed. Use the default settings — Vercel
   auto-detects Next.js.
2. **Before clicking Deploy**, add these environment variables (there's a
   section for this on the same import screen, or under
   **Settings → Environment Variables** after deploying):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — from Part 2
   - `GOOGLE_PRIVATE_KEY` — from Part 2 (paste the whole block, quotes and
     all, exactly as it appeared in the JSON file)
   - `GOOGLE_SHEET_ID` — from Part 1
3. Click **Deploy**. After a minute or two, you'll get a live URL like
   `order-ledger.vercel.app`.

## Part 6 — Add the database (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign up (or log in) — it's
   free to start.
2. Click **New Project**. Give it a name like `order-ledger`, set a database
   password (Supabase will ask you to — just save it somewhere, you won't
   need to type it again for this setup), and pick a region close to you.
   Wait a minute or two while it provisions.
3. Once it's ready, go to the **SQL Editor** in the left sidebar → **New
   query**, paste in this, and click **Run**:
   ```sql
   create table if not exists kv_store (
     key text primary key,
     value jsonb not null
   );
   ```
   This creates one simple table the app uses to store everything (menu,
   orders, expenses, withdrawals, partners, and the shared passcode) as
   labeled rows.
4. Go to **Project Settings → API** (gear icon in the sidebar, then "API").
   You need two values from this page:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`. This is
     your `SUPABASE_URL`.
   - **service_role secret key** — found under "Project API keys". Click
     "Reveal" to see it. This is your `SUPABASE_SERVICE_ROLE_KEY`. Treat it
     like a password — it has full access to your database.
5. Back in your Vercel project, go to **Settings → Environment Variables**
   and add both:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Go to **Deployments** and redeploy your latest deployment so the new
   environment variables take effect.

---

## Part 7 — First run

1. Open your live URL. You'll be asked to set a shared passcode — this is
   the one thing everyone on your team will type in to use the app. Pick
   something simple but not guessable, and share it with your team directly
   (text, WhatsApp, etc.) — not written down anywhere public.
2. Go to **Setup** and confirm your menu categories and partner names look
   right.
3. Place a test order, then check your Google Sheet — a row should appear
   in the **Orders** tab within a few seconds. If it doesn't show up, the
   most common cause is the Share step in Part 3 being missed or the sheet
   tab names not matching exactly (`Orders`, `Expenses`, `Withdrawals`).

---

## Notes on how this is built

- The passcode is intentionally simple (one shared code, not individual
  logins) since that matches what you asked for. It's fine for an internal
  team tool but isn't bank-grade security — don't reuse this passcode
  anywhere sensitive.
- The Google Sheet is a **backup log**, not the live app. The app always
  reads and writes from its own database (Supabase) for speed; the sheet is
  simply a running record of every action, so even a deleted order still
  shows up as a "deleted" row in the sheet — nothing disappears from your
  paper trail.
- If the Google Sheets write ever fails (e.g. internet hiccup on Google's
  end), the app keeps working normally — the backup step never blocks a
  real action like saving an order.
