import { getKey, getOrInitPartners } from "../../../lib/kv";
import { syncAllToSheets } from "../../../lib/sheets";

export const dynamic = "force-dynamic";

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Simple, guaranteed one-way sync: app -> sheet. Whatever is currently in
// the database gets written, full stop. No reading the sheet back, no
// filtering logic, no way for a header/column change or any other drift
// to cause data to silently disappear. Deletions made directly in the
// sheet do NOT propagate back to the app -- delete real orders/expenses/
// withdrawals from inside the app itself.
//
// This route is the nightly cron trigger (see vercel.json). The actual
// sync work lives in lib/sheets.js:syncAllToSheets(), shared with the
// manual "Sync to Google Sheet" button (app/api/actions/route.js), so the
// two triggers can never drift into writing different data.
export async function GET(req) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAllToSheets({ getKey, getOrInitPartners });
    return Response.json(result);
  } catch (err) {
    console.error("Sheets sync failed:", err);
    return Response.json({ error: err.message || "Sync failed." }, { status: 500 });
  }
}
