import { google } from "googleapis";
import { buildSheetData } from "./sheetRows";

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

// The actual sync work, shared by both the nightly cron job
// (app/api/sync-sheets/route.js) and the manual "Sync to Google Sheet"
// button (triggered through app/api/actions/route.js, which is already
// gated behind the staff passcode). Kept in one place so the two triggers
// can never drift into writing different columns or different data.
const SHEET_TABS = ["Orders", "Expenses", "Withdrawals", "Credits", "Partners"];

// Creates any tab that doesn't exist yet, so adding a new tab to the backup never
// needs a manual step in the sheet. If this fails the individual tab writes below
// still run and report their own error, so the original tabs keep working.
async function ensureTabs(tabs) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) return;
    const meta = await ctx.sheets.spreadsheets.get({ spreadsheetId: ctx.sheetId, fields: "sheets.properties.title" });
    const have = new Set((meta.data.sheets || []).map((s) => s.properties.title));
    const missing = tabs.filter((t) => !have.has(t));
    if (missing.length > 0) {
      await ctx.sheets.spreadsheets.batchUpdate({
        spreadsheetId: ctx.sheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    }
  } catch (err) {
    console.error("Could not check/create Google Sheet tabs:", err.message);
  }
}

export async function syncAllToSheets({ getKey, getOrInitPartners }) {
  const [orders, expenses, withdrawals, credits] = await Promise.all([
    getKey("orders", []),
    getKey("expenses", []),
    getKey("withdrawals", []),
    getKey("credits", []),
  ]);
  const partners = await getOrInitPartners();
  const now = new Date().toISOString();
  const data = buildSheetData({ orders, expenses, withdrawals, credits, partners, now, timeZone: process.env.SHEET_TIMEZONE || "America/New_York" });

  await ensureTabs(SHEET_TABS);
  const results = await Promise.all(SHEET_TABS.map((tab) => overwriteTab(tab, data[tab].headers, data[tab].rows)));
  const out = { syncedAt: now };
  SHEET_TABS.forEach((tab, i) => { out[tab] = results[i]; });
  return out;
}
