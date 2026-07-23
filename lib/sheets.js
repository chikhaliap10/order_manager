import { google } from "googleapis";

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

// Replaces every data row in a tab (below the header) with the given rows,
// in exactly 2 API calls (clear, then write) regardless of how much data
// there is. This is the backup mechanism now -- instead of writing on every
// single click, a scheduled job calls this periodically (see
// /api/sync-sheets) with the full current list of orders/expenses/
// withdrawals, so the sheet always reflects a recent snapshot without
// hammering the Sheets API on every action.
export async function overwriteTab(tab, rows) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) {
      console.warn(`Sheets sync skipped for "${tab}" — Google Sheets env vars not set`);
      return { success: false, error: "Google Sheets is not configured." };
    }

    await ctx.sheets.spreadsheets.values.clear({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A2:Z100000`,
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
