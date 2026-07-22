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

// Appends one row to the given tab. This is a best-effort backup log —
// if Google Sheets is unreachable or not configured, we log the error
// and move on. A backup failing must never block the actual app action.
export async function appendRow(tab, row) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) {
      console.warn(`Sheets backup skipped for "${tab}" — Google Sheets env vars not set`);
      return;
    }
    await ctx.sheets.spreadsheets.values.append({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.error(`Sheets backup failed for "${tab}":`, err.message);
  }
}
