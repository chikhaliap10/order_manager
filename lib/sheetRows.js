// Turns the app's records into the rows the Google Sheet backup shows. Lives
// apart from lib/sheets.js (which talks to Google) so it can be tested with no
// network, and so the manual button and the nightly job build identical data.
//
// New columns are always added at the END of a tab, never in the middle, so
// anything you've built on the existing columns (filters, formulas, charts)
// keeps working.
import { effectivePayments, INTERNAL_METHOD, driverCutRate, isReimbursement, isAppliedCredit } from "./defaults";

const num = (v) => Number(v) || 0;
const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

// An order's actual payments ledger as plain text, e.g. "Cash $100.00 + Zelle
// $35.00" -- one order can span more than one method, so a single "method"
// column stopped being meaningful.
const paymentBreakdown = (order) =>
  effectivePayments(order).map((p) => `${p.method} $${num(p.amount).toFixed(2)}`).join(" + ") || "(none logged)";

// Who's personally holding money from this order, read from the payments
// ledger (not the old whole-order collectedBy, which goes stale).
function collectedBySummary(order, partnerName) {
  const collectors = effectivePayments(order)
    .filter((p) => (p.method === "Zelle" || p.method === INTERNAL_METHOD) && p.collectedBy)
    .map((p) => partnerName(p.collectedBy));
  return [...new Set(collectors)].join(", ") || "Shared account";
}

export function buildSheetData({ orders = [], expenses = [], withdrawals = [], credits = [], partners = [], now, timeZone = "America/New_York" }) {
  const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";
  // The Timestamp column is when the sync ran; this is the date the record is
  // actually FOR, in the business's own time zone. The profit split depends on
  // these dates, so a sheet without them can't rebuild anyone's share.
  const day = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone }) : "");

  const Orders = {
    headers: ["Timestamp", "Order ID", "Customer", "Phone", "Items", "Total", "Status", "Payment Breakdown", "Collected By",
      "Order Date", "Tip", "Discount", "Delivery Zone", "Delivery Fee", "Delivery Driver", "Driver Gets", "Credit Applied", "Amount Received"],
    rows: orders.map((o) => [
      now, o.id, o.customer, o.phone || "", itemsSummary(o.items), o.total, o.paid ? "paid" : "unpaid",
      paymentBreakdown(o), collectedBySummary(o, partnerName),
      day(o.ts), num(o.tip), num(o.discount), o.deliveryZone || "", num(o.deliveryFee),
      o.deliveryDriverId && num(o.deliveryFee) > 0 ? partnerName(o.deliveryDriverId) : "",
      o.deliveryDriverId && num(o.deliveryFee) > 0 ? Math.round(num(o.deliveryFee) * driverCutRate(o) * 100) / 100 : 0,
      num(o.creditApplied), o.amountReceived !== undefined ? num(o.amountReceived) : "",
    ]),
  };

  const Expenses = {
    headers: ["Timestamp", "Expense ID", "Category", "Amount", "Note", "Paid By", "Split Between", "Paid From", "Date"],
    rows: expenses.map((e) => [
      now, e.id, e.category, e.amount, e.note || "",
      e.paidBy ? partnerName(e.paidBy) : "Shared account",
      Array.isArray(e.sharedBy) && e.sharedBy.length > 0 ? e.sharedBy.map(partnerName).join(", ") : "Everyone active (auto)",
      !e.paidBy && e.paidWith ? e.paidWith : "(not deducted)",
      day(e.ts),
    ]),
  };

  const Withdrawals = {
    headers: ["Timestamp", "Withdrawal ID", "Partner", "Amount", "Paid Out As", "Note", "Date"],
    rows: withdrawals.map((w) => [now, w.id, partnerName(w.partnerId), w.amount, w.method || "Cash", w.note || "", day(w.ts)]),
  };

  // Money owed to customers (and what's been done with it). Not having this in
  // the backup meant a liability could vanish if the database were ever lost.
  const kindOf = (c) => (isReimbursement(c) ? "Reimbursed" : isAppliedCredit(c) ? "Used on an order" : num(c.amount) > 0 ? "Overpayment (owed)" : "Adjustment");
  const Credits = {
    headers: ["Timestamp", "Credit ID", "Customer", "Amount", "Kind", "Method", "Paid By", "Note", "Date"],
    rows: credits.map((c) => [now, c.id, c.customer, num(c.amount), kindOf(c), c.method || "", c.paidBy ? partnerName(c.paidBy) : "", c.note || "", day(c.ts)]),
  };

  // Joined / left dates and any negotiated settlement -- needed to rebuild the
  // time-aware profit split.
  const Partners = {
    headers: ["Timestamp", "Partner ID", "Partner", "Joined", "Left", "Settlement Amount", "Settlement Note"],
    rows: partners.map((p) => [now, p.id, p.name, day(p.activeFrom), day(p.inactiveSince), p.settlementOverride != null ? num(p.settlementOverride) : "", p.settlementNote || ""]),
  };

  return { Orders, Expenses, Withdrawals, Credits, Partners };
}
