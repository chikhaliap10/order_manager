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

// Pure, easily-testable helper: given the sheet's existing rows (as returned
// by the Sheets API — an array of arrays, header included) and the id we're
// looking for at a given column index, return the 1-based sheet row number
// of a match, or null if no row has that id yet.
export function findExistingRowNumber(rows, idValue, idColIdx = 2) {
  for (let i = 1; i < rows.length; i++) {
    // skip header row (index 0)
    if (rows[i] && rows[i][idColIdx] === idValue) {
      return i + 1; // convert 0-based array index to 1-based sheet row number
    }
  }
  return null;
}

// Writes one row per real-world record (order/expense/withdrawal), keyed by
// its id in column C. The first time a record is seen, this appends a new
// row. Every time after that (status changes, edits, deletions), it updates
// that same row in place instead of adding another one — so the sheet
// always shows one current row per record, not a growing log of every
// event. This is a best-effort backup — if Sheets is unreachable or not
// configured, we log the error and move on; a backup failing must never
// block the actual app action.
export async function upsertRow(tab, idValue, rowValues, idColIdx = 2) {
  try {
    const ctx = getSheetsClient();
    if (!ctx) {
      console.warn(`Sheets backup skipped for "${tab}" — Google Sheets env vars not set`);
      return;
    }

    const getResp = await ctx.sheets.spreadsheets.values.get({
      spreadsheetId: ctx.sheetId,
      range: `${tab}!A:Z`,
    });
    const rows = getResp.data.values || [];
    const rowNumber = findExistingRowNumber(rows, idValue, idColIdx);

    if (rowNumber) {
      await ctx.sheets.spreadsheets.values.update({
        spreadsheetId: ctx.sheetId,
        range: `${tab}!A${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowValues] },
      });
    } else {
      await ctx.sheets.spreadsheets.values.append({
        spreadsheetId: ctx.sheetId,
        range: `${tab}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [rowValues] },
      });
    }
  } catch (err) {
    console.error(`Sheets upsert failed for "${tab}":`, err.message);
  }
}
