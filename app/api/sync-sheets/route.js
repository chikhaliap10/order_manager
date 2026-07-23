import { getKey, setKey, getOrInitPartners } from "../../../lib/kv";
import { overwriteTab, readTabIds } from "../../../lib/sheets";

export const dynamic = "force-dynamic";

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Detects rows a human deleted directly in the sheet and removes the
// matching record from the app -- safely. The key idea: we only ever
// compare the CURRENT sheet against what WE OURSELVES wrote there last
// time (a stored baseline), never against "is it there right now" alone.
//
// - No baseline yet (first sync ever) -> nothing is deleted, we just
//   establish the baseline this run.
// - Sheet couldn't be read (error, tab missing) -> nothing is deleted,
//   since we can't tell "empty" apart from "broken."
// - Only IDs that were in last run's baseline AND are missing now count
//   as a real, human-made deletion.
async function reconcileDeletions(tab, records, baselineKey) {
  const baseline = await getKey(baselineKey, null);
  if (!baseline) {
    return { records, deletedIds: [] }; // no baseline yet -- don't delete anything
  }
  const currentSheetIds = await readTabIds(tab);
  if (currentSheetIds === null) {
    return { records, deletedIds: [] }; // couldn't verify -- don't delete anything
  }
  const baselineSet = new Set(baseline);
  const deletedIds = [...baselineSet].filter((id) => !currentSheetIds.has(id));
  const remaining = records.filter((r) => !deletedIds.includes(r.id));
  return { records: remaining, deletedIds };
}

export async function GET(req) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    let [orders, expenses, withdrawals] = await Promise.all([
      getKey("orders", []),
      getKey("expenses", []),
      getKey("withdrawals", []),
    ]);
    const partners = await getOrInitPartners();
    const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";

    // Reconcile deletions first -- if a row was removed by a human in the
    // sheet since the last sync, remove that same record from the app.
    const ordersReconciled = await reconcileDeletions("Orders", orders, "synced-ids:orders");
    const expensesReconciled = await reconcileDeletions("Expenses", expenses, "synced-ids:expenses");
    const withdrawalsReconciled = await reconcileDeletions("Withdrawals", withdrawals, "synced-ids:withdrawals");

    orders = ordersReconciled.records;
    expenses = expensesReconciled.records;
    withdrawals = withdrawalsReconciled.records;

    if (ordersReconciled.deletedIds.length) await setKey("orders", orders);
    if (expensesReconciled.deletedIds.length) await setKey("expenses", expenses);
    if (withdrawalsReconciled.deletedIds.length) await setKey("withdrawals", withdrawals);

    // Now push the current (possibly reduced) state to the sheet.
    const now = new Date().toISOString();
    const orderRows = orders.map((o) => [
      now, o.paid ? "paid" : "unpaid", o.id, o.customer, itemsSummary(o.items), o.total, o.paid ? "paid" : "unpaid",
    ]);
    const expenseRows = expenses.map((e) => [now, "current", e.id, e.category, e.amount, e.note || ""]);
    const withdrawalRows = withdrawals.map((w) => [now, "current", w.id, partnerName(w.partnerId), w.amount, w.note || ""]);

    const [ordersResult, expensesResult, withdrawalsResult] = await Promise.all([
      overwriteTab("Orders", orderRows),
      overwriteTab("Expenses", expenseRows),
      overwriteTab("Withdrawals", withdrawalRows),
    ]);

    // Establish/update the baseline for next run's deletion-detection --
    // only for tabs that were actually written successfully this run.
    if (ordersResult.success) await setKey("synced-ids:orders", orders.map((o) => o.id));
    if (expensesResult.success) await setKey("synced-ids:expenses", expenses.map((e) => e.id));
    if (withdrawalsResult.success) await setKey("synced-ids:withdrawals", withdrawals.map((w) => w.id));

    return Response.json({
      syncedAt: now,
      Orders: { ...ordersResult, deletedFromApp: ordersReconciled.deletedIds },
      Expenses: { ...expensesResult, deletedFromApp: expensesReconciled.deletedIds },
      Withdrawals: { ...withdrawalsResult, deletedFromApp: withdrawalsReconciled.deletedIds },
    });
  } catch (err) {
    console.error("Sheets sync failed:", err);
    return Response.json({ error: err.message || "Sync failed." }, { status: 500 });
  }
}
