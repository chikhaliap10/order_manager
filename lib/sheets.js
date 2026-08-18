import { google } from "googleapis";
import { effectivePayments, INTERNAL_METHOD } from "./defaults";

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!email || !key || !sheetId) return null;

  const auth = new google.auth.JWT(
    email,
    null,
    key.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

// Diagnostic-only helper: unlike the real sync below, this one surfaces the
// exact error so the debug page can show precisely which tab is broken and
// why (e.g. the tab doesn't exist, or the sheet ID is wrong).
export async function testTabWrite(tab) {
  const ctx = getSheetsClient();
  if (!ctx) return { success: false, error: "Google Sheets is not configured (missing env vars)." };
  try {
    const testValue = `ping-${Date.now()}`;
    await ctx.sheets.spreadsheets.values.append({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[new Date().toISOString(), "debug-test", "debug:ping", testValue]] },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Reads back the set of record IDs currently present in a tab (column C by
// default). Returns null -- not an empty set -- if the read fails for any
// reason (tab missing, network error, not configured). This distinction
// matters: a genuinely empty sheet and a failed read must never be treated
// the same way by a caller trying to detect deletions, or a temporary
// glitch could look identical to "the human deleted everything."
export async function readTabIds(tab, idColIdx = 2) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) return null;
    const resp = await ctx.sheets.spreadsheets.values.get({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A2:Z100000`,
    });
    const rows = resp.data.values || [];
    return new Set(rows.map((r) => r[idColIdx]).filter(Boolean));
  } catch (err) {
    console.error(`Sheets read failed for "${tab}" (treating as unknown, not empty):`, err.message);
    return null;
  }
}

// Replaces the header row and every data row in a tab, in exactly 3 API
// calls (clear, write header, write data) regardless of how much data
// there is. Writing the header every time means you never have to type it
// yourself, and it can never silently drift out of sync with what the code
// actually writes.
export async function overwriteTab(tab, headers, rows) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) {
      console.warn(`Sheets sync skipped for "${tab}" — Google Sheets env vars not set`);
      return { success: false, error: "Google Sheets is not configured." };
    }

    await ctx.sheets.spreadsheets.values.clear({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A1:Z100000`,
    });

    await ctx.sheets.spreadsheets.values.update({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headers] },
    });

    if (rows.length > 0) {
      await ctx.sheets.spreadsheets.values.update({
        spreadsheetId: ctx.sheetId,
        range: `${tab}!A2`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    }

    return { success: true, rowsWritten: rows.length };
  } catch (err) {
    console.error(`Sheets sync failed for "${tab}":`, err.message);
    return { success: false, error: err.message };
  }
}

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

// Turns an order's actual payments ledger into a plain-text breakdown for
// the sheet, e.g. "Cash $100.00 + Zelle $35.00" -- filtering the Orders
// tab by a single "Payment Method" column stopped being meaningful once
// split payments existed, since one order can now span more than one
// method.
const paymentBreakdown = (order) =>
  effectivePayments(order).map((p) => `${p.method} $${(Number(p.amount) || 0).toFixed(2)}`).join(" + ") || "(none logged)";

// Who's personally holding money from this order, read straight from the
// payments ledger -- not the old single order.collectedBy field, which
// only ever reflected the *whole order* and goes stale the moment a
// specific Zelle (or internal-deduction) payment gets attributed to a
// partner without the rest of the order changing hands. Lists every
// distinct collector across all of the order's payments, since a split
// payment could in principle have more than one.
function collectedBySummary(order, partnerName) {
  const collectors = effectivePayments(order)
    .filter((p) => (p.method === "Zelle" || p.method === INTERNAL_METHOD) && p.collectedBy)
    .map((p) => partnerName(p.collectedBy));
  return [...new Set(collectors)].join(", ") || "Shared account";
}

// The actual sync work, shared by both the nightly cron job
// (app/api/sync-sheets/route.js) and the manual "Sync to Google Sheet"
// button (triggered through app/api/actions/route.js, which is already
// gated behind the staff passcode). Kept in one place so the two triggers
// can never drift into writing different columns or different data.
export async function syncAllToSheets({ getKey, getOrInitPartners }) {
  const [orders, expenses, withdrawals] = await Promise.all([
    getKey("orders", []),
    getKey("expenses", []),
    getKey("withdrawals", []),
  ]);
  const partners = await getOrInitPartners();
  const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";

  const now = new Date().toISOString();
  const orderRows = orders.map((o) => [
    now, o.id, o.customer, o.phone || "", itemsSummary(o.items), o.total, o.paid ? "paid" : "unpaid",
    paymentBreakdown(o), collectedBySummary(o, partnerName),
  ]);
  const expenseRows = expenses.map((e) => [
    now, e.id, e.category, e.amount, e.note || "",
    e.paidBy ? partnerName(e.paidBy) : "Shared account",
  ]);
  const withdrawalRows = withdrawals.map((w) => [now, w.id, partnerName(w.partnerId), w.amount, w.note || ""]);

  const [ordersResult, expensesResult, withdrawalsResult] = await Promise.all([
    overwriteTab("Orders", ["Timestamp", "Order ID", "Customer", "Phone", "Items", "Total", "Status", "Payment Breakdown", "Collected By"], orderRows),
    overwriteTab("Expenses", ["Timestamp", "Expense ID", "Category", "Amount", "Note", "Paid By"], expenseRows),
    overwriteTab("Withdrawals", ["Timestamp", "Withdrawal ID", "Partner", "Amount", "Note"], withdrawalRows),
  ]);

  return { syncedAt: now, Orders: ordersResult, Expenses: expensesResult, Withdrawals: withdrawalsResult };
}
