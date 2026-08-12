import { getKey, getOrInitPartners } from "../../../lib/kv";
import { overwriteTab } from "../../../lib/sheets";

export const dynamic = "force-dynamic";

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

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
export async function GET(req) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
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
      o.collectedBy ? partnerName(o.collectedBy) : "Shared account",
    ]);
    const expenseRows = expenses.map((e) => [
      now, e.id, e.category, e.amount, e.note || "",
      e.paidBy ? partnerName(e.paidBy) : "Shared account",
    ]);
    const withdrawalRows = withdrawals.map((w) => [now, w.id, partnerName(w.partnerId), w.amount, w.note || ""]);

    const [ordersResult, expensesResult, withdrawalsResult] = await Promise.all([
      overwriteTab("Orders", ["Timestamp", "Order ID", "Customer", "Phone", "Items", "Total", "Status", "Collected By"], orderRows),
      overwriteTab("Expenses", ["Timestamp", "Expense ID", "Category", "Amount", "Note", "Paid By"], expenseRows),
      overwriteTab("Withdrawals", ["Timestamp", "Withdrawal ID", "Partner", "Amount", "Note"], withdrawalRows),
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
