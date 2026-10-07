export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const PAYMENT_METHODS = ["Cash", "Zelle", "Debit Card", "Credit Card"];
export const INTERNAL_METHOD = "Internal (deducted, no cash)";

// Sum of an order's actual logged payments. Older orders saved before the
// per-payment ledger existed have no `payments` array at all -- if they're
// marked paid, treat that as one legacy payment of the full total (in
// whatever single method was on file) so nothing that reads this silently
// drops them; same defensive-normalization idea as normalizeMenu() below.
//
// Lives here (not in app/page.jsx) specifically so both the client app and
// server-side code (the Google Sheets sync) read money data through the
// exact same logic -- two separate copies of this is exactly how the sheet
// sync quietly went stale relative to the app's per-payment collector
// tracking.
export function effectivePayments(order) {
  if (Array.isArray(order.payments) && order.payments.length > 0) return order.payments;
  if (order.paid) return [{ id: "legacy-" + order.id, method: order.paymentMethod || "Cash", amount: Number(order.total) || 0, ts: order.ts, collectedBy: order.collectedBy || "" }];
  return [];
}
export function paymentsTotal(order) {
  return effectivePayments(order).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

// Can this partner be picked for something new right now? Not if they've
// left, and not if their start date hasn't arrived yet.
export function isActiveNow(p, now = Date.now()) {
  return !p.inactiveSince && (!p.activeFrom || p.activeFrom <= now);
}

// Is this credit entry money handed BACK to a customer (a Reimburse), as
// opposed to credit used up on a later order? Matters for profit: when a
// customer overpays, the extra counts as income at that moment. Using the
// credit on a later order shrinks THAT order's total by the same amount, so
// it corrects itself. Handing the money back doesn't -- the cash is gone but
// the income it created is still being shared out as profit, so each
// reimbursement has to come off partner profit. Entries made before `kind`
// existed are recognised by their note.
export function isReimbursement(c) {
  if (c.kind) return c.kind === "reimbursement";
  return /^reimbursed via/i.test(c.note || "");
}

// A negotiated settlement ("we agreed to pay her $505") usually isn't what
// the formula says she's owed. If the settlement is marked to be shared
// (settlementShared), that difference -- a real cost or saving to the
// business -- is split equally between the partners who remain. By default it
// isn't: only the partner it was agreed with is affected.
//
// `baseBalance[id]` is each partner's balance BEFORE any of this. Anything
// already withdrawn since the settlement was set counts as paid toward it
// (it's added back first), so recording the payout later never makes the
// difference jump around.
export function computeSettlementAdjustments(partners, baseBalance, withdrawals, now = Date.now()) {
  const adjustmentByPartner = {};
  const infoByPartner = {};
  partners.forEach((p) => { adjustmentByPartner[p.id] = 0; });
  partners.forEach((q) => {
    if (q.settlementOverride == null || Number.isNaN(Number(q.settlementOverride))) return;
    const override = Number(q.settlementOverride);
    const since = Number(q.settlementSetAt) || 0;
    const paidSince = (withdrawals || [])
      .filter((w) => w.partnerId === q.id && (Number(w.ts) || 0) >= since)
      .reduce((s, w) => s + (Number(w.amount) || 0), 0);
    const beforePayout = (baseBalance[q.id] || 0) + paidSince;
    const delta = override - beforePayout; // + = costs the business extra, - = saves it
    // Partners with their own negotiated amount aren't charged; theirs is fixed.
    const bearers = partners.filter((p) => p.id !== q.id && isActiveNow(p, now) && p.settlementOverride == null);
    // Charging the difference to the other partners is OPT-IN (settlementShared).
    // Left off, a negotiated amount affects only the partner it was agreed with.
    const shared = q.settlementShared === true;
    infoByPartner[q.id] = { override, paidSince, remaining: override - paidSince, beforePayout, delta, bearerCount: bearers.length, shared };
    if (shared && bearers.length > 0 && Math.abs(delta) > 0.0001) {
      const per = delta / bearers.length;
      bearers.forEach((p) => { adjustmentByPartner[p.id] -= per; });
    }
  });
  return { adjustmentByPartner, infoByPartner };
}

// Money held per payment method: every payment logged, minus everything that
// has gone back out of that method (credit payouts, partner withdrawals, and
// shared-account expenses that say how they were paid). Lives here -- not
// in the page -- so the on-screen totals and the Totals check below use the
// exact same calculation.
export function computePaymentTypeTotals(orders, credits, withdrawals, expenses) {
  const map = {};
  // Every logged payment counts toward the drawer, whether or not the
  // order it belongs to is fully paid yet -- a $20 cash payment on a
  // still-"Unpaid" order is real cash you're holding right now.
  orders.forEach((o) => {
    effectivePayments(o).forEach((p) => {
      const method = p.method || "Cash";
      map[method] = (map[method] || 0) + (Number(p.amount) || 0);
    });
  });
  // Credit reimbursements (money physically paid OUT to settle a credit
  // balance) reduce whichever method it was paid out from. Only entries
  // tagged with a `method` count here -- an ordinary credit adjustment or
  // credit applied toward a new order has no `method`, since neither of
  // those moves real money out of the drawer.
  (credits || []).forEach((c) => {
    // A refund a partner paid from their OWN money (paidBy) never came out of
    // the business's cash or Zelle, so it doesn't lower these totals -- the
    // partner is credited back for it instead (see refundsPaidByPartner).
    if (c.method && !c.paidBy) map[c.method] = (map[c.method] || 0) + (Number(c.amount) || 0); // amount is already negative
  });
  // A partner withdrawal is money physically leaving the business, so it
  // comes off whichever method it was paid out in. Withdrawals saved before
  // a method was recorded have none -- those are treated as Cash, the same
  // default every other payment uses.
  (withdrawals || []).forEach((w) => {
    const method = w.method || "Cash";
    map[method] = (map[method] || 0) - (Number(w.amount) || 0);
  });
  // An expense paid from the shared account is money leaving the business,
  // so it comes off whichever method it was paid with. Deliberately only
  // expenses that SAY how they were paid (paidWith) count: older expenses
  // have no method recorded and may well have been paid some other way
  // entirely, so deducting them all as Cash would swing the total by
  // hundreds of dollars on a guess. Expenses a partner paid out of their
  // own pocket never come off the business totals -- that's their money,
  // handled through their balance instead.
  (expenses || []).forEach((e) => {
    if (e.paidBy || !e.paidWith) return;
    map[e.paidWith] = (map[e.paidWith] || 0) - (Number(e.amount) || 0);
  });
  const realMethods = PAYMENT_METHODS.filter((m) => map[m] !== undefined).map((m) => ({ method: m, total: map[m], internal: false }));
  const internal = map[INTERNAL_METHOD] !== undefined ? [{ method: INTERNAL_METHOD, total: map[INTERNAL_METHOD], internal: true }] : [];
  return [...realMethods, ...internal];
}

// ---- delivery ----
// Normal deliveries split the fee: 60% straight to the driver, 40% to shared
// profit. An Uber Courier delivery is different -- the driver (Prashant)
// arranges and covers the courier, so the WHOLE fee goes to him. Each order
// stores the rate it was made with (deliveryCutRate); orders from before this
// existed have none and are the normal 60%.
export const DELIVERY_COURIER = "Uber Courier";
export const DRIVER_CUT_RATE = 0.6;
export function driverCutRate(order) {
  const r = order && order.deliveryCutRate;
  return r !== undefined && r !== null && r !== "" && Number.isFinite(Number(r)) ? Number(r) : DRIVER_CUT_RATE;
}
// Only Prashant does deliveries for now, so there's no driver picker: he's
// found by name. Returns undefined if he's been renamed or has left.
export function findDeliveryDriver(partners) {
  return (partners || []).find((p) => p.name.trim().toLowerCase() === "prashant" && isActiveNow(p));
}
// The one formula for what an order costs, used by New Order, the edit form
// and the Totals check so they can never disagree.
export function orderTotalFromParts({ itemsTotal = 0, discount = 0, tip = 0, deliveryFee = 0, creditApplied = 0 }) {
  return Math.round((Number(itemsTotal) - Number(discount) + Number(tip) + Number(deliveryFee) - Number(creditApplied)) * 100) / 100;
}

// A bill that's already Paid gets LOWERED, and the customer keeps the
// difference as credit with us instead of being refunded. The payments stay
// exactly as logged (that money really is in the drawer); the order records how
// much was received, and `extra` is the new credit to add. Only the part that's
// new from this edit counts -- any overpayment already recorded on the order
// has its credit already, so it isn't added a second time.
export function creditFromLoweredBill({ order, newTotal, alreadyLogged }) {
  const prevChange = Math.max(0, (Number(order.amountReceived ?? order.total) || 0) - (Number(order.total) || 0));
  const extra = Math.round(((alreadyLogged - newTotal) - prevChange) * 100) / 100;
  return { amountReceived: alreadyLogged, extra };
}

// ---- customer credits ----
// One way to decide that "Krupesh Kiran", "krupesh kiran" and "Krupesh  Kiran"
// are the same person. "Apply credit" on a new order always matched names this
// way, but the Customer credits panel grouped by exact spelling -- so a credit
// applied under a different capitalisation showed as a second person (-$7)
// while the original credit (+$7) kept showing as owed.
export function creditKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
export function groupCreditsByCustomer(credits) {
  const groups = {};
  // oldest first, so the name shown is the spelling used when the credit began
  [...(credits || [])].reverse().forEach((c) => {
    const key = creditKey(c.customer);
    if (!groups[key]) groups[key] = { key, customer: String(c.customer || "").trim(), entries: [], balance: 0 };
    groups[key].entries.unshift(c); // newest first within a customer, as before
    groups[key].balance += Number(c.amount) || 0;
  });
  return Object.values(groups);
}
// An order records what the customer handed over ("Received $41.50"), which is
// a fact about that day and never changes. Whether the extra is still OWED to
// them depends on what has happened since -- paid back (Reimburse) or used on a
// later order -- which lives in their credit balance. This turns the two into
// the wording the order shows: still owed, partly settled, or settled.
export function overpaymentStatus(customerBalance, customerTotalOver) {
  const balance = Math.max(0, Number(customerBalance) || 0);
  const over = Number(customerTotalOver) || 0;
  if (balance <= 0.005) return { state: "settled", stillOwed: 0 };
  if (balance < over - 0.005) return { state: "partly", stillOwed: balance };
  return { state: "owed", stillOwed: balance };
}

// ---- who holds an order's Zelle ----
// The money maths reads who received each ZELLE PAYMENT (payment.collectedBy).
// The order also has an older whole-order collectedBy label which nothing in
// the maths reads -- except for partner meals, where it IS the deduction.
// Editing the label on a normal order therefore changed nothing, while looking
// as if it had moved the money. These read and write the payment itself.
//   zelleCollectorOf -> "" shared account, an id, null if different partners
//                       hold different Zelle payments, undefined if no Zelle at all
export function zelleCollectorOf(order) {
  const z = effectivePayments(order).filter((p) => p.method === "Zelle");
  if (z.length === 0) return undefined;
  const who = [...new Set(z.map((p) => p.collectedBy || ""))];
  return who.length === 1 ? who[0] : null;
}
export function withZelleCollector(payments, collectorId) {
  return payments.map((p) => (p.method === "Zelle" ? { ...p, collectedBy: collectorId || "" } : p));
}

// Order History sorted by the date the ORDER is for (not the order they were typed
// in -- an order entered late with an earlier date belongs among that day's
// orders). Orders from the same day keep the order they were saved in: newest
// saved first when looking newest-first, and the reverse when oldest-first.
export function sortOrdersByDate(orders, direction = "newest") {
  return orders
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const d = (Number(a.o.ts) || 0) - (Number(b.o.ts) || 0);
      if (d !== 0) return direction === "newest" ? -d : d;
      return direction === "newest" ? a.i - b.i : b.i - a.i;
    })
    .map((x) => x.o);
}

// An entry that records credit USED up on an order (rather than paid back out).
export function isAppliedCredit(c) {
  if (c.kind) return c.kind === "applied";
  return /^applied to|^marked as used/i.test(c.note || "");
}

// Order value vs money, worked out ORDER BY ORDER. Netting the grand totals
// against each other (total - paid) lets an overpayment on one order cancel
// out a real unpaid balance on another, so the "unpaid" figure comes out too
// low by exactly the overpayments. Per order, paid + still-owed always adds
// back to the order value, with any overpayment shown separately.
export function orderMoneySummary(orders) {
  const num = (v) => Number(v) || 0;
  let value = 0, paidToward = 0, owed = 0, extra = 0;
  orders.forEach((o) => {
    const total = num(o.total), paid = paymentsTotal(o);
    value += total;
    paidToward += Math.min(paid, total);
    owed += Math.max(0, total - paid);
    extra += Math.max(0, paid - total);
  });
  return { value, paidToward, owed, extra };
}

// The Totals check. Re-derives the important totals from the raw records a
// second, independent way and compares -- so a number that's quietly gone
// wrong gets caught instead of discovered later at the cash drawer. Each
// check is something that MUST be true if the books are right:
//   1. every order's total = its items - discount + tip + delivery - credit
//   2. nothing is logged as paid twice, and paid orders are fully covered
//   3. every dollar of profit is assigned to some partner (none dropped)
//   4. a negotiated settlement's difference is absorbed by someone
//   5. what partners are owed = the money the business actually holds, apart
//      from differences we can name exactly (shown, never hidden)
//   6. orders marked paid without a recorded method (assumed Cash)
//   7. no customer has used more credit than they earned
//   8. the same number agrees on every screen
//   9. no impossible entries (zero/negative amounts, unknown partners)
// Returns { checks: [{ id, title, status: "ok"|"warn"|"error", summary, details }], worst }.
export function auditTotals({ orders = [], expenses = [], withdrawals = [], credits = [], partners = [], totals = {} }) {
  const num = (v) => Number(v) || 0;
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => "$" + Math.abs(r2(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const checks = [];
  const rank = { ok: 0, warn: 1, error: 2 };
  const add = (id, title, status, summary, details = []) => checks.push({ id, title, status, summary, details });
  const cap = (lines, n = 8) => (lines.length > n ? [...lines.slice(0, n), `...and ${lines.length - n} more`] : lines);

  // ---- 1. order totals add up ----
  {
    const bad = [];
    orders.forEach((o) => {
      const items = (o.items || []).reduce((s, i) => s + num(i.price) * num(i.qty), 0);
      const expected = orderTotalFromParts({ itemsTotal: items, discount: o.discount, tip: o.tip, deliveryFee: o.deliveryFee, creditApplied: o.creditApplied });
      if (Math.abs(expected - num(o.total)) > 0.011) {
        bad.push(`${o.customer}: total is ${fmt(o.total)} but its items, tip, delivery, discount and credit add up to ${fmt(expected)} (${num(o.total) > expected ? "too high" : "too low"} by ${fmt(num(o.total) - expected)})`);
      }
    });
    add("order-totals", "Every order's total adds up", bad.length ? "error" : "ok",
      bad.length ? `${bad.length} order${bad.length === 1 ? " doesn't" : "s don't"} add up` : `All ${orders.length} orders add up`, cap(bad));
  }

  // ---- 2. payments vs what's owed ----
  {
    const over = [], short = [];
    orders.forEach((o) => {
      const paid = paymentsTotal(o);
      const owed = Math.max(num(o.total), num(o.amountReceived));
      if (paid > owed + 0.011) over.push(`${o.customer}: ${fmt(paid)} logged against ${fmt(owed)} owed -- a duplicate payment, or an overpayment that needs "Paid more than the bill?"`);
      else if (o.paid && paid < num(o.total) - 0.011) short.push(`${o.customer}: marked Paid but only ${fmt(paid)} of ${fmt(o.total)} is logged`);
    });
    const status = over.length ? "error" : short.length ? "warn" : "ok";
    add("payments", "Payments match what's owed", status,
      status === "ok" ? "No duplicate or missing payments" : `${over.length} possible duplicate${over.length === 1 ? "" : "s"}, ${short.length} short`, cap([...over, ...short]));
  }

  // who counts as a partner on a given date (mirrors the profit split exactly)
  const activeAt = (ts) => partners.filter((p) => (!p.activeFrom || (ts || 0) >= p.activeFrom) && (!p.inactiveSince || (ts || 0) < p.inactiveSince));
  const sumMap = (m) => Object.values(m || {}).reduce((s, v) => s + num(v), 0);

  // ---- 3. every dollar of profit is assigned to a partner ----
  const income = num(totals.income);
  const driverCuts = sumMap(totals.deliveryEarningsByPartner);
  const shouldShare = income - num(totals.expenseTotal) - driverCuts - num(totals.totalReimbursed);
  const actuallyShared = sumMap(totals.perPartnerShare);
  const leak = r2(shouldShare - actuallyShared);
  {
    const orphans = [];
    orders.forEach((o) => { if (paymentsTotal(o) > 0 && activeAt(o.ts).length === 0) orphans.push(`${o.customer}'s order dated ${new Date(o.ts).toLocaleDateString()} (${fmt(paymentsTotal(o))})`); });
    expenses.forEach((e) => {
      const named = Array.isArray(e.sharedBy) && e.sharedBy.some((id) => partners.some((p) => p.id === id));
      if (!named && activeAt(e.ts).length === 0) orphans.push(`the ${e.category} expense of ${fmt(e.amount)} dated ${new Date(e.ts).toLocaleDateString()}`);
    });
    const bad = Math.abs(leak) > 0.011;
    add("shared", "Every dollar of profit is assigned to a partner", bad ? "error" : "ok",
      bad ? `${fmt(leak)} of ${leak > 0 ? "profit" : "cost"} isn't assigned to anyone` : "Profit shares add up to income minus costs",
      bad ? cap(orphans.length ? ["Dated when no partner was active:", ...orphans] : ["No single record explains it -- check partner start/leave dates."]) : []);
  }

  // ---- 4. settlement differences are absorbed ----
  {
    const infos = Object.values(totals.settlementInfo || {});
    if (infos.length) {
      // Only settlements marked "share with the remaining partners" have a difference that
      // must be picked up by somebody; the rest affect just the partner they were agreed with.
      const sharedInfos = infos.filter((i) => i.shared);
      const unabsorbed = r2(sharedInfos.reduce((s, i) => s + num(i.delta), 0) + sumMap(totals.settlementAdjustmentByPartner));
      const bad = Math.abs(unabsorbed) > 0.011;
      const notShared = infos.filter((i) => !i.shared && Math.abs(num(i.delta)) > 0.005);
      add("settlements", "Negotiated settlements are covered", bad ? "error" : "ok",
        bad ? `${fmt(unabsorbed)} of settlement difference isn't absorbed by anyone` : sharedInfos.length ? "Settlement differences are shared by the remaining partners" : "Settlements only affect the partner they were agreed with",
        bad ? ["There are no remaining partners to share it -- add or reactivate a partner."]
          : notShared.map((i) => `A settlement is ${fmt(i.delta)} ${i.delta > 0 ? "above" : "below"} the calculated balance and isn't charged to anyone else.`));
    }
  }

  // ---- 5. owed to partners vs money actually held ----
  {
    const rows = computePaymentTypeTotals(orders, credits, withdrawals, expenses);
    const heldAll = rows.filter((r) => !r.internal).reduce((s, r) => s + r.total, 0);
    let zellePersonal = 0, internalUncollected = 0;
    orders.forEach((o) => {
      effectivePayments(o).forEach((p) => { if ((p.method || "Cash") === "Zelle" && p.collectedBy) zellePersonal += num(p.amount); });
      if (o.paid && o.paymentMethod === INTERNAL_METHOD && !o.collectedBy) internalUncollected += num(o.total);
    });
    const held = heldAll - zellePersonal;      // the drawer + the shared bank/Zelle, not money partners hold personally
    let owed = 0;
    partners.forEach((p) => {
      owed += num(totals.perPartnerShare?.[p.id]) - num(totals.withdrawnByPartner?.[p.id]) - num(totals.collectedByPartner?.[p.id])
        + num(totals.paidExpensesByPartner?.[p.id]) + num(totals.deliveryEarningsByPartner?.[p.id]) + num(totals.refundsPaidByPartner?.[p.id]);
    });
    // Only credits the BUSINESS paid come off the method totals; a refund a partner
    // paid personally is credited to that partner instead and is left out here.
    const creditPaidOut = credits.filter((c) => c.method && !c.paidBy).reduce((s, c) => s - num(c.amount), 0);
    const reimbursedByBusiness = credits.filter((c) => isReimbursement(c) && num(c.amount) < 0 && !c.paidBy).reduce((s, c) => s - num(c.amount), 0);
    const appliedCredits = r2(creditPaidOut - reimbursedByBusiness);          // came off Cash, never off profit
    const untrackedExpenses = expenses.filter((e) => !e.paidBy && !e.paidWith).reduce((s, e) => s + num(e.amount), 0); // cost profit, never touched a total
    const expected = held + appliedCredits - untrackedExpenses + internalUncollected;
    const unexplained = r2(owed - expected + leak);   // `leak` is reported by check 3 on its own, so it isn't counted twice
    const details = [
      `Partners are owed ${fmt(owed)}. The business holds ${fmt(held)} (cash drawer + shared Zelle/bank).`,
    ];
    if (untrackedExpenses > 0.005) details.push(`${fmt(untrackedExpenses)} of shared-account expenses have no "Paid from", so they lowered partner profit but not Cash -- this makes partners owed LESS than the money held.`);
    if (appliedCredits > 0.005) details.push(`${fmt(appliedCredits)} of customer credit was used on later orders. It came off Cash but not off partner profit -- this makes partners owed MORE than the money held. No cash actually left, so if your counted cash is ${fmt(appliedCredits)} higher than the app's Cash, that's why.`);
    if (internalUncollected > 0.005) details.push(`${fmt(internalUncollected)} of partner meals have no partner assigned.`);
    const bad = Math.abs(unexplained) > 0.51;
    if (bad) details.unshift(`${fmt(unexplained)} can't be explained by anything above -- something is off.`);
    add("money", "Partner balances match the money held", bad ? "error" : appliedCredits > 0.005 ? "warn" : "ok",
      bad ? `${fmt(unexplained)} unexplained difference` : "Reconciles, apart from the named differences below", details);
  }

  // ---- 6. orders with no payment method on record ----
  {
    const legacy = orders.filter((o) => o.paid && !(Array.isArray(o.payments) && o.payments.length > 0) && !o.paymentMethod);
    const total = legacy.reduce((s, o) => s + num(o.total), 0);
    add("methods", "Payment methods are on record", legacy.length ? "warn" : "ok",
      legacy.length ? `${legacy.length} paid order${legacy.length === 1 ? " has" : "s have"} no payment method (${fmt(total)})` : "Every paid order has a payment method",
      legacy.length ? cap(["The app counts these as Cash. If any were Zelle or card, Cash is overstated by that amount.", ...legacy.sort((a, b) => num(b.total) - num(a.total)).map((o) => `${o.customer}: ${fmt(o.total)}`)]) : []);
  }

  // ---- 7. customer credit balances ----
  {
    const byCustomer = {};
    credits.forEach((c) => { const k = creditKey(c.customer); byCustomer[k] = (byCustomer[k] || { name: c.customer, sum: 0 }); byCustomer[k].sum += num(c.amount); });
    const neg = Object.values(byCustomer).filter((c) => c.sum < -0.011).map((c) => `${c.name}: has used ${fmt(c.sum)} more credit than they ever overpaid`);
    add("credits", "Customer credits balance", neg.length ? "warn" : "ok",
      neg.length ? `${neg.length} customer${neg.length === 1 ? " is" : "s are"} below zero` : "No customer is below zero", cap(neg));
  }

  // ---- 7b. credit used on orders is recorded as used ----
  {
    const onOrders = {}, recorded = {}, names = {};
    orders.forEach((o) => { if (num(o.creditApplied) > 0) { const k = creditKey(o.customer); onOrders[k] = (onOrders[k] || 0) + num(o.creditApplied); names[k] = names[k] || o.customer; } });
    credits.forEach((c) => { if (isAppliedCredit(c) && num(c.amount) < 0) { const k = creditKey(c.customer); recorded[k] = (recorded[k] || 0) - num(c.amount); names[k] = names[k] || c.customer; } });
    const lines = [];
    new Set([...Object.keys(onOrders), ...Object.keys(recorded)]).forEach((k) => {
      const a = onOrders[k] || 0, b = recorded[k] || 0;
      if (Math.abs(a - b) <= 0.011) return;
      lines.push(a > b
        ? `${names[k]}: ${fmt(a)} of credit was applied on orders, but only ${fmt(b)} is recorded as used -- so ${fmt(a - b)} still shows as owed under Customer credits. Use "Mark as used" there.`
        : `${names[k]}: ${fmt(b)} is recorded as used, but orders only show ${fmt(a)} applied (${fmt(b - a)} more than orders account for)`);
    });
    add("credits-used", "Credit used on orders is recorded as used", lines.length ? "warn" : "ok",
      lines.length ? `${lines.length} customer${lines.length === 1 ? "" : "s"} don't match` : "Every credit applied to an order is recorded as used", cap(lines));
  }

  // ---- 7c. the order's collector label matches the Zelle payment ----
  {
    const nameOf = (id) => (id ? (partners.find((p) => p.id === id)?.name || "an unknown partner") : "the shared account");
    const lines = [];
    orders.forEach((o) => {
      if (o.paymentMethod === INTERNAL_METHOD || !o.collectedBy) return; // partner meals use the order label on purpose
      const z = effectivePayments(o).filter((p) => p.method === "Zelle");
      if (z.length === 0) return;
      const real = [...new Set(z.map((p) => p.collectedBy || ""))];
      // Only when the label matches NONE of the actual holders. A part-and-part split
      // (e.g. $46 to one partner, a $4 tip to the shared account) is partly right.
      if (!real.includes(o.collectedBy)) lines.push(`${o.customer}: the order is labelled "${nameOf(o.collectedBy)}", but the Zelle payment was received by ${real.map(nameOf).join(" and ")} -- the payment is what counts in partner balances`);
    });
    add("collectors", "Zelle collector matches the payment", lines.length ? "warn" : "ok",
      lines.length ? `${lines.length} order${lines.length === 1 ? "" : "s"} with a conflicting label` : "Order labels agree with who received the Zelle",
      cap(lines.length ? [...lines, "To change who holds it: edit the order and use the \"Zelle received by\" dropdown."] : []));
  }

  // ---- 8. the same number agrees on every screen ----
  {
    const m = orderMoneySummary(orders);
    const diffs = [];
    if (Math.abs(m.owed - num(totals.pending)) > 0.011) diffs.push(`"Still owed" is ${fmt(totals.pending)} on the Summary tab but ${fmt(m.owed)} when worked out order by order`);
    if (Math.abs(m.paidToward + m.extra - num(totals.income)) > 0.011) diffs.push(`Income is ${fmt(totals.income)} on the Summary tab but ${fmt(m.paidToward + m.extra)} when worked out order by order`);
    if (Math.abs(m.paidToward + m.owed - m.value) > 0.011) diffs.push(`Paid (${fmt(m.paidToward)}) plus still owed (${fmt(m.owed)}) doesn't add back to the order value (${fmt(m.value)})`);
    add("screens", "Totals agree across screens", diffs.length ? "error" : "ok",
      diffs.length ? `${diffs.length} disagreement${diffs.length === 1 ? "" : "s"}` : `Paid ${fmt(m.paidToward)} + still owed ${fmt(m.owed)} = order value ${fmt(m.value)}`, diffs);
  }

  // ---- 9. impossible entries ----
  {
    const bad = [];
    const known = (id) => partners.some((p) => p.id === id);
    expenses.forEach((e) => {
      if (num(e.amount) <= 0) bad.push(`A ${e.category} expense has a zero or negative amount`);
      if (e.paidBy && !known(e.paidBy)) bad.push(`The ${e.category} expense of ${fmt(e.amount)} was paid by a partner who no longer exists`);
    });
    credits.forEach((c) => {
      if (c.paidBy && !known(c.paidBy)) bad.push(`A ${fmt(c.amount)} refund to ${c.customer} was paid by a partner who no longer exists`);
    });
    withdrawals.forEach((w) => {
      if (num(w.amount) <= 0) bad.push("A withdrawal has a zero or negative amount");
      if (!known(w.partnerId)) bad.push(`A withdrawal of ${fmt(w.amount)} belongs to a partner who no longer exists`);
    });
    add("entries", "No impossible entries", bad.length ? "error" : "ok", bad.length ? `${bad.length} problem${bad.length === 1 ? "" : "s"}` : "Expenses and withdrawals look sane", cap(bad));
  }

  const worst = checks.reduce((w, c) => (rank[c.status] > rank[w] ? c.status : w), "ok");
  return { checks, worst };
}

// Dollar value of a discount on a food subtotal. `type` is "amount" (value
// is dollars) or "percent" (value is 0-100). Never negative, never more
// than the subtotal itself (a discount can't push the food below $0), and
// rounded to the cent so a percentage doesn't leave 14-digit decimals in
// saved totals. Shared by New Order and the order edit form so both agree.
export function discountAmountFor(subtotal, type, value) {
  const sub = Number(subtotal) || 0;
  const v = Number(value) || 0;
  if (sub <= 0 || v <= 0) return 0;
  const raw = type === "percent" ? sub * (Math.min(v, 100) / 100) : v;
  return Math.round(Math.min(raw, sub) * 100) / 100;
}

// Everything is a simple, independently-orderable item -- base plates and
// every add-on/topping alike -- each with its own quantity in the cart,
// Uber-Eats style. No nested pickers: "11 Cheese Aloopuri, 5 with Papdi,
// 4 with extra Red Sev" is just four separate line items in one order.
export function defaultMenu() {
  return [
    {
      id: uid(),
      name: "Surti Aloopuri",
      items: [
        { id: uid(), name: "Surti Aloopuri", variants: [{ id: uid(), label: "Regular", price: 9.0 }, { id: uid(), label: "Crunchy", price: 9.5 }] },
        { id: uid(), name: "Extra Red Sev", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Yellow Sev", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Cheese", variants: [{ id: uid(), label: "", price: 2.0 }] },
        { id: uid(), name: "Papdi", variants: [{ id: uid(), label: "", price: 1.0 }] },
      ],
    },
    {
      id: uid(),
      name: "Coco",
      items: [
        {
          id: uid(),
          name: "Coco",
          // One combined tap for a pre-flavored coco: size + flavor +
          // price all in a single Style pick. Add more flavor/size rows
          // here any time from Setup -- no code change needed.
          variants: [
            { id: uid(), label: "12 oz", price: 8.0 },
            { id: uid(), label: "1 Liter", price: 20.0 },
            { id: uid(), label: "Kaju 12 oz", price: 9.0 },
            { id: uid(), label: "Kaju 1 Liter", price: 21.0 },
            { id: uid(), label: "Choco Chip 12 oz", price: 9.0 },
            { id: uid(), label: "Choco Chip 1 Liter", price: 21.0 },
            { id: uid(), label: "Ice Cream 12 oz", price: 10.0 },
            { id: uid(), label: "Ice Cream 1 Liter", price: 23.0 },
          ],
        },
        // Stackable extras -- their own item, own quantity, addable to any
        // order alongside a Coco (or on their own), same pattern as the
        // Surti Aloopuri add-ons above.
        { id: uid(), name: "Extra Kaju", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Choco Chip", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Ice Cream", variants: [{ id: uid(), label: "", price: 2.0 }] },
      ],
    },
  ];
}

export function defaultPartners() {
  return Array.from({ length: 5 }, (_, i) => ({ id: uid(), name: "Partner " + (i + 1) }));
}

// Flat delivery fee by zone. Editable in Setup -- these starting values are
// just what the business used at the time this was built, not something to
// keep matching this code if prices change later.
export function defaultDeliveryZones() {
  return [
    { id: uid(), name: "Lyndhurst/Rutherford/Clifton", fee: 3 },
    { id: uid(), name: "Secaucus", fee: 4 },
    { id: uid(), name: "Jersey City/Union City", fee: 5 },
    { id: uid(), name: "Newport", fee: 7 },
  ];
}

// Older versions of this app stored menu items with a nested
// addOnMode/sizeFlavorMode picker config instead of a flat `variants`
// array. The rest of the app assumes every item has a non-empty
// item.variants array (e.g. item.variants.length, item.variants.find(...))
// -- if a leftover old-format item without one ever reaches those places,
// it throws and takes down the whole page (both the staff app and the
// public /order page, since both read the menu through getOrInitMenu).
//
// This runs on every menu read and repairs anything that doesn't already
// look like the current clean shape, so nothing downstream ever has to
// special-case it again. A repaired item gets a single placeholder
// "$0.00" variant -- it shows up in Setup looking obviously wrong (instead
// of crashing), so staff can fix the price or delete it. It is NOT
// written back to the database automatically; the underlying row is only
// changed when staff edits/saves that item (or resets the whole menu).
export function normalizeMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      id: g.id || uid(),
      name: typeof g.name === "string" && g.name.trim() ? g.name : "Untitled",
      items: Array.isArray(g.items) ? g.items.filter((i) => i && typeof i === "object").map(normalizeItem) : [],
    }));
}

function normalizeItem(item) {
  const rawVariants = Array.isArray(item.variants) ? item.variants : [];
  const variants = rawVariants
    .filter((v) => v && typeof v === "object" && Number(v.price) > 0)
    .map((v) => ({ id: v.id || uid(), label: typeof v.label === "string" ? v.label : "", price: Number(v.price) }));
  if (variants.length === 0) {
    // No usable variants survived -- this is the old-format case (or any
    // other malformed item). Fall back to a legacy `price` field if one
    // happens to exist, otherwise $0.00, so the item is still visible and
    // editable rather than silently dropped or crash-inducing.
    variants.push({ id: uid(), label: "", price: Number(item.price) || 0 });
  }
  return {
    id: item.id || uid(),
    name: typeof item.name === "string" && item.name.trim() ? item.name : "Unnamed item",
    variants,
  };
}
