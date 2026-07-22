import { getKey, getOrInitPartners } from "../../../lib/kv";
import { overwriteTab } from "../../../lib/sheets";

export const dynamic = "force-dynamic";

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

// Vercel automatically sends this header on cron-triggered requests when
// a CRON_SECRET environment variable is set, so we can confirm the request
// really came from the scheduled job and not a random visitor.
function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured -- allow (useful for local testing), but see README
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [orders, expenses, withdrawals, partners] = await Promise.all([
      getKey("orders", []),
      getKey("expenses", []),
      getKey("withdrawals", []),
      getOrInitPartners(),
    ]);

    const now = new Date().toISOString();
    const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";

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

    return Response.json({
      syncedAt: now,
      Orders: ordersResult,
      Expenses: expensesResult,
      Withdrawals: withdrawalsResult,
    });
  } catch (err) {
    console.error("Sheets sync failed:", err);
    return Response.json({ error: err.message || "Sync failed." }, { status: 500 });
  }
}
