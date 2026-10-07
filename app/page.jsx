"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Check, X, Lock, Receipt, History, Wallet, Users, Settings2, ChefHat, Loader2, Download, ShieldCheck, Pencil, Inbox, BarChart3, ClipboardList } from "lucide-react";
import { PAYMENT_METHODS, INTERNAL_METHOD, effectivePayments, paymentsTotal, discountAmountFor, isActiveNow, isReimbursement, computeSettlementAdjustments, computePaymentTypeTotals, auditTotals, orderMoneySummary, DELIVERY_COURIER, DRIVER_CUT_RATE, driverCutRate, findDeliveryDriver, orderTotalFromParts, creditFromLoweredBill, creditKey, groupCreditsByCustomer, overpaymentStatus, zelleCollectorOf, withZelleCollector, sortOrdersByDate } from "../lib/defaults";

const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);

// Converts a plain "YYYY-MM-DD" date into a timestamp at local noon (not
// midnight) -- this avoids a subtle bug where midnight, when later
// converted to an ISO date string for day-grouping, can shift to the
// previous day depending on the browser's timezone offset. Noon is safely
// in the middle of the day regardless of timezone.
function dateStringToTs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}
function tsToDateString(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayDateString() {
  return tsToDateString(Date.now());
}
// Midnight at the START of a "YYYY-MM-DD" day. Used for a new partner's
// start date so every order and expense dated that day -- whatever time it
// was logged -- counts with them (dateStringToTs is local noon, which would
// leave out anything logged earlier that morning).
function startOfDayTs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).getTime();
}
// Filters orders to a plate-totals reporting period. "today"/"month" use
// calendar-day/calendar-month comparisons (via tsToDateString, consistent
// with the rest of the app's date handling) rather than raw millisecond
// math, so an order placed at 11pm still counts as "today" regardless of
// timezone quirks. "week" is a simple rolling last-7-days window. "custom"
// takes an explicit {from, to} "YYYY-MM-DD" range (inclusive both ends) --
// this is what lets you check any specific past day or stretch, like last
// Saturday, that the fixed presets can't reach.
function filterOrdersByPeriod(orders, period, customRange) {
  if (period === "all") return orders;
  const now = Date.now();
  // Every option here works on the date the ORDER is for (o.ts, the date picked
  // on the order) -- never on the day it was typed in or paid.
  if (period === "today") {
    const todayStr = todayDateString();
    return orders.filter((o) => tsToDateString(o.ts || now) === todayStr);
  }
  if (period === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yStr = tsToDateString(y.getTime());
    return orders.filter((o) => tsToDateString(o.ts || now) === yStr);
  }
  if (period === "week") {
    // Today and the six calendar days before it. (This used to count 7x24 hours
    // back from the current moment, so whether an order from a week ago showed
    // up depended on what time of day you looked.)
    const start = new Date(now); start.setDate(start.getDate() - 6);
    const from = tsToDateString(start.getTime()), to = todayDateString();
    return orders.filter((o) => { const d = tsToDateString(o.ts || now); return d >= from && d <= to; });
  }
  if (period === "month") {
    const nowDate = new Date(now);
    return orders.filter((o) => {
      const d = new Date(o.ts || now);
      return d.getMonth() === nowDate.getMonth() && d.getFullYear() === nowDate.getFullYear();
    });
  }
  if (period === "custom" && customRange?.from && customRange?.to) {
    return orders.filter((o) => {
      const d = tsToDateString(o.ts || now);
      return d >= customRange.from && d <= customRange.to;
    });
  }
  return orders;
}
// Referenced at both order-creation and order-edit phone fields but was
// never actually defined -- same bug class as the earlier
// GroupNameEditor crash (a used-but-undefined reference). "Valid" here
// just means at least 10 digits once formatting characters are stripped,
// matching the error message both call sites already show.
function isValidPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10;
}
const QTY_PRESETS = [5, 10, 15, 20, 25];

const C = {
  ink: "#F0EDE6", paper: "#121412", card: "#1C1F1B",
  moss: "#43966B", mossDark: "#8FE0B3", mossTint: "rgba(67,150,107,0.18)",
  ember: "#F0A868", emberTint: "rgba(240,168,104,0.16)",
  success: "#6FCF97", successTint: "rgba(111,207,151,0.16)",
  danger: "#F0796B", dangerTint: "rgba(240,121,107,0.16)",
  warning: "#F0C24B", warningTint: "rgba(240,194,75,0.16)",
  border: "#2C302A", muted: "#9BA39A",
};

async function api(path, opts) {
  const res = await fetch(path, {
    method: opts?.method || "GET",
    headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned a non-JSON response (status ${res.status}). Check your Vercel function logs.`);
  }
  if (!res.ok && !data.error) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return data;
}

function ConfirmDelete({ onConfirm, label }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const doConfirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); setConfirming(false); }
  };
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} style={iconBtn} className="om-btn" aria-label={`Delete ${label}`}>
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button onClick={doConfirm} disabled={busy} style={{ ...iconBtn, background: C.dangerTint, color: C.danger, borderColor: C.danger, opacity: busy ? 0.6 : 1 }} className="om-btn" aria-label="Confirm delete">
        {busy ? <Loader2 className="om-spin" size={14} /> : <Check size={14} />}
      </button>
      <button onClick={() => setConfirming(false)} disabled={busy} style={iconBtn} className="om-btn" aria-label="Cancel delete"><X size={14} /></button>
    </div>
  );
}

function ErrorText({ children }) {
  if (!children) return null;
  return <div style={{ color: C.danger, fontSize: 13, marginTop: 8, lineHeight: 1.4 }}>{children}</div>;
}

function exportBackup(data) {
  const payload = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `order-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [unlocked, setUnlocked] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const [menu, setMenu] = useState([]);
  const [partners, setPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [credits, setCredits] = useState([]);
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [tab, setTab] = useState("orders");

  const refresh = async () => {
    try {
      setLoadError(null);
      const data = await api("/api/state");
      if (data.authed) {
        setUnlocked(true);
        setMenu(data.menu); setPartners(data.partners); setOrders(data.orders);
        setExpenses(data.expenses); setWithdrawals(data.withdrawals); setCredits(data.credits || []);
        setDeliveryZones(data.deliveryZones || []);
      } else {
        setUnlocked(false);
      }
    } catch (err) {
      setLoadError(err.message || "Something went wrong loading the app.");
    }
    setReady(true);
  };

  useEffect(() => { refresh(); }, []);

  // Keep the app's data fresh automatically -- this is what makes new
  // customer-placed orders show up in Incoming without staff needing to
  // manually reload. Browsers throttle setInterval in background/inactive
  // tabs, so a plain interval alone isn't reliable -- pairing it with a
  // refresh on tab-focus/visibility-return catches the case where staff
  // switches back to this tab after it's been sitting in the background.
  useEffect(() => {
    if (!unlocked) return;
    const interval = setInterval(() => { refresh(); }, 8000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [unlocked]);

  const handleUnlock = async () => {
    if (!passInput.trim()) { setPassError("Enter the passcode"); return; }
    setUnlocking(true);
    try {
      const res = await api("/api/unlock", { method: "POST", body: { passcode: passInput.trim() } });
      if (res.error) { setPassError(res.error); return; }
      setPassError("");
      await refresh();
    } catch (err) {
      setPassError(err.message || "Something went wrong — try again.");
    } finally {
      setUnlocking(false);
    }
  };

  // Returns {ok:true} on success or {ok:false, error} on failure, so every
  // form can show its own specific error and manage its own loading state
  // instead of failing silently.
  const act = async (resource, action, payload) => {
    try {
      const res = await api("/api/actions", { method: "POST", body: { resource, action, payload } });
      if (res.error) return { ok: false, error: res.error };
      // The action endpoint already returns exactly the resource that
      // changed (orders, expenses, withdrawals, menu, or partners) — apply
      // that directly instead of re-fetching the entire app's data again.
      // This cuts a full extra round-trip out of every single click.
      if (res.orders) setOrders(res.orders);
      if (res.expenses) setExpenses(res.expenses);
      if (res.withdrawals) setWithdrawals(res.withdrawals);
      if (res.menu) setMenu(res.menu);
      if (res.partners) setPartners(res.partners);
      if (res.credits) setCredits(res.credits);
      if (res.deliveryZones) setDeliveryZones(res.deliveryZones);
      // Spread the rest of the response through too (e.g. sync-sheets'
      // per-tab results) -- purely additive, every existing caller only
      // ever reads .ok/.error so this can't break anything already there.
      return { ok: true, ...res };
    } catch (err) {
      return { ok: false, error: err.message || "Something went wrong. Please try again." };
    }
  };

  // Orders placed online but not yet reviewed by staff (still sitting in the
  // Incoming tab) are deliberately excluded from every business number --
  // income, profit, sales breakdowns, partner shares -- until a real person
  // confirms them. This also protects against spam/junk submissions ever
  // touching the real books.
  const visibleOrders = useMemo(() => orders.filter((o) => !(o.source === "online" && !o.reviewed)), [orders]);

  const totals = useMemo(() => {
    // income/pending are based on money actually logged (paymentsTotal),
    // not just the paid/unpaid flag -- so a $20 partial payment on an
    // order that's still technically "Unpaid" counts as real income right
    // away, and only the true remaining balance counts as pending.
    const income = visibleOrders.reduce((s, o) => s + paymentsTotal(o), 0);
    const pending = visibleOrders.reduce((s, o) => s + Math.max(0, (Number(o.total) || 0) - paymentsTotal(o)), 0);
    // A delivery fee's driver cut (60%, or the whole fee for an Uber Courier
    // delivery) goes straight to whoever delivered
    // it -- undiluted, never split with other partners, and deliberately
    // NOT modeled as an expense (an expense would get divided by
    // partners.length before being credited back, shrinking their cut).
    // Instead it's carved out of the shared pool entirely: netProfit only
    // ever sees the remaining 40%, and the driver's 60% is tracked and
    // credited to them directly, dollar for dollar.
    // The driver is only credited for what has actually been COLLECTED on the
    // order: a delivery on a part-paid or unpaid order earns its cut as the
    // money comes in, in proportion. (Crediting the full cut up front put the
    // driver ahead of the cash -- the partners were collectively owed more
    // than had been collected until the customer paid.) A fully paid order is
    // unchanged: 60% of the fee, in full.
    const driverCutFor = (o) => {
      if (!(o.deliveryDriverId && Number(o.deliveryFee) > 0)) return 0;
      const paid = paymentsTotal(o);
      const total = Number(o.total) || 0;
      const collectedShare = total > 0.005 ? Math.min(1, paid / total) : 1;
      return Math.min(Number(o.deliveryFee) * driverCutRate(o) * collectedShare, Math.max(0, paid));
    };
    const deliveryEarningsByPartner = {};
    let totalDeliveryDriverEarnings = 0;
    visibleOrders.forEach((o) => {
      const driverCut = driverCutFor(o);
      if (driverCut > 0) {
        deliveryEarningsByPartner[o.deliveryDriverId] = (deliveryEarningsByPartner[o.deliveryDriverId] || 0) + driverCut;
        totalDeliveryDriverEarnings += driverCut;
      }
    });
    const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    // Money handed back to customers (a Reimburse on their credit). When they
    // overpaid, the extra was counted as income -- and so as profit -- but
    // it was never really ours. Giving it back takes it off profit again.
    // Credit used up on a later order is NOT included: that order's total
    // already shrank by the same amount, so it corrects itself.
    const reimbursements = (credits || []).filter((c) => isReimbursement(c) && Number(c.amount) < 0);
    const totalReimbursed = reimbursements.reduce((s, c) => s - Number(c.amount), 0);
    // A refund a partner paid out of their OWN money (e.g. from Zelle they
    // personally hold) is still a cost shared by everyone -- it's in
    // totalReimbursed like any other -- but the partner who handed the money
    // over is credited back for it, since they're holding that much less (or
    // fronted it). It's the same bookkeeping as an expense a partner paid
    // personally.
    const refundsPaidByPartner = {};
    reimbursements.forEach((c) => { if (c.paidBy) refundsPaidByPartner[c.paidBy] = (refundsPaidByPartner[c.paidBy] || 0) - Number(c.amount); });
    const netProfit = income - expenseTotal - totalDeliveryDriverEarnings - totalReimbursed;
    // A partner who was active for only part of history shouldn't have
    // that reshuffle everyone else's past shares -- so profit isn't just
    // divided by today's partner count. Instead, every dollar is divided
    // by however many partners were actually active AT THE TIME it was
    // earned (or spent), and credited only to partners who were active
    // then. A partner who goes inactive keeps everything they already
    // earned up to that point; the partners who remain simply get a
    // bigger slice of profit generated after that, without any
    // retroactive recalculation of history.
    // Active at a date = already started by then (activeFrom) and not yet
    // left (inactiveSince). Partners with neither field -- everyone who
    // existed before this feature -- count for all of history, as before.
    const activePartnersAt = (ts) => partners.filter((p) =>
      (!p.activeFrom || (ts || 0) >= p.activeFrom) && (!p.inactiveSince || (ts || 0) < p.inactiveSince));
    const perPartnerShare = {};
    partners.forEach((p) => { perPartnerShare[p.id] = 0; });
    visibleOrders.forEach((o) => {
      let amt = paymentsTotal(o);
      // The driver's 60% never enters the shared pool for this order --
      // only the remaining amount (delivery's 40% + everything else) gets
      // split among active partners below.
      amt -= driverCutFor(o);
      if (amt <= 0) return;
      const activeAt = activePartnersAt(o.ts);
      if (activeAt.length === 0) return;
      const per = amt / activeAt.length;
      activeAt.forEach((p) => { perPartnerShare[p.id] += per; });
    });
    expenses.forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (amt === 0) return;
      // An expense can name exactly who shares its cost (sharedBy) --
      // for when the automatic "everyone active on that date" isn't right,
      // e.g. a cost that belongs to the new partner but not the one who
      // just left, or the other way round. Otherwise it's automatic.
      const named = Array.isArray(e.sharedBy) && e.sharedBy.length > 0
        ? partners.filter((p) => e.sharedBy.includes(p.id))
        : null;
      const sharers = named && named.length > 0 ? named : activePartnersAt(e.ts);
      if (sharers.length === 0) return;
      const per = amt / sharers.length;
      sharers.forEach((p) => { perPartnerShare[p.id] -= per; });
    });
    reimbursements.forEach((c) => {
      const amt = -Number(c.amount);
      const sharers = activePartnersAt(c.ts);
      if (sharers.length === 0) return;
      const per = amt / sharers.length;
      sharers.forEach((p) => { perPartnerShare[p.id] -= per; });
    });
    // Still exposed as a flat number for anywhere that wants a rough
    // "typical" share (e.g. an average across everyone) -- but each
    // partner's real balance should use perPartnerShare[p.id], not this.
    const share = partners.length ? netProfit / partners.length : 0;
    const withdrawnByPartner = {};
    const collectedByPartner = {};
    const paidExpensesByPartner = {};
    partners.forEach((p) => {
      withdrawnByPartner[p.id] = withdrawals.filter((w) => w.partnerId === p.id).reduce((s, w) => s + Number(w.amount || 0), 0);
      // A Zelle payment a partner personally received is money they're
      // already holding -- it counts against their balance exactly like a
      // withdrawal would, even though no formal withdrawal was made. Cash
      // always lands in the shared drawer, so it's never attributed here.
      // Two sources, kept separate so a split payment (e.g. $100 cash +
      // $35 Zelle) only attributes the actual $35 Zelle portion to
      // whoever received it, not the full order total:
      //   1) Partner "deduct" settlement orders -- unchanged, still
      //      order-level (the whole internal order is the deduction).
      //   2) Individual Zelle payment records across regular customer
      //      orders, whichever partner (if any) received that specific
      //      portion personally -- Cash/Debit/Credit never count here.
      const internalDeduction = visibleOrders
        .filter((o) => o.paid && o.collectedBy === p.id && o.paymentMethod === INTERNAL_METHOD)
        .reduce((s, o) => s + o.total, 0);
      const zelleReceivedPersonally = visibleOrders.reduce(
        (s, o) => s + effectivePayments(o).filter((pay) => pay.method === "Zelle" && pay.collectedBy === p.id).reduce((s2, pay) => s2 + (Number(pay.amount) || 0), 0),
        0
      );
      collectedByPartner[p.id] = internalDeduction + zelleReceivedPersonally;
      // Expenses a partner paid out of their own pocket are the opposite --
      // they fronted business money personally, so it's credited back.
      paidExpensesByPartner[p.id] = expenses.filter((e) => e.paidBy === p.id).reduce((s, e) => s + Number(e.amount || 0), 0);
    });
    // Each partner's balance before any negotiated-settlement adjustment, then
    // the adjustments themselves (see computeSettlementAdjustments).
    const baseBalance = {};
    partners.forEach((p) => {
      baseBalance[p.id] = (perPartnerShare[p.id] || 0) - (withdrawnByPartner[p.id] || 0) - (collectedByPartner[p.id] || 0)
        + (paidExpensesByPartner[p.id] || 0) + (deliveryEarningsByPartner[p.id] || 0) + (refundsPaidByPartner[p.id] || 0);
    });
    const { adjustmentByPartner: settlementAdjustmentByPartner, infoByPartner: settlementInfo } =
      computeSettlementAdjustments(partners, baseBalance, withdrawals);
    const expensePercent = income > 0 ? (expenseTotal / income) * 100 : 0;
    const profitPercent = income > 0 ? (netProfit / income) * 100 : 0;
    return { income, pending, expenseTotal, netProfit, totalReimbursed, share, perPartnerShare, withdrawnByPartner, collectedByPartner, paidExpensesByPartner, deliveryEarningsByPartner, refundsPaidByPartner, settlementAdjustmentByPartner, settlementInfo, expensePercent, profitPercent };
  }, [visibleOrders, expenses, withdrawals, partners, credits]);

  const GlobalStyle = () => (
    <style>{`
      .om-fade{animation:omFade .18s ease-out}
      @keyframes omFade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
      .om-spin{animation:omSpin 1s linear infinite}
      @keyframes omSpin{to{transform:rotate(360deg)}}
      .om-input:focus{outline:none;border-color:${C.ember} !important;box-shadow:0 0 0 3px ${C.emberTint}}
      .om-btn:hover{filter:brightness(0.96)}
      .om-btn:disabled{cursor:not-allowed}
      *{font-family:'Inter',sans-serif;box-sizing:border-box}
    `}</style>
  );

  if (!ready) {
    return (
      <div style={wrap}><GlobalStyle />
        <div style={{ display: "flex", justifyContent: "center", padding: "5rem 0", color: C.muted }}><Loader2 className="om-spin" size={24} /></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={wrap}><GlobalStyle />
        <div style={gateCard} className="om-fade">
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: C.danger }}>Couldn't load the app</div>
          <div style={{ fontSize: 14, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>{loadError}</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
            This usually means the database isn't connected yet, or an environment variable is missing. Check{" "}
            <strong>Vercel → your project → Settings → Environment Variables</strong> (are SUPABASE_URL and{" "}
            SUPABASE_SERVICE_ROLE_KEY set?) and{" "}
            <strong>Vercel → your project → Deployments → Functions/Logs</strong> for the exact error.
          </div>
          <button onClick={refresh} style={primaryBtn} className="om-btn">Try again</button>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div style={wrap}><GlobalStyle />
        <div style={gateCard} className="om-fade">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><div style={badge}><ChefHat size={22} /></div></div>
          <h2 style={displayH1}>Order ledger</h2>
          <p style={{ textAlign: "center", color: C.muted, margin: "6px 0 22px", fontSize: 14, lineHeight: 1.5 }}>
            Enter the shared passcode to continue.
          </p>
          <label style={fieldLabel}>Passcode</label>
          <input type="password" value={passInput} onChange={(e) => { setPassInput(e.target.value); setPassError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()} placeholder="••••" style={input} className="om-input" autoFocus />
          <ErrorText>{passError}</ErrorText>
          <button onClick={handleUnlock} disabled={unlocking} style={{ ...primaryBtn, opacity: unlocking ? 0.7 : 1 }} className="om-btn">
            {unlocking ? <Loader2 className="om-spin" size={15} /> : <Lock size={15} />} {unlocking ? "Checking..." : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  const incomingCount = orders.filter((o) => o.source === "online" && !o.reviewed).length;

  const tabs = [
    { id: "incoming", label: "Incoming", icon: Inbox, badge: incomingCount },
    { id: "orders", label: "New order", icon: Receipt },
    { id: "history", label: "Order history", icon: History },
    { id: "summary", label: "Summary", icon: BarChart3 },
    { id: "plates", label: "Plate totals", icon: ClipboardList },
    { id: "expenses", label: "Expenses", icon: Wallet },
    { id: "partners", label: "Partner shares", icon: Users },
    { id: "settings", label: "Setup", icon: Settings2 },
  ];

  return (
    <div style={wrap}><GlobalStyle />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div style={badge}><ChefHat size={19} /></div>
        <div>
          <h1 style={{ ...displayH1, textAlign: "left", margin: 0 }}>Order ledger</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Live running totals, backed up to Google Sheets</div>
        </div>
      </div>

      <div style={tabRow}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="om-btn"
            style={{ ...tabBtn, background: tab === t.id ? C.moss : "transparent", color: tab === t.id ? "#FAF6EE" : C.muted, position: "relative" }}>
            <t.icon size={15} /> {t.label}
            {t.badge > 0 && (
              <span style={{ background: C.ember, color: "#FAF6EE", fontSize: 11, fontWeight: 700, borderRadius: 999, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <SummaryStrip totals={totals} />

      <div key={tab} className="om-fade">
        {tab === "incoming" && (
          <IncomingOrdersTab orders={orders}
            onMoveToHistory={(id) => act("order", "update", { ...orders.find((o) => o.id === id), reviewed: true })}
            onDelete={(id) => act("order", "delete", { id })} />
        )}
        {tab === "orders" && (
          <NewOrderTab menu={menu} partners={partners} credits={credits} orders={visibleOrders} deliveryZones={deliveryZones}
            onCreate={(order) => act("order", "create", order)}
            onAddCredit={(entry) => act("credits", "create", entry)} />
        )}
        {tab === "history" && (
          <OrderHistoryTab menu={menu} orders={visibleOrders} partners={partners} deliveryZones={deliveryZones} credits={credits}
            onTogglePaid={(id) => act("order", "toggle-paid", { id })}
            onAddPayment={(id, payments) => act("order", "add-payment", { id, payments })}
            onRemovePayment={(id, paymentId) => act("order", "remove-payment", { id, paymentId })}
            onUpdate={(order) => act("order", "update", order)}
            onDelete={(id) => act("order", "delete", { id })}
            onAddCredit={(entry) => act("credits", "create", entry)} />
        )}
        {tab === "summary" && (
          <SummaryTab menu={menu} orders={visibleOrders} partners={partners} credits={credits} withdrawals={withdrawals} expenses={expenses} totals={totals}
            onAddPayment={(id, payments) => act("order", "add-payment", { id, payments })}
            onAddCredit={(entry) => act("credits", "create", entry)}
            onUpdateCredit={(entry) => act("credits", "update", entry)}
            onDeleteCredit={(id) => act("credits", "delete", { id })} />
        )}
        {tab === "plates" && (
          <PlateTotalsTab orders={visibleOrders} menu={menu} />
        )}
        {tab === "expenses" && (
          <ExpensesTab expenses={expenses} partners={partners}
            onCreate={(e) => act("expense", "create", e)}
            onUpdate={(e) => act("expense", "update", e)}
            onDelete={(id) => act("expense", "delete", { id })} />
        )}
        {tab === "partners" && (
          <PartnersTab partners={partners} totals={totals} withdrawals={withdrawals}
            onCreate={(w) => act("withdrawal", "create", w)}
            onUpdate={(w) => act("withdrawal", "update", w)}
            onDelete={(id) => act("withdrawal", "delete", { id })}
            onSetInactive={(p, ts) => act("partners", "set-inactive", { id: p.id, inactiveSince: ts })}
            onReactivate={(p) => act("partners", "reactivate", { id: p.id })}
            onSetSettlement={(p, amount, note, shareDifference) => act("partners", "set-settlement", { id: p.id, amount, note, shareDifference })}
            onClearSettlement={(p) => act("partners", "clear-settlement", { id: p.id })}
            onAddPartner={(name, activeFrom) => act("partners", "add", { name, activeFrom })} />
        )}
        {tab === "settings" && (
          <SettingsTab menu={menu} partners={partners} deliveryZones={deliveryZones}
            backupData={{ menu, partners, orders, expenses, withdrawals, credits, deliveryZones }}
            onAddGroup={(name) => act("menu", "add-group", { name })}
            onRenameGroup={(groupId, name) => act("menu", "rename-group", { groupId, name })}
            onRemoveGroup={(groupId) => act("menu", "remove-group", { groupId })}
            onAddItem={(groupId, item) => act("menu", "add-item", { groupId, item })}
            onUpdateItem={(groupId, item) => act("menu", "update-item", { groupId, item })}
            onRemoveItem={(groupId, itemId) => act("menu", "remove-item", { groupId, itemId })}
            onRenamePartner={(id, name) => act("partners", "rename", { id, name })}
            onResetMenu={() => act("menu", "reset", {})}
            onSyncSheets={() => act("sync-sheets", "run", {})}
            onAddDeliveryZone={(name, fee) => act("delivery-zones", "add", { name, fee })}
            onUpdateDeliveryZone={(id, name, fee) => act("delivery-zones", "update", { id, name, fee })}
            onRemoveDeliveryZone={(id) => act("delivery-zones", "remove", { id })} />
        )}
      </div>
    </div>
  );
}

function IncomingOrdersTab({ orders, onMoveToHistory, onDelete }) {
  const [movingId, setMovingId] = useState(null);
  const [confirmingDuplicateId, setConfirmingDuplicateId] = useState(null);
  const incoming = orders.filter((o) => o.source === "online" && !o.reviewed).sort((a, b) => a.ts - b.ts); // oldest first, first-come-first-served

  const move = async (id) => {
    setMovingId(id);
    await onMoveToHistory(id);
    setMovingId(null);
    setConfirmingDuplicateId(null);
  };

  if (incoming.length === 0) {
    return (
      <div style={emptyState}>
        No new orders from customers right now. Share your order link or QR code (in Setup) to start taking online orders.
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...sectionTitle, marginBottom: 14 }}>{incoming.length} new order{incoming.length === 1 ? "" : "s"} waiting</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {incoming.map((o) => (
          <div key={o.id} style={{ ...card, borderLeft: `4px solid ${o.possibleDuplicate ? C.danger : C.ember}`, padding: 20 }}>
            {o.possibleDuplicate && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.dangerTint, color: C.danger, borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                ⚠️ Possible duplicate — same name or phone ordered recently
              </div>
            )}
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{o.customer}</div>
            {o.phone && <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>{o.phone}</div>}
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
              {new Date(o.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {o.items.map((i, idx) => (
                <div key={idx} style={{ fontSize: 15 }}>
                  <span style={{ fontWeight: 700, color: C.ember }}>{i.qty}×</span> {i.name}{i.variantLabel ? ` (${i.variantLabel})` : ""}
                </div>
              ))}
            </div>
            <div style={{ ...displayNum, fontSize: 18, color: C.moss, marginBottom: 14 }}>{money(o.total)}</div>
            {o.possibleDuplicate && confirmingDuplicateId !== o.id ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setConfirmingDuplicateId(o.id)} style={{ ...primaryBtn, marginTop: 0, background: C.danger }} className="om-btn">
                  Review before preparing
                </button>
                <ConfirmDelete label="incoming order" onConfirm={() => onDelete(o.id)} />
              </div>
            ) : o.possibleDuplicate ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: C.muted }}>Confirm this is a genuine separate order, not a duplicate or mistake.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setConfirmingDuplicateId(null)} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Back</button>
                  <button onClick={() => move(o.id)} disabled={movingId === o.id} style={{ ...primaryBtn, marginTop: 0, opacity: movingId === o.id ? 0.7 : 1 }} className="om-btn">
                    {movingId === o.id ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} Confirmed, move to Order History
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => move(o.id)} disabled={movingId === o.id} style={{ ...primaryBtn, marginTop: 0, opacity: movingId === o.id ? 0.7 : 1 }} className="om-btn">
                  {movingId === o.id ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} Move to Order History
                </button>
                <ConfirmDelete label="incoming order" onConfirm={() => onDelete(o.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryStrip({ totals }) {
  const items = [
    { label: "Income (paid)", value: totals.income, color: C.success },
    { label: "Pending", value: totals.pending, color: C.warning },
    { label: "Expenses", value: totals.expenseTotal, color: C.danger, sub: totals.income > 0 ? `${totals.expensePercent.toFixed(1)}% of income` : null },
    { label: "Net profit", value: totals.netProfit, color: C.moss, sub: totals.income > 0 ? `${totals.profitPercent.toFixed(1)}% margin` : null },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12, marginBottom: 26 }}>
      {items.map((it) => (
        <div key={it.label} style={{ ...statCard, borderTop: `3px solid ${it.color}` }}>
          <div style={statLabel}>{it.label}</div>
          <div style={{ ...statValue, color: it.color }}>{money(it.value)}</div>
          {it.sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function OrderLineRow({ line, menu, onChange, onRemove, removable }) {
  const group = menu.find((g) => g.id === line.groupId);
  const item = group?.items.find((i) => i.id === line.itemId);
  const hasVariants = item && (item.variants?.length || 0) > 1;
  const variant = item?.variants?.find((v) => v.id === line.variantId);
  const price = line.price !== undefined && line.price !== "" ? Number(line.price) : (variant?.price || 0);
  const total = price * (Number(line.qty) || 0);
  const isCustomPrice = variant && Number(line.price) !== variant.price;

  const onGroupChange = (groupId) => {
    const g = menu.find((mg) => mg.id === groupId);
    const it = g?.items?.[0];
    const v = it?.variants?.[0];
    onChange({ ...line, groupId, itemId: it?.id || "", variantId: v?.id || "", price: v?.price ?? "" });
  };
  const onItemChange = (itemId) => {
    const it = group?.items.find((i) => i.id === itemId);
    const v = it?.variants?.[0];
    onChange({ ...line, itemId, variantId: v?.id || "", price: v?.price ?? "" });
  };
  const onVariantChange = (variantId) => {
    const v = item?.variants.find((vv) => vv.id === variantId);
    onChange({ ...line, variantId, price: v?.price ?? "" });
  };

  return (
    <div style={lineBox}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <label style={{ ...fieldLabel, marginBottom: 6 }}>Category</label>
        {removable && (<button onClick={onRemove} style={iconBtn} className="om-btn" aria-label="Remove line"><X size={15} /></button>)}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {menu.map((g) => (
          <button key={g.id} onClick={() => onGroupChange(g.id)} className="om-btn"
            style={{ ...qtyPreset, ...(line.groupId === g.id ? qtyPresetActive : {}) }}>{g.name}</button>
        ))}
      </div>

      <label style={{ ...fieldLabel, marginTop: 12 }}>Item</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {group?.items.map((i) => (
          <button key={i.id} onClick={() => onItemChange(i.id)} className="om-btn"
            style={{ ...qtyPreset, ...(line.itemId === i.id ? qtyPresetActive : {}) }}>{i.name}</button>
        ))}
      </div>

      {hasVariants && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Style</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {(item.variants || []).map((v) => (
              <button key={v.id} onClick={() => onVariantChange(v.id)} className="om-btn"
                style={{ ...qtyPreset, ...(line.variantId === v.id ? qtyPresetActive : {}) }}>{v.label} — {money(v.price)}</button>
            ))}
          </div>
        </>
      )}

      <label style={{ ...fieldLabel, marginTop: 12 }}>Price per item{isCustomPrice ? " (custom)" : ""}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 100 }}
          value={line.price !== undefined ? line.price : (variant?.price ?? "")}
          onChange={(e) => onChange({ ...line, price: e.target.value })} />
        {isCustomPrice && (
          <span style={{ fontSize: 12, color: C.ember }}>
            menu price is {money(variant?.price)} — <button onClick={() => onChange({ ...line, price: variant?.price })} className="om-btn"
              style={{ background: "none", border: "none", color: C.ember, textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>reset</button>
          </span>
        )}
      </div>

      <label style={{ ...fieldLabel, marginTop: 12 }}>Quantity</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        {QTY_PRESETS.map((n) => (
          <button key={n} onClick={() => onChange({ ...line, qty: n })} className="om-btn"
            style={{ ...qtyPreset, ...(Number(line.qty) === n ? qtyPresetActive : {}) }}>{n}</button>
        ))}
        <button onClick={() => onChange({ ...line, qty: Math.max(1, Number(line.qty || 1) - 1) })} style={stepBtn} className="om-btn" aria-label="Decrease quantity">−</button>
        <input type="number" min="1" className="om-input" style={{ ...input, width: 64, textAlign: "center" }}
          value={line.qty} onChange={(e) => onChange({ ...line, qty: e.target.value })} />
        <button onClick={() => onChange({ ...line, qty: Number(line.qty || 0) + 1 })} style={stepBtn} className="om-btn" aria-label="Increase quantity">+</button>
        <div style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: C.moss, fontFamily: "'Space Grotesk', sans-serif" }}>{money(total)}</div>
      </div>
    </div>
  );
}

function firstVariant(item) { return item?.variants?.[0]; }
function firstItem(group) { return group?.items?.[0]; }

function creditBalanceFor(credits, customerName) {
  const key = creditKey(customerName);
  if (!key) return 0;
  return credits.filter((c) => creditKey(c.customer) === key).reduce((s, c) => s + Number(c.amount || 0), 0);
}

function CustomerNameAutocomplete({ value, onChange, pastNames, credits, placeholder }) {
  const [focused, setFocused] = useState(false);
  const blurTimeoutRef = useRef(null);

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return [];
    const matches = pastNames.filter((n) => n.toLowerCase().includes(query) && n.toLowerCase() !== query);
    return matches
      .map((n) => ({ name: n, credit: creditBalanceFor(credits, n) }))
      .sort((a, b) => b.credit - a.credit || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [value, pastNames, credits]);

  const pick = (name) => {
    clearTimeout(blurTimeoutRef.current);
    onChange(name);
    setFocused(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        className="om-input" style={input} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { blurTimeoutRef.current = setTimeout(() => setFocused(false), 150); }}
      />
      {focused && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 20,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", overflow: "hidden",
        }}>
          {suggestions.map((s) => (
            <div
              key={s.name}
              onMouseDown={() => pick(s.name)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 14,
              }}
            >
              <span>{s.name}</span>
              {s.credit > 0 && <span style={{ fontSize: 12, color: C.ember, fontWeight: 600 }}>{money(s.credit)} credit</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewOrderTab({ menu, partners, credits, orders, deliveryZones, onCreate, onAddCredit }) {
  const [customer, setCustomer] = useState("");
  const [tip, setTip] = useState("");
  const [applyCredit, setApplyCredit] = useState(false);
  const [forPartner, setForPartner] = useState(false);
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [settlement, setSettlement] = useState("deduct"); // deduct | cash
  const [orderDate, setOrderDate] = useState(todayDateString());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [deliveryFeeInput, setDeliveryFeeInput] = useState("");
  const [discountType, setDiscountType] = useState("amount"); // amount | percent
  const [discountInput, setDiscountInput] = useState("");
  const pastCustomerNames = useMemo(() => {
    const names = new Set();
    orders.forEach((o) => { if (o.customer?.trim()) names.add(o.customer.trim()); });
    return [...names];
  }, [orders]);
  const makeLine = () => {
    const g = menu[0]; const it = firstItem(g);
    const v = firstVariant(it);
    return { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1, price: v?.price ?? "" };
  };
  const [lines, setLines] = useState(menu.length ? [makeLine()] : []);
  useEffect(() => { if (menu.length && lines.length === 0) setLines([makeLine()]); }, [menu]);

  const getItemFor = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
  const getVariant = (l) => getItemFor(l)?.variants?.find((v) => v.id === l.variantId);
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => setLines([...lines, makeLine()]);
  const linePrice = (l) => {
    const it = getItemFor(l);
    return l.price !== undefined && l.price !== "" ? Number(l.price) : (getVariant(l)?.price || 0);
  };
  const lineTotal = (l) => linePrice(l) * (Number(l.qty) || 0);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tipAmount = forPartner ? 0 : Number(tip) || 0;
  const deliveryZone = deliveryZones.find((z) => z.id === deliveryZoneId);
  const isCustomDelivery = deliveryZoneId === "custom";
  const isUber = deliveryZoneId === "uber";
  // Uber Courier sends the WHOLE fee to the driver; ordinary deliveries split it.
  const deliveryRate = isUber ? 1 : DRIVER_CUT_RATE;
  // The fee always comes from this editable input, not directly from the
  // zone -- picking a zone just pre-fills it as a starting point, so a
  // one-off adjustment (or a location that isn't in the zone list at all,
  // via "Custom") is always possible without touching Setup.
  const deliveryFee = forPartner ? 0 : (Number(deliveryFeeInput) || 0);
  const deliveryLabel = isUber ? DELIVERY_COURIER : isCustomDelivery ? "Custom" : (deliveryZone?.name || "");
  // Only Prashant does deliveries right now, so there's no driver picker --
  // this just finds him by name. If a delivery zone is picked but no
  // partner named "Prashant" exists (e.g. renamed), the fee still counts
  // as ordinary shared revenue; it just skips the personal delivery bonus
  // rather than silently crediting the wrong person.
  const deliveryDriver = findDeliveryDriver(partners);
  // Discount comes off the food subtotal only -- not the tip or delivery
  // fee -- so the delivery driver's 60% cut is never affected by it.
  const discountAmount = forPartner ? 0 : discountAmountFor(subtotal, discountType, discountInput);
  const preTotal = subtotal - discountAmount + tipAmount + deliveryFee;
  const effectiveCustomer = forPartner ? (partners.find((p) => p.id === partnerId)?.name || "") : customer;
  const availableCredit = forPartner ? 0 : creditBalanceFor(credits, customer);
  const creditToApply = applyCredit && availableCredit > 0 ? Math.min(availableCredit, preTotal) : 0;
  const orderTotal = preTotal - creditToApply;

  const submit = async () => {
    if (!effectiveCustomer.trim()) { setError(forPartner ? "Choose a partner." : "Customer name is required."); return; }
    const items = lines
      .filter((l) => {
        const it = getItemFor(l);
        if (!l.groupId || !l.itemId || !(Number(l.qty) > 0)) return false;
        return Boolean(l.variantId);
      })
      .map((l) => {
        const it = getItemFor(l);
        const v = getVariant(l);
        return { name: it?.name || "Item", variantLabel: v?.label || "", price: linePrice(l), qty: Number(l.qty) };
      });
    if (items.length === 0) { setError("Add at least one item with a valid quantity."); return; }
    setError("");
    setSubmitting(true);
    const itemsTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    // Recomputed against the items actually being saved (blank/invalid
    // lines are filtered out above), not the on-screen subtotal.
    const discountSaved = forPartner ? 0 : discountAmountFor(itemsTotal, discountType, discountInput);
    const finalTotal = orderTotalFromParts({ itemsTotal, discount: discountSaved, tip: tipAmount, deliveryFee, creditApplied: creditToApply });
    const ts = dateStringToTs(orderDate);
    const res = await onCreate(
      forPartner
        ? {
            id: uid(), customer: effectiveCustomer.trim(), items, tip: 0, total: itemsTotal,
            paid: true, paymentMethod: settlement === "cash" ? "Cash" : INTERNAL_METHOD,
            collectedBy: settlement === "deduct" ? partnerId : "", ts,
          }
        : {
            id: uid(), customer: customer.trim(), phone: "", items, tip: tipAmount,
            deliveryZone: deliveryLabel, deliveryFee, deliveryCutRate: deliveryFee > 0 ? deliveryRate : 0, deliveryDriverId: deliveryFee > 0 ? (deliveryDriver?.id || "") : "",
            discount: discountSaved, discountType: discountSaved > 0 ? discountType : "", discountValue: discountSaved > 0 ? Number(discountInput) : 0,
            creditApplied: creditToApply, total: finalTotal, paid: false, ts,
          }
    );
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    if (!forPartner && creditToApply > 0) {
      // Tagged with method: "Cash" so this flows through the same
      // reconciliation as a direct reimbursement -- using credit toward a
      // new order still counts as "using it," so it comes off the Cash
      // total the same way handing cash back would.
      const cr = await onAddCredit({ customer: customer.trim(), amount: -creditToApply, method: "Cash", kind: "applied", note: "Applied to a new order" });
      if (cr && !cr.ok) {
        // The order saved but recording the credit as used failed -- say so,
        // otherwise the credit would quietly keep showing as owed.
        setError(`The order was saved, but the ${money(creditToApply)} credit wasn't marked as used. Use "Mark as used" on Summary > Customer credits.`);
      }
    }
    setCustomer(""); setTip(""); setApplyCredit(false); setForPartner(false); setOrderDate(todayDateString()); setLines([makeLine()]); setDeliveryZoneId(""); setDeliveryFeeInput(""); setDiscountInput(""); setDiscountType("amount");
  };

  return (
    <div>
      <div style={card}>
        <div style={cardTitle}>New order</div>
        {menu.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>Add categories and items in Setup first.</div>
        ) : (
          <>
            {partners.length > 0 && (
              <button onClick={() => setForPartner((v) => !v)} className="om-btn"
                style={{ ...quickTagBtn, marginBottom: 12, background: forPartner ? C.ember : "transparent", color: forPartner ? "#FAF6EE" : C.ember }}>
                {forPartner ? "✓ " : ""}This order is for a partner (staff meal)
              </button>
            )}

            {forPartner ? (
              <>
                <label style={fieldLabel}>Which partner?</label>
                <select className="om-input" style={input} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  {partners.filter((p) => isActiveNow(p)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label style={{ ...fieldLabel, marginTop: 12 }}>How is this being settled?</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setSettlement("deduct")} className="om-btn"
                    style={{ ...qtyPreset, flex: 1, ...(settlement === "deduct" ? qtyPresetActive : {}) }}>
                    Deduct from their share
                  </button>
                  <button onClick={() => setSettlement("cash")} className="om-btn"
                    style={{ ...qtyPreset, flex: 1, ...(settlement === "cash" ? qtyPresetActive : {}) }}>
                    They're paying cash
                  </button>
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>
                  {settlement === "deduct"
                    ? "This won't add cash to the till — it comes straight off their partner balance, same as if they'd taken the cash themselves."
                    : "This is treated like a normal cash sale — the till goes up by the full amount, same as any other customer."}
                </div>
              </>
            ) : (
              <>
                <label style={fieldLabel}>Customer name</label>
                <CustomerNameAutocomplete
                  value={customer}
                  onChange={(v) => { setCustomer(v); setError(""); setApplyCredit(false); }}
                  pastNames={pastCustomerNames}
                  credits={credits}
                  placeholder="e.g. Ramesh"
                />
                {availableCredit > 0 && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: C.emberTint, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, color: C.ember }}>{customer.trim()} has {money(availableCredit)} credit available</span>
                    <button onClick={() => setApplyCredit((v) => !v)} className="om-btn"
                      style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.ember}`, background: applyCredit ? C.ember : "transparent", color: applyCredit ? "#FAF6EE" : C.ember, cursor: "pointer" }}>
                      {applyCredit ? "Applying credit ✓" : "Apply credit"}
                    </button>
                  </div>
                )}
              </>
            )}

            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {lines.map((l) => (
                <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
              ))}
            </div>
            <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
            {!forPartner && (
              <>
                <label style={{ ...fieldLabel, marginTop: 16 }}>Tip (optional)</label>
                <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 140 }} placeholder="$0.00" value={tip} onChange={(e) => setTip(e.target.value)} />
                <label style={{ ...fieldLabel, marginTop: 16 }}>Discount (optional)</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
                    {[["amount", "$"], ["percent", "%"]].map(([id, label]) => (
                      <button key={id} onClick={() => setDiscountType(id)} className="om-btn"
                        style={{ padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: discountType === id ? C.moss : "transparent", color: discountType === id ? "#FAF6EE" : C.muted }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 120, marginTop: 0 }}
                    placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 5.00"} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
                  {discountAmount > 0 && (
                    <span style={{ fontSize: 13, color: C.moss }}>
                      −{money(discountAmount)}{discountType === "percent" ? ` (${Number(discountInput)}% of ${money(subtotal)})` : ""}
                    </span>
                  )}
                </div>
                {Number(discountInput) > 0 && discountAmount === 0 && subtotal === 0 && (
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Add items first -- the discount comes off the food subtotal.</div>
                )}
                <label style={{ ...fieldLabel, marginTop: 16 }}>Delivery (optional)</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select className="om-input" style={{ ...input, width: 220, marginTop: 0 }} value={deliveryZoneId}
                    onChange={(e) => {
                      const zid = e.target.value;
                      setDeliveryZoneId(zid);
                      if (zid === "custom" || zid === "uber" || zid === "") setDeliveryFeeInput(zid === "" ? "" : deliveryFeeInput);
                      else { const z = deliveryZones.find((zz) => zz.id === zid); setDeliveryFeeInput(z ? String(z.fee) : ""); }
                    }}>
                    <option value="">Not a delivery / picked up</option>
                    {deliveryZones.map((z) => <option key={z.id} value={z.id}>{z.name} — {money(z.fee)}</option>)}
                    <option value="uber">Uber Courier (full fee to Prashant)</option>
                    <option value="custom">Custom (type your own fee)</option>
                  </select>
                  {deliveryZoneId && (
                    <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 100, marginTop: 0 }}
                      placeholder="Fee $" value={deliveryFeeInput} onChange={(e) => setDeliveryFeeInput(e.target.value)} />
                  )}
                </div>
                {deliveryZoneId && deliveryFee === 0 && (
                  <div style={{ fontSize: 12, color: C.warning, marginTop: 6 }}>Enter a delivery fee, or switch back to "Not a delivery" if there isn't one.</div>
                )}
                {deliveryFee > 0 && (
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                    {deliveryDriver
                      ? (isUber
                        ? `The full ${money(deliveryFee)} goes to ${deliveryDriver.name}.`
                        : `${money(deliveryFee * deliveryRate)} goes straight to ${deliveryDriver.name}, ${money(deliveryFee * (1 - deliveryRate))} to shared profit.`)
                      : `No active partner named "Prashant" found -- the full ${money(deliveryFee)} will count as ordinary shared revenue instead.`}
                  </div>
                )}
              </>
            )}
            <label style={{ ...fieldLabel, marginTop: 16 }}>Order date</label>
            <input type="date" className="om-input" style={{ ...input, width: 170 }} value={orderDate} max={todayDateString()} onChange={(e) => setOrderDate(e.target.value)} />
            {orderDate !== todayDateString() && (
              <div style={{ fontSize: 12, color: C.ember, marginTop: 6 }}>This will be logged as a past order, not today's.</div>
            )}
            <ErrorText>{error}</ErrorText>
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              {(tipAmount > 0 || deliveryFee > 0 || creditToApply > 0 || discountAmount > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginBottom: 6 }}>
                  <span>
                    Subtotal {money(subtotal)}{discountAmount > 0 ? ` − discount ${money(discountAmount)}` : ""}{tipAmount > 0 ? ` + tip ${money(tipAmount)}` : ""}{deliveryFee > 0 ? ` + delivery ${money(deliveryFee)}` : ""}{creditToApply > 0 ? ` − credit ${money(creditToApply)}` : ""}
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={fieldLabel}>Order total</div>
                  <div style={{ ...displayNum, fontSize: 22, color: C.moss }}>{money(orderTotal)}</div>
                </div>
                <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
                  {submitting ? <Loader2 className="om-spin" size={15} /> : <Plus size={15} />} {submitting ? "Saving..." : "Save order"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Turns a saved order's items back into editable menu lines. Each saved
// item is matched to a (category, item, style) in the live menu by SCORE, not
// just by item name. Matching on name alone was the bug: this menu has two
// different items both called "Regular" (Surti Aloopuri's, with Red Sev /
// Papdi / Cheese styles, and Gughara's flat $12 one), and taking the first
// match sent every Gughara item to Aloopuri -- where its $12 then looked
// different from the $9 menu price. The score prefers, in order:
//   - the exact item AND style (100), or the same pair with the two swapped
//     (90 -- older orders saved the topping as the "name" and the style as
//     the "style", e.g. "Red Sev (Regular)")
//   - an item whose name matches but whose style doesn't (30)
//   - then the saved price as a tiebreaker (+10), which is what tells two
//     same-named items apart when neither has a matching style
// Nothing that matches at all falls back to the first menu item, as before.
function orderToLines(order, menu) {
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  return order.items.map((it) => {
    const name = norm(it.name), style = norm(it.variantLabel), price = Number(it.price);
    let best = null;
    for (const g of menu || []) {
      for (const item of g.items || []) {
        const variants = item.variants && item.variants.length ? item.variants : [];
        for (const v of variants) {
          const iname = norm(item.name), vlabel = norm(v.label);
          // a single unlabeled style stands in for "no style" on either side
          const styleMatches = vlabel === style || (variants.length === 1 && style === "");
          let score = 0;
          if (iname === name && styleMatches) score = 100;
          else if (iname === style && vlabel === name) score = 90;
          else if (iname === name) score = 30;
          else if (iname === style && style !== "") score = 20;
          if (score === 0) continue;
          if (Number(v.price) === price) score += 10;
          if (!best || score > best.score) best = { score, g, item, v };
        }
      }
    }
    if (best) return { id: uid(), groupId: best.g.id, itemId: best.item.id, variantId: best.v?.id || "", qty: it.qty, price: it.price };
    // Nothing matched by item name. Older orders were sometimes saved under a
    // CATEGORY's own name (e.g. "Coco" from before it was split into 12 OZ /
    // 1 Liter items) -- keep those in that category, on its closest-priced style.
    const own = (menu || []).find((mg) => norm(mg.name) === name);
    if (own) {
      let near = null;
      for (const item of own.items || []) for (const v of item.variants || []) {
        const d = Math.abs(Number(v.price) - price);
        if (!near || d < near.d) near = { d, item, v };
      }
      if (near) return { id: uid(), groupId: own.id, itemId: near.item.id, variantId: near.v.id, qty: it.qty, price: it.price };
    }
    const g = (menu || [])[0]; const item = firstItem(g);
    const v = firstVariant(item);
    return { id: uid(), groupId: g?.id || "", itemId: item?.id || "", variantId: v?.id || "", qty: it.qty, price: it.price };
  });
}

function OrderEditForm({ order, menu, partners, deliveryZones, onSave, onAddCredit, onCancel }) {
  const [customer, setCustomer] = useState(order.customer);
  const [phone, setPhone] = useState(order.phone || "");
  const [lines, setLines] = useState(orderToLines(order, menu));
  const [tip, setTip] = useState(order.tip ? String(order.tip) : "");
  // Who holds the money. A partner meal's deduction is the order-level label; for
  // anything else it's whoever received the Zelle payment(s) -- see zelleCollectorOf.
  const isInternalOrder = order.paymentMethod === INTERNAL_METHOD;
  const zelleCollector = isInternalOrder ? undefined : zelleCollectorOf(order);
  const [collectedBy, setCollectedBy] = useState(isInternalOrder ? (order.collectedBy || "") : (zelleCollector ?? (order.collectedBy || "")));
  const [collectorTouched, setCollectorTouched] = useState(false);
  const [orderDate, setOrderDate] = useState(tsToDateString(order.ts || Date.now()));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [extraMethod, setExtraMethod] = useState("Cash");
  const [extraAmountOverride, setExtraAmountOverride] = useState(null); // null = still tracking the live diff automatically
  // When a bill that's already Paid goes DOWN, the customer has paid more than
  // it now costs. Either that extra was handed back ("refund": taken off the
  // payments) or the customer is keeping it as credit with us ("credit").
  const [lowerBillChoice, setLowerBillChoice] = useState("refund");
  // Delivery starts out as whatever the order already has: none, one of the
  // zones, Uber Courier, or "custom" (a typed fee / a zone since removed).
  const [deliveryZoneId, setDeliveryZoneId] = useState(() => {
    if (!(Number(order.deliveryFee) > 0)) return "";
    if (order.deliveryZone === DELIVERY_COURIER) return "uber";
    const z = (deliveryZones || []).find((zz) => zz.name === order.deliveryZone);
    return z ? z.id : "custom";
  });
  const [deliveryFeeInput, setDeliveryFeeInput] = useState(Number(order.deliveryFee) > 0 ? String(order.deliveryFee) : "");
  const getItemFor = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
  const getVariant = (l) => getItemFor(l)?.variants?.find((v) => v.id === l.variantId);
  const linePrice = (l) => {
    const it = getItemFor(l);
    return l.price !== undefined && l.price !== "" ? Number(l.price) : (getVariant(l)?.price || 0);
  };
  const lineTotal = (l) => linePrice(l) * (Number(l.qty) || 0);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tipAmount = Number(tip) || 0;
  const isPartnerMeal = order.paymentMethod === INTERNAL_METHOD; // staff meals never have delivery
  const creditApplied = Number(order.creditApplied) || 0;
  const baseItems = (order.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  // The total is rebuilt from its parts -- items, discount, tip, delivery fee,
  // applied credit -- with the same formula New Order uses. It used to keep
  // the stored total and adjust around it, which also carried along any
  // mistake already in it. `savedTotalOff` flags an order whose saved total
  // doesn't match its own parts; saving corrects it.
  const storedParts = orderTotalFromParts({ itemsTotal: baseItems, discount: Number(order.discount) || 0, tip: Number(order.tip) || 0, deliveryFee: Number(order.deliveryFee) || 0, creditApplied });
  const savedTotalOff = Math.abs(storedParts - (Number(order.total) || 0)) > 0.011;
  // A % discount follows the new subtotal if items change; a $ discount
  // stays the same dollar amount (capped at the subtotal).
  const discountFor = (sub) => (order.discountType ? discountAmountFor(sub, order.discountType, order.discountValue) : 0);
  const discountAmount = discountFor(subtotal);
  const deliveryFee = !isPartnerMeal && deliveryZoneId ? Number(deliveryFeeInput) || 0 : 0;
  const deliveryDriver = findDeliveryDriver(partners);
  const total = orderTotalFromParts({ itemsTotal: subtotal, discount: discountAmount, tip: tipAmount, deliveryFee, creditApplied });
  // How much is actually logged as paid on this order right now, vs. what
  // the bill comes to after this edit. If they differ and the order was
  // already marked Paid, the payments ledger would otherwise silently go
  // stale -- the order would keep showing "Paid" while the Cash Drawer
  // total quietly stops matching the real total. See the diff-handling
  // block in save() below.
  const alreadyLogged = paymentsTotal(order);
  const diff = total - alreadyLogged;
  const extraAmount = extraAmountOverride !== null ? extraAmountOverride : (diff > 0.001 ? diff.toFixed(2) : "");
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => {
    const g = menu[0]; const it = firstItem(g);
    const v = firstVariant(it);
    setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1, price: v?.price ?? "" }]);
  };
  const save = async () => {
    if (!customer.trim()) { setError("Customer name is required."); return; }
    if (phone.trim() && !isValidPhone(phone)) { setError("Enter a valid phone number (at least 10 digits), or leave it blank."); return; }
    const items = lines
      .filter((l) => {
        const it = getItemFor(l);
        if (!l.groupId || !l.itemId || !(Number(l.qty) > 0)) return false;
        return Boolean(l.variantId);
      })
      .map((l) => {
        const it = getItemFor(l);
        const v = getVariant(l);
        return { name: it?.name || "Item", variantLabel: v?.label || "", price: linePrice(l), qty: Number(l.qty) };
      });
    if (items.length === 0) { setError("Add at least one item with a valid quantity."); return; }
    setError("");
    setSubmitting(true);
    const itemsTotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const discountSaved = discountFor(itemsTotal);
    // Delivery: Uber Courier sends the whole fee to the driver; a zone or custom
    // fee splits it. A partner meal has none and is left exactly as it was.
    const isUberSave = deliveryZoneId === "uber";
    const feeSaved = isPartnerMeal ? 0 : (deliveryZoneId ? deliveryFee : 0);
    const zoneSaved = isUberSave ? DELIVERY_COURIER : deliveryZoneId === "custom" ? "Custom" : ((deliveryZones || []).find((z) => z.id === deliveryZoneId)?.name || "");
    const driverSaved = feeSaved > 0 ? (isUberSave ? (deliveryDriver?.id || order.deliveryDriverId || "") : (order.deliveryDriverId || deliveryDriver?.id || "")) : "";
    const newTotal = orderTotalFromParts({ itemsTotal, discount: discountSaved, tip: tipAmount, deliveryFee: feeSaved, creditApplied });

    let payments = effectivePayments(order);
    let paid = order.paid;
    let keepAsCredit = null;
    if (order.paid) {
      const gap = newTotal - alreadyLogged;
      if (gap > 0.001) {
        // Bill went up -- log whatever amount was actually collected for
        // the difference (0 if the customer hasn't paid it yet).
        const collected = Number(extraAmount) || 0;
        if (collected > 0) {
          payments = [...payments, { id: uid(), method: extraMethod, amount: collected, collectedBy: "", ts: Date.now() }];
        }
        const newSum = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        paid = newSum >= newTotal - 0.001; // stays Paid only if the gap was fully covered
      } else if (gap < -0.001) {
        if (lowerBillChoice === "credit") {
          // The customer keeps the extra as credit with us: the payments stay exactly
          // as logged (that money really is in the drawer), the order records how much
          // was received, and the same credit entry "Paid more than the bill?" would
          // make is created -- only for the part that's new from THIS edit, so any
          // overpayment already recorded isn't counted twice.
          keepAsCredit = creditFromLoweredBill({ order, newTotal, alreadyLogged });
        } else {
          // Refunded -- trim the ledger to match, most-recent first.
          payments = trimPayments(payments, -gap);
        }
        paid = true; // a lower bill that was already fully paid is still fully paid
      }
    }

    // Moving who received the Zelle changes the payment itself (that's what the
    // balances read), not just a label -- and only when the dropdown was used.
    if (!isInternalOrder && collectorTouched && zelleCollector !== undefined) payments = withZelleCollector(payments, collectedBy);
    const res = await onSave({
      ...order, customer: customer.trim(), phone: phone.trim(), items, tip: tipAmount, total: newTotal,
      discount: discountSaved,
      ...(isPartnerMeal ? {} : {
        deliveryZone: feeSaved > 0 ? zoneSaved : "", deliveryFee: feeSaved,
        deliveryCutRate: feeSaved > 0 ? (isUberSave ? 1 : DRIVER_CUT_RATE) : 0, deliveryDriverId: driverSaved,
      }),
      ...(keepAsCredit ? { amountReceived: keepAsCredit.amountReceived } : {}),
      payments, paid, collectedBy: paid ? (isInternalOrder || collectorTouched ? collectedBy : (order.collectedBy || "")) : "", ts: dateStringToTs(orderDate),
    });
    if (res && res.ok && keepAsCredit && keepAsCredit.extra > 0.005 && onAddCredit) {
      await onAddCredit({ customer: customer.trim(), amount: keepAsCredit.extra, note: `Overpayment on order for ${customer.trim()}` });
    }
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing order</div>
      {savedTotalOff && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: C.warningTint, border: `1px solid ${C.warning}44`, fontSize: 13, color: C.warning }}>
          This order's saved total ({money(order.total)}) doesn't add up to its items, tip, delivery, discount and credit ({money(storedParts)}). Saving corrects it to {money(storedParts)}.
        </div>
      )}
      <label style={fieldLabel}>Customer name</label>
      <input className="om-input" style={input} value={customer} onChange={(e) => { setCustomer(e.target.value); setError(""); }} />
      <label style={{ ...fieldLabel, marginTop: 12 }}>Phone number (optional)</label>
      <input type="tel" className="om-input" style={input} value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} />
      {order.paid && (isInternalOrder || zelleCollector !== undefined) && (
        zelleCollector === null ? (
          <div style={{ marginTop: 12, fontSize: 12, color: C.muted }}>Different partners received different Zelle payments on this order, so it can't be changed here.</div>
        ) : (
          <>
            <label style={{ ...fieldLabel, marginTop: 12 }}>{isInternalOrder ? "Collected by" : "Zelle received by"}</label>
            <select className="om-input" style={input} value={collectedBy} onChange={(e) => { setCollectedBy(e.target.value); setCollectorTouched(true); }}>
              <option value="">Shared account</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {!isInternalOrder && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>This moves the Zelle between partners' balances. Cash is always in the shared drawer, so there's nothing to pick for it.</div>}
          </>
        )
      )}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {lines.map((l) => (
          <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
        ))}
      </div>
      <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
      <label style={{ ...fieldLabel, marginTop: 16 }}>Tip (optional)</label>
      <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 140 }} placeholder="$0.00" value={tip} onChange={(e) => setTip(e.target.value)} />
      {!isPartnerMeal && (
        <>
          <label style={{ ...fieldLabel, marginTop: 16 }}>Delivery (optional)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="om-input" style={{ ...input, width: 220, marginTop: 0 }} value={deliveryZoneId}
              onChange={(e) => {
                const zid = e.target.value;
                setDeliveryZoneId(zid);
                if (zid === "") setDeliveryFeeInput("");
                else if (zid !== "custom" && zid !== "uber") { const z = (deliveryZones || []).find((zz) => zz.id === zid); setDeliveryFeeInput(z ? String(z.fee) : ""); }
              }}>
              <option value="">Not a delivery / picked up</option>
              {(deliveryZones || []).map((z) => <option key={z.id} value={z.id}>{z.name} — {money(z.fee)}</option>)}
              <option value="uber">Uber Courier (full fee to Prashant)</option>
              <option value="custom">Custom (type your own fee)</option>
            </select>
            {deliveryZoneId && (
              <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 100, marginTop: 0 }}
                placeholder="Fee $" value={deliveryFeeInput} onChange={(e) => setDeliveryFeeInput(e.target.value)} />
            )}
          </div>
          {deliveryZoneId && deliveryFee === 0 && (
            <div style={{ fontSize: 12, color: C.warning, marginTop: 6 }}>Enter a delivery fee, or switch back to "Not a delivery" if there isn't one.</div>
          )}
          {deliveryFee > 0 && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              {deliveryDriver
                ? (deliveryZoneId === "uber"
                  ? `The full ${money(deliveryFee)} goes to ${deliveryDriver.name}.`
                  : `${money(deliveryFee * DRIVER_CUT_RATE)} goes straight to ${deliveryDriver.name}, ${money(deliveryFee * (1 - DRIVER_CUT_RATE))} to shared profit.`)
                : `No active partner named "Prashant" found -- the full ${money(deliveryFee)} will count as ordinary shared revenue instead.`}
            </div>
          )}
        </>
      )}
      <label style={{ ...fieldLabel, marginTop: 16 }}>Order date</label>
      <input type="date" className="om-input" style={{ ...input, width: 170 }} value={orderDate} max={todayDateString()} onChange={(e) => setOrderDate(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      {order.paid && diff > 0.001 && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: C.warningTint, border: `1px solid ${C.warning}44` }}>
          <div style={{ fontSize: 13, color: C.warning, fontWeight: 600, marginBottom: 8 }}>
            This adds {money(diff)} to a bill already marked Paid — how was the extra paid?
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 130px" }} value={extraMethod} onChange={(e) => setExtraMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 100px" }}
              placeholder="0.00 if not paid yet" value={extraAmount} onChange={(e) => setExtraAmountOverride(e.target.value)} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            Leave it at {money(0)} if the customer hasn't paid the difference yet — the order will show as Partial instead of Paid.
          </div>
        </div>
      )}
      {order.paid && diff < -0.001 && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: C.warningTint, border: `1px solid ${C.warning}44` }}>
          <div style={{ fontSize: 13, color: C.warning, fontWeight: 600, marginBottom: 8 }}>
            This lowers a bill that's already marked Paid by {money(-diff)}. What happens to that {money(-diff)}?
          </div>
          {[
            ["refund", "Refund it", "Take it off the payments, as if you gave it back to them."],
            ["credit", `Keep it as credit for ${customer.trim() || "this customer"}`, "They paid it and you owe it to them. The payment stays as logged, and it shows under Customer credits to use on a later order or Reimburse."],
          ].map(([value, title, hint]) => (
            <label key={value} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginTop: 6 }}>
              <input type="radio" name="lowerBillChoice" checked={lowerBillChoice === value} onChange={() => setLowerBillChoice(value)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13 }}><b>{title}</b><span style={{ display: "block", fontSize: 12, color: C.muted }}>{hint}</span></span>
            </label>
          ))}
        </div>
      )}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        {(tipAmount > 0 || discountAmount > 0 || deliveryFee > 0 || creditApplied > 0) && (
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Subtotal {money(subtotal)}{discountAmount > 0 ? ` − discount ${money(discountAmount)}` : ""}{tipAmount > 0 ? ` + tip ${money(tipAmount)}` : ""}{deliveryFee > 0 ? ` + delivery ${money(deliveryFee)}` : ""}{creditApplied > 0 ? ` − credit ${money(creditApplied)}` : ""}</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={fieldLabel}>New total</div>
          <div style={{ ...displayNum, fontSize: 22, color: C.moss }}>{money(total)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
          <button onClick={save} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
            {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  </div>
  );
}

function CollectorPicker({ order, partners, onConfirm, onCancel }) {
  const [collectedBy, setCollectedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const confirm = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await onConfirm(collectedBy);
    setSubmitting(false);
  };

  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", borderLeft: `3px solid ${C.warning}` }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>{order.customer} — {money(order.total)}</div>
      <label style={fieldLabel}>Who collected this payment?</label>
      <select className="om-input" style={input} value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)}>
        <option value="">Shared account</option>
        {partners.filter((p) => isActiveNow(p)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Mark paid"}
        </button>
      </div>
    </div>
  );
}

// Historical orders sometimes recorded the same dish under swapped
// item/variant text (e.g. one order as "Red Sev (Regular)", another as
// "Regular (Red Sev)") -- same dish, just which field held the topping vs.
// the style flipped at some point. Treating {name, variantLabel} as an
// unordered pair (sorted, case-insensitive) means both spellings land in
// the same bucket no matter which field held which value historically.
function swapMergeKey(name, variantLabel) {
  const parts = variantLabel ? [name, variantLabel] : [name];
  return parts.map((p) => p.trim().toLowerCase()).sort().join("||");
}

// Old Coco-family orders (before the menu was cleaned up) recorded the
// item name as a bare size like "12 OZ" or "1 Liter", with the flavor in
// variantLabel -- e.g. name="12 OZ", variantLabel="Kaju". The current menu
// instead has one "Coco" item with the size+flavor combined into a single
// Style pick. Both shapes mean the same thing: a Coco drink. This list is
// how historical orders get recognized as belonging to the Coco category
// even though their literal item name doesn't say "Coco" -- add to it if
// another old size-only name turns up later. Kept separate from
// COCO_FAMILY_ALIASES (below) because a bare "Coco" row needs different
// relabeling treatment ("Plain") than a bare size row ("12 OZ" -> the size
// itself, once there's a flavor to pair it with).
const COCO_SIZE_ALIASES = ["12 oz", "1 liter", "1 litre"];
const COCO_FAMILY_ALIASES = ["coco", ...COCO_SIZE_ALIASES];

// Groups sold plates by their CURRENT live menu category (Setup tab order),
// merging swapped-field duplicates within each category first. Order line
// items only ever store a name/variant snapshot, not which category they
// came from -- so category is determined by matching that snapshot against
// today's menu. An item that's since been renamed or removed, or an old
// Coco-family name, falls back to a best-effort match; anything that
// matches nothing lands in "Other" rather than silently vanishing.
function computeItemBreakdown(orders, menu) {
  // Pass 1: merge swapped-field duplicates (e.g. "Red Sev (Regular)" and
  // "Regular (Red Sev)" are the same dish), keeping every contributing raw
  // spelling + qty so category-matching below can check all of them, not
  // just whichever spelling happened to be more common.
  const merged = {};
  orders.forEach((o) => {
    (o.items || []).forEach((i) => {
      const mkey = swapMergeKey(i.name, i.variantLabel);
      if (!merged[mkey]) merged[mkey] = { variants: {}, qty: 0, revenue: 0 };
      const b = merged[mkey];
      b.qty += Number(i.qty) || 0;
      b.revenue += (Number(i.price) || 0) * (Number(i.qty) || 0);
      const label = i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name;
      b.variants[label] = (b.variants[label] || 0) + (Number(i.qty) || 0);
    });
  });

  // Two lookups from the live menu:
  //  - pairToCategory: exact (item name, variant label) -> category. This
  //    is the precise match -- it's what correctly tells apart two
  //    DIFFERENT items that happen to share a name across categories
  //    (e.g. this menu has a "Regular" item under Surti Aloopuri with
  //    Red Sev/Papdi/Cheese as variants, AND a completely separate
  //    "Regular" item under Gughara with no variants at all -- matching
  //    on bare name alone would silently collide the two).
  //  - unambiguousNameToCategory: bare item name -> category, but ONLY for
  //    names that exist in exactly one category. An ambiguous bare name
  //    (like "Regular" here) is deliberately left out, so a historical
  //    order with no variant info falls to "Other" instead of guessing
  //    between two real possibilities.
  const pairToCategory = {};
  const nameCategories = {};
  (menu || []).forEach((g) => {
    (g.items || []).forEach((it) => {
      const iname = it.name.trim().toLowerCase();
      nameCategories[iname] = nameCategories[iname] || new Set();
      nameCategories[iname].add(g.name);
      (it.variants || []).forEach((v) => {
        if (v.label) pairToCategory[`${iname}||${v.label.trim().toLowerCase()}`] = g.name;
      });
    });
  });
  const unambiguousNameToCategory = {};
  Object.entries(nameCategories).forEach(([name, cats]) => {
    if (cats.size === 1) unambiguousNameToCategory[name] = [...cats][0];
  });
  const cocoCategoryName = (menu || []).find((g) => g.name.trim().toLowerCase() === "coco")?.name || "Coco";
  // Items that don't match anything (an old name, an ambiguous bare name
  // like "Regular" that exists in more than one category) default into
  // Gughara rather than a separate "Other" bucket -- that's genuinely
  // where these items belong for this menu. Uses the live menu's actual
  // Gughara category if one exists, so unmatched items merge into the
  // SAME bucket as items that matched it properly, rather than creating a
  // second, separate "Gughara"-looking group.
  const fallbackCategoryName = (menu || []).find((g) => g.name.trim().toLowerCase() === "gughara")?.name || "Gughara";

  const splitLabel = (label) => {
    const m = label.match(/^(.*?)(?:\s*\((.*)\))?$/);
    return { outer: (m?.[1] || label).trim(), inner: m?.[2]?.trim() };
  };

  const categories = {}; // categoryName -> { rows: {} }
  const bucketOf = (name) => (categories[name] = categories[name] || { rows: {} });

  Object.values(merged).forEach((b) => {
    const [bestLabel] = Object.entries(b.variants).sort((a, z) => z[1] - a[1] || a[0].localeCompare(z[0]))[0];
    const { outer, inner } = splitLabel(bestLabel);

    // Vote for a category across every contributing spelling (weighted by
    // qty), since a swap could put the real item name in either field.
    // Exact (name, variant) pair match takes priority over the bare-name
    // fallback -- it's the only thing that can tell apart two same-named
    // items in different categories.
    const votes = {};
    Object.entries(b.variants).forEach(([label, qty]) => {
      const parts = splitLabel(label);
      let cat = null;
      if (parts.inner) {
        cat = pairToCategory[`${parts.outer.toLowerCase()}||${parts.inner.toLowerCase()}`]
          || pairToCategory[`${parts.inner.toLowerCase()}||${parts.outer.toLowerCase()}`];
      }
      if (!cat) cat = unambiguousNameToCategory[parts.outer.toLowerCase()] || unambiguousNameToCategory[parts.inner?.toLowerCase()];
      if (!cat && (COCO_FAMILY_ALIASES.includes(parts.outer.toLowerCase()) || COCO_FAMILY_ALIASES.includes(parts.inner?.toLowerCase()))) {
        cat = cocoCategoryName;
      }
      if (cat) votes[cat] = (votes[cat] || 0) + qty;
    });
    const category = Object.entries(votes).sort((a, z) => z[1] - a[1])[0]?.[0] || fallbackCategoryName;

    // Within the Coco category specifically, relabel old size-as-item-name
    // rows ("12 OZ (Kaju)") to read as "Kaju (12 OZ)" for consistency with
    // the current single-Coco-item menu shape, and a bare "Coco"/"12 OZ"
    // row (no flavor) reads as "Plain".
    let displayLabel = bestLabel;
    if (category === cocoCategoryName) {
      const outerIsSize = COCO_SIZE_ALIASES.includes(outer.toLowerCase());
      displayLabel = outerIsSize ? (inner ? `${inner} (${outer})` : outer) : outer.toLowerCase() === "coco" ? (inner || "Plain") : bestLabel;
    }

    const rows = bucketOf(category).rows;
    rows[displayLabel] = rows[displayLabel] || { key: displayLabel, qty: 0, revenue: 0 };
    rows[displayLabel].qty += b.qty;
    rows[displayLabel].revenue += b.revenue;
  });

  // Category order follows the live menu's Setup order, with unmatched
  // items' fallback category (Gughara) sorting wherever it naturally
  // falls in that same order.
  const categoryOrder = (menu || []).map((g) => g.name);
  const allCategoryNames = Object.keys(categories).sort((a, z) => {
    const ai = categoryOrder.indexOf(a), zi = categoryOrder.indexOf(z);
    if (ai === -1 && zi === -1) return a.localeCompare(z);
    if (ai === -1) return 1;
    if (zi === -1) return -1;
    return ai - zi;
  });

  return allCategoryNames.map((name) => {
    const rows = Object.values(categories[name].rows).sort((a, b) => b.revenue - a.revenue);
    return {
      name,
      rows,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
    };
  });
}

function computeDailyBreakdown(orders) {
  const map = {};
  orders.forEach((o) => {
    const d = new Date(o.ts || Date.now());
    const dateKey = tsToDateString(d.getTime()); // local calendar date, consistent with the date picker
    if (!map[dateKey]) {
      map[dateKey] = {
        dateKey,
        label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        plates: 0,
        revenue: 0,
      };
    }
    (o.items || []).forEach((i) => {
      map[dateKey].plates += Number(i.qty) || 0;
      map[dateKey].revenue += (Number(i.price) || 0) * (Number(i.qty) || 0);
    });
  });
  // Most recent date first. Days with zero orders simply never get a key here,
  // so nothing needs to be manually filtered out or entered.
  return Object.values(map).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function DailyBreakdown({ orders }) {
  const rows = computeDailyBreakdown(orders);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Plates sold by day</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Only shows days that actually had orders</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.dateKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{r.label}</div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.muted }}>{r.plates} plate{r.plates === 1 ? "" : "s"}</span>
              <span style={{ fontSize: 12, color: C.muted }}>avg {money(r.plates > 0 ? r.revenue / r.plates : 0)}/plate</span>
              <span style={{ ...displayNum, fontSize: 14, color: C.moss }}>{money(r.revenue)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesBreakdown({ orders, menu }) {
  const categories = computeItemBreakdown(orders, menu);
  if (categories.length === 0) return null;
  const grandQty = categories.reduce((s, c) => s + c.qty, 0);
  const grandRevenue = categories.reduce((s, c) => s + c.revenue, 0);
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Plates sold by item</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Across all orders, paid and unpaid — grouped by category</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {categories.map((cat) => (
          <div key={cat.name}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{cat.name}</div>
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: C.muted }}>{cat.qty} plate{cat.qty === 1 ? "" : "s"}</span>
                <span style={{ ...displayNum, fontSize: 13, color: C.moss }}>{money(cat.revenue)}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {cat.rows.map((r, idx) => (
                <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 14 }}><span style={{ color: C.muted, marginRight: 8 }}>{idx + 1}.</span>{r.key}</div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: C.muted }}>{r.qty} plate{r.qty === 1 ? "" : "s"}</span>
                    <span style={{ ...displayNum, fontSize: 14, color: C.moss }}>{money(r.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Total, all categories</div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{grandQty} plate{grandQty === 1 ? "" : "s"}</span>
            <span style={{ ...displayNum, fontSize: 15, color: C.ember }}>{money(grandRevenue)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AmountReceivedPicker({ order, onConfirm, onCancel }) {
  const [amount, setAmount] = useState(String(order.amountReceived ?? order.total));
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false); // guards against a rapid double-click firing this twice before React re-renders the disabled button
  const change = Math.max(0, (Number(amount) || 0) - order.total);

  const confirm = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    await onConfirm(Number(amount) || 0);
    setSubmitting(false);
  };

  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", borderLeft: `3px solid ${C.ember}` }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{order.customer} — bill is {money(order.total)}</div>
      {order.amountReceived !== undefined && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Currently on file: received {money(order.amountReceived)}</div>
      )}
      <label style={fieldLabel}>Amount actually received</label>
      <input type="number" step="0.01" min="0" className="om-input" style={input} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      {change > 0 && (
        <div style={{ fontSize: 13, color: C.ember, marginTop: 8 }}>
          They overpaid by {money(change)} — this will be tracked as credit for {order.customer}, to apply toward a future order.
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// Trims the most-recently-logged payments first when the amount actually
// owed on an order drops below what's already been logged as paid -- e.g.
// an item gets removed after the order was marked paid, or a previously
// recorded overpayment gets corrected downward. Keeps the ledger's total
// in sync with the new, lower amount without a separate refund flow.
function trimPayments(payments, amountToRemove) {
  let remaining = amountToRemove;
  const result = [];
  for (let i = payments.length - 1; i >= 0; i--) {
    const p = payments[i];
    if (remaining <= 0.001) { result.unshift(p); continue; }
    if (p.amount <= remaining + 0.001) { remaining -= p.amount; }
    else { result.unshift({ ...p, amount: p.amount - remaining }); remaining = 0; }
  }
  return result;
}

function PaymentRecorder({ order, partners, onConfirm, onCancel }) {
  const alreadyPaid = paymentsTotal(order);
  const remaining = Math.max(0, order.total - alreadyPaid);
  const [rows, setRows] = useState([{ method: "Cash", amount: remaining > 0 ? String(remaining) : "", collectedBy: "" }]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const rowsTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const newRemaining = Math.max(0, remaining - rowsTotal);
  // Logging more than what's still owed would count the same money twice
  // (the usual cause: an order flipped Paid -> Unpaid keeps its logged
  // payment, so paying it again stacks a second one on top).
  const alreadyFullyLogged = remaining <= 0.001;
  const overLimit = rowsTotal > remaining + 0.001;

  const updateRow = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows([...rows, { method: "Zelle", amount: "", collectedBy: "" }]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));

  const confirm = async () => {
    if (submittedRef.current) return;
    const cleaned = rows.filter((r) => Number(r.amount) > 0);
    if (cleaned.length === 0) { setError("Enter at least one payment amount."); return; }
    if (alreadyFullyLogged || overLimit) return; // blocked -- message is already showing below
    submittedRef.current = true;
    setError("");
    setSubmitting(true);
    // Only Cash is ever physically held by a partner -- Zelle/Debit/Credit
    // land straight in a bank account, so collectedBy is meaningless (and
    // dropped) for those, even if a row briefly had one set before the
    // method was switched.
    // Cash always lands in the shared drawer -- no attribution needed.
    // Zelle goes to whichever specific phone/email the customer sent it
    // to, which could be a partner's personal account, so that's the one
    // that needs a collector.
    const res = await onConfirm(cleaned.map((r) => ({ method: r.method, amount: Number(r.amount), collectedBy: r.method === "Zelle" ? r.collectedBy : "" })));
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); submittedRef.current = false; }
  };

  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", borderLeft: `3px solid ${C.ember}` }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{order.customer} — bill is {money(order.total)}</div>
      {alreadyPaid > 0 && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Already logged: {money(alreadyPaid)} — {money(remaining)} remaining</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 130px" }} value={r.method} onChange={(e) => updateRow(i, { method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 100px" }}
              placeholder="Amount" value={r.amount} onChange={(e) => updateRow(i, { amount: e.target.value })} />
            {r.method === "Zelle" && (
              <select className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 150px", fontSize: 12 }}
                value={r.collectedBy} onChange={(e) => updateRow(i, { collectedBy: e.target.value })}>
                <option value="">Zelle → shared account</option>
                {partners.filter((p) => isActiveNow(p)).map((p) => <option key={p.id} value={p.id}>Zelle → {p.name} personally</option>)}
              </select>
            )}
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} style={{ ...iconBtn, width: 32, height: 32 }} className="om-btn" aria-label="Remove payment row"><X size={13} /></button>
            )}
          </div>
        ))}
      </div>
      <button onClick={addRow} className="om-btn" style={{ ...quickTagBtn, marginTop: 8, alignSelf: "flex-start" }}>+ Split across another method</button>
      {alreadyFullyLogged ? (
        <div style={{ fontSize: 13, marginTop: 10, color: C.danger }}>
          Already fully logged: {money(alreadyPaid)} of {money(order.total)}. Logging another payment would count the same money twice. If the payment above is a mistake, remove it from the order's payment list instead.
        </div>
      ) : overLimit ? (
        <div style={{ fontSize: 13, marginTop: 10, color: C.danger }}>
          {money(rowsTotal)} is more than the {money(remaining)} still owed. Lower the amount (if the customer paid extra, use "Paid more than the bill?" after the order is Paid).
        </div>
      ) : (
        <div style={{ fontSize: 13, marginTop: 10, color: newRemaining > 0.001 ? C.ember : C.moss }}>
          {newRemaining > 0.001
            ? `${money(rowsTotal)} entered — ${money(newRemaining)} will still be owed after this`
            : `${money(rowsTotal)} entered — covers the full remaining balance (order will be marked Paid)`}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting || alreadyFullyLogged || overLimit} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: (submitting || alreadyFullyLogged || overLimit) ? 0.5 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Log payment"}
        </button>
      </div>
    </div>
  );
}

function CreditEditForm({ entry, onSave, onCancel }) {
  const [amount, setAmount] = useState(String(entry.amount));
  const [note, setNote] = useState(entry.note || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const save = async () => {
    if (submittedRef.current) return;
    if (amount === "" || Number.isNaN(Number(amount))) { setError("Enter a valid amount."); return; }
    submittedRef.current = true;
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...entry, amount: Number(amount), note });
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); submittedRef.current = false; }
  };

  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch" }}>
      <label style={fieldLabel}>Amount (positive = owed to customer, negative = already applied/used)</label>
      <input type="number" step="0.01" className="om-input" style={input} value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} autoFocus />
      <label style={{ ...fieldLabel, marginTop: 10 }}>Note</label>
      <input className="om-input" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={save} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// Clears credit that was already used on an order but never got recorded as used
// (it moves no money: no payment total changes and partner profit isn't touched).
function CreditUsedForm({ balance, onConfirm, onCancel }) {
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const confirm = async () => {
    if (submittedRef.current) return;
    const amt = Number(amount);
    if (!(amt > 0)) { setError("Enter an amount greater than 0."); return; }
    if (amt > balance + 0.001) { setError(`Can't mark more than the ${money(balance)} owed as used.`); return; }
    submittedRef.current = true;
    setError(""); setSubmitting(true);
    const res = await onConfirm(amt);
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); submittedRef.current = false; }
  };
  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", borderLeft: `3px solid ${C.moss}` }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mark as used — {money(balance)} owed</div>
      <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0 }} value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Use this when the credit was already taken off an order's bill. It just clears the balance -- no cash or Zelle total changes.</div>
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Mark as used"}
        </button>
      </div>
    </div>
  );
}

function CreditReimburseForm({ balance, partners, onConfirm, onCancel }) {
  const [method, setMethod] = useState("Cash");
  const [paidBy, setPaidBy] = useState(""); // "" = the business paid it; otherwise a partner paid it from their own money
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const confirm = async () => {
    if (submittedRef.current) return;
    const amt = Number(amount);
    if (!(amt > 0)) { setError("Enter an amount greater than 0."); return; }
    if (amt > balance + 0.001) { setError(`Can't reimburse more than the ${money(balance)} owed.`); return; }
    submittedRef.current = true;
    setError("");
    setSubmitting(true);
    const res = await onConfirm(method, amt, paidBy);
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); submittedRef.current = false; }
  };

  return (
    <div style={{ ...rowCard, flexDirection: "column", alignItems: "stretch", borderLeft: `3px solid ${C.ember}` }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Reimburse — {money(balance)} owed</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 130px" }} value={method} onChange={(e) => setMethod(e.target.value)}>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0, flex: "1 1 100px" }}
          value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
      </div>
      <label style={{ ...fieldLabel, marginTop: 10 }}>Paid by</label>
      <select className="om-input" style={{ ...input, marginTop: 4 }} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
        <option value="">Shared account (the business paid it)</option>
        {(partners || []).filter((p) => isActiveNow(p)).map((p) => <option key={p.id} value={p.id}>{p.name} (from their own money)</option>)}
      </select>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
        {paidBy
          ? `${(partners || []).find((p) => p.id === paidBy)?.name || "They"} paid this from their own ${method}, so it's added back to their balance and no ${method} total changes.`
          : `This is logged as money paid out, so it's deducted from the ${method} total above.`}
      </div>
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Log reimbursement"}
        </button>
      </div>
    </div>
  );
}

function CustomerCreditsPanel({ credits, partners, onUpdateCredit, onDeleteCredit, onAddCredit }) {
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [reimbursingCustomer, setReimbursingCustomer] = useState(null);
  const [usingCustomer, setUsingCustomer] = useState(null);

  const customers = groupCreditsByCustomer(credits).filter((c) => Math.abs(c.balance) > 0.001 || c.entries.length > 0);
  if (customers.length === 0) return null;

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Customer credits</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Money owed to customers from overpayments, and credit already applied to later orders</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {customers.map((c) => (
          <div key={c.customer}>
            <div
              onClick={() => setExpandedCustomer(expandedCustomer === c.customer ? null : c.customer)}
              style={{ ...rowCard, cursor: "pointer" }}
            >
              <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{c.customer}</div>
              <div style={{ ...displayNum, fontSize: 14, color: c.balance > 0 ? C.ember : C.muted, marginRight: 8 }}>
                {c.balance > 0 ? `${money(c.balance)} owed` : money(c.balance)}
              </div>
              {c.balance > 0.001 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setUsingCustomer(usingCustomer === c.customer ? null : c.customer); setReimbursingCustomer(null); }}
                    className="om-btn" style={{ ...quickTagBtn, marginRight: 6 }}>
                    Mark as used
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setReimbursingCustomer(reimbursingCustomer === c.customer ? null : c.customer); setUsingCustomer(null); }}
                    className="om-btn" style={{ ...quickTagBtn, marginRight: 8 }}>
                    Reimburse
                  </button>
                </>
              )}
              <span style={{ fontSize: 12, color: C.muted }}>{expandedCustomer === c.customer ? "hide" : "details"}</span>
            </div>
            {usingCustomer === c.customer && (
              <div style={{ marginTop: 6 }}>
                <CreditUsedForm balance={c.balance}
                  onConfirm={async (amt) => {
                    const res = await onAddCredit({ customer: c.customer, amount: -amt, kind: "applied", note: "Marked as used on an order" });
                    if (res.ok) setUsingCustomer(null);
                    return res;
                  }}
                  onCancel={() => setUsingCustomer(null)} />
              </div>
            )}
            {reimbursingCustomer === c.customer && (
              <div style={{ marginTop: 6 }}>
                <CreditReimburseForm balance={c.balance} partners={partners}
                  onConfirm={async (method, amt, paidBy) => {
                    const payer = paidBy ? partners.find((p) => p.id === paidBy)?.name : "";
                    const res = await onAddCredit({ customer: c.customer, amount: -amt, method, kind: "reimbursement", paidBy, note: `Reimbursed via ${method}${payer ? ` (paid by ${payer})` : ""}` });
                    if (res.ok) setReimbursingCustomer(null);
                    return res;
                  }}
                  onCancel={() => setReimbursingCustomer(null)} />
              </div>
            )}
            {expandedCustomer === c.customer && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, marginLeft: 12 }}>
                {c.entries.map((entry) =>
                  editingEntryId === entry.id ? (
                    <CreditEditForm key={entry.id} entry={entry}
                      onSave={async (updated) => { const res = await onUpdateCredit(updated); if (res.ok) setEditingEntryId(null); return res; }}
                      onCancel={() => setEditingEntryId(null)} />
                  ) : (
                    <div key={entry.id} style={{ ...rowCard, padding: "8px 12px" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13 }}>{entry.note || "(no note)"}{entry.method ? ` (${entry.method})` : ""}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{new Date(entry.ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                      </div>
                      <div style={{ ...displayNum, fontSize: 13, color: entry.amount >= 0 ? C.ember : C.muted, marginRight: 10 }}>
                        {entry.amount >= 0 ? "+" : ""}{money(entry.amount)}
                      </div>
                      <button onClick={() => setEditingEntryId(entry.id)} style={{ ...iconBtn, width: 28, height: 28, marginRight: 4 }} className="om-btn" aria-label="Edit credit entry"><Pencil size={12} /></button>
                      <ConfirmDelete label="credit entry" onConfirm={() => onDeleteCredit(entry.id)} />
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentTypeTotals({ orders, credits, withdrawals, expenses }) {
  const rows = computePaymentTypeTotals(orders, credits, withdrawals, expenses);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Total by payment method</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Every payment logged so far minus reimbursements, partner withdrawals and shared-account expenses paid out, including partial payments on still-open orders — this is what you should physically have in cash/Zelle/cards, excluding internal partner-meal deductions below</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.method} style={{ flex: "1 1 130px", background: C.card, border: `1px solid ${r.internal ? C.warning : C.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, color: r.internal ? C.warning : C.muted }}>{r.method}</div>
            <div style={{ ...displayNum, fontSize: 16, color: r.internal ? C.warning : C.moss }}>{money(r.total)}</div>
            {r.internal && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Not real cash — excluded from reconciliation</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Finds paid orders where the payments ledger falls short of the order
// total -- exactly the gap that opens up when an already-paid order gets
// edited (item added, price fixed) without a matching payment ever being
// logged for the difference. See OrderEditForm's diff-handling for the
// fix going forward; this is the cleanup tool for orders that went stale
// before that fix existed.
function findPaymentGaps(orders) {
  return orders
    .filter((o) => o.paid)
    // The real amount owed is whichever is higher: the bill total, or a
    // recorded amountReceived (from "Paid more than the bill?") -- an
    // overpayment logged before the fix that makes that extra amount show
    // up in the payments ledger would otherwise look fully accounted for
    // here (logged == total) while the actual cash received was higher.
    .map((o) => ({ order: o, gap: Math.max(Number(o.total) || 0, Number(o.amountReceived) || 0) - paymentsTotal(o) }))
    .filter((x) => x.gap > 0.01);
}

function PaymentGapReconciler({ orders, onAddPayment }) {
  const gaps = findPaymentGaps(orders);
  const [fixingId, setFixingId] = useState(null);
  const [fixingAll, setFixingAll] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  if (gaps.length === 0 || dismissed) return null;

  const fixOne = async (o, gap) => {
    setFixingId(o.id);
    setError("");
    // Logs the missing amount using whatever method the order was already
    // marked as paid via -- it's a correction to bring the existing record
    // in line with reality, not a new payment decision, so it reuses the
    // method already on file rather than asking again.
    const res = await onAddPayment(o.id, [{ method: o.paymentMethod || "Cash", amount: gap }]);
    if (res && !res.ok) setError(`${o.customer}: ${res.error}`);
    setFixingId(null);
  };

  const fixAll = async () => {
    setFixingAll(true);
    setError("");
    for (const { order: o, gap } of gaps) {
      const res = await onAddPayment(o.id, [{ method: o.paymentMethod || "Cash", amount: gap }]);
      if (res && !res.ok) { setError(`${o.customer}: ${res.error}`); break; }
    }
    setFixingAll(false);
  };

  const totalGap = gaps.reduce((s, g) => s + g.gap, 0);

  return (
    <div style={{ ...card, marginBottom: 18, borderColor: C.danger }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ ...cardTitle, color: C.danger, marginBottom: 4 }}>{gaps.length} order{gaps.length === 1 ? "" : "s"} under-logged by {money(totalGap)} total</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            These are marked Paid but their logged payments don't add up to the full amount owed — usually from an item added/price fixed after being marked paid, or an overpayment recorded before that specific fix existed. Fixing one logs the missing amount using the payment method already on file for that order.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setDismissed(true)} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Hide for now</button>
          <button onClick={fixAll} disabled={fixingAll} style={{ ...primaryBtn, width: "auto", marginTop: 0, background: C.danger, opacity: fixingAll ? 0.7 : 1 }} className="om-btn">
            {fixingAll ? <Loader2 className="om-spin" size={14} /> : null} Fix all {gaps.length}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {gaps.map(({ order: o, gap }) => (
          <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{o.customer}</span>
              <span style={{ color: C.muted }}> — logged {money(paymentsTotal(o))} of {money(Math.max(o.total, o.amountReceived || 0))} ({o.paymentMethod || "Cash"})</span>
            </div>
            <button onClick={() => fixOne(o, gap)} disabled={fixingId === o.id || fixingAll} className="om-btn" style={quickTagBtn}>
              {fixingId === o.id ? <Loader2 className="om-spin" size={11} /> : null} Log missing {money(gap)}
            </button>
          </div>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function KpiCards({ orders, totals }) {
  const totalPlates = orders.reduce((s, o) => s + (o.items || []).reduce((s2, i) => s2 + (Number(i.qty) || 0), 0), 0);
  const totalOrders = orders.length;
  const totalBillValue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const avgOrder = totalOrders > 0 ? totalBillValue / totalOrders : 0;

  const cards = [
    { label: "Revenue collected", value: money(totals.income), color: C.moss },
    { label: "Still owed", value: money(totals.pending), color: C.ember },
    { label: "Plates sold", value: String(totalPlates), color: C.mossDark },
    { label: "Avg order value", value: money(avgOrder), color: C.warning },
  ];

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ ...card, flex: "1 1 180px", borderTop: `3px solid ${c.color}` }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{c.label}</div>
          <div style={{ ...displayNum, fontSize: 24, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function DailyBarChart({ orders }) {
  // Most-recent-first from computeDailyBreakdown -> reversed to chronological
  // (oldest to newest, left to right) and capped to the last 14 days that
  // actually had orders, so the chart stays legible.
  const days = computeDailyBreakdown(orders).slice(0, 14).reverse();
  if (days.length === 0) return null;
  const max = Math.max(...days.map((d) => d.revenue), 1);
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Revenue trend</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Last {days.length} day{days.length === 1 ? "" : "s"} with orders</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 150 }}>
        {days.map((d) => (
          <div key={d.dateKey} title={`${d.label}: ${money(d.revenue)} (${d.plates} plates)`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", minWidth: 0 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, whiteSpace: "nowrap" }}>{money(d.revenue).replace(".00", "")}</div>
            <div style={{ width: "70%", minHeight: 3, height: `${Math.max(4, (d.revenue / max) * 100)}%`, background: `linear-gradient(180deg, ${C.mossDark}, ${C.moss})`, borderRadius: "4px 4px 0 0" }} />
            <div style={{ fontSize: 10, color: C.muted, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>{d.label.split(",")[0]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const METHOD_COLORS = { Cash: "#43966B", Zelle: "#F0A868", "Debit Card": "#F0C24B", "Credit Card": "#F0796B" };

function MethodBarChart({ orders, credits, withdrawals, expenses }) {
  const rows = computePaymentTypeTotals(orders, credits, withdrawals, expenses).filter((r) => !r.internal && r.total > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div style={{ ...card, marginBottom: 18, flex: "1 1 320px" }}>
      <div style={cardTitle}>Revenue by payment method</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((r) => (
          <div key={r.method}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span>{r.method}</span>
              <span style={{ ...displayNum, fontSize: 13 }}>{money(r.total)}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: C.paper, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(2, (r.total / max) * 100)}%`, background: METHOD_COLORS[r.method] || C.moss, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CATEGORY_COLORS = ["#43966B", "#F0A868", "#F0C24B", "#F0796B", "#8FE0B3"];

function CategoryBarChart({ orders, menu }) {
  const categories = computeItemBreakdown(orders, menu).filter((c) => c.revenue > 0);
  if (categories.length === 0) return null;
  const max = Math.max(...categories.map((c) => c.revenue), 1);
  return (
    <div style={{ ...card, marginBottom: 18, flex: "1 1 320px" }}>
      <div style={cardTitle}>Revenue by category</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {categories.map((c, i) => (
          <div key={c.name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span>{c.name}</span>
              <span style={{ ...displayNum, fontSize: 13 }}>{money(c.revenue)} · {c.qty} plate{c.qty === 1 ? "" : "s"}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: C.paper, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(2, (c.revenue / max) * 100)}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length], borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The Summary tab is a dedicated home for everything about how the
// business is doing -- the KPI cards and two bar charts here are new,
// visual additions; everything below them (PaymentGapReconciler,
// PaymentTypeTotals, DailyBreakdown, SalesBreakdown, CustomerCreditsPanel)
// is the exact same component, doing the exact same calculation, just
// moved here from Order History (which is now just the order list) rather
// than rewritten -- the underlying numbers are unchanged.
// A dedicated, quantity-first view for kitchen prep planning -- "how many
// of each item do we need to make," not revenue. Reuses
// computeItemBreakdown (same category-matching, same swap/Coco merging)
// but re-sorts everything by plate count instead of revenue, and adds a
// period picker since "how many today" and "how many all-time" are very
// different questions for prep.
function PlateTotalsTab({ orders, menu }) {
  const [period, setPeriod] = useState("today"); // today | week | month | all | custom
  const [customFrom, setCustomFrom] = useState(todayDateString());
  const [customTo, setCustomTo] = useState(todayDateString());
  const periods = [
    ["today", "Today"],
    ["week", "Last 7 days"],
    ["month", "This month"],
    ["all", "All time"],
    ["custom", "Custom"],
  ];
  const periodLabel = period === "custom" ? `${customFrom} to ${customTo}` : periods.find((p) => p[0] === period)[1];

  const filtered = filterOrdersByPeriod(orders, period, { from: customFrom, to: customTo });
  const categories = computeItemBreakdown(filtered, menu)
    .map((c) => ({ ...c, rows: [...c.rows].sort((a, b) => b.qty - a.qty) }))
    .sort((a, b) => b.qty - a.qty);
  const totalPlates = categories.reduce((s, c) => s + c.qty, 0);
  // Worked out order by order, so a customer who overpaid never cancels out
  // someone else's unpaid balance (see orderMoneySummary).
  const money_ = orderMoneySummary(filtered);
  const totalOrderValue = money_.value;
  const paidCollected = money_.paidToward;
  const unpaidRemaining = money_.owed;
  const overpaid = money_.extra;
  const topItems = categories
    .flatMap((c) => c.rows.map((r) => ({ ...r, category: c.name })))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 8);
  const maxTopQty = Math.max(...topItems.map((r) => r.qty), 1);

  return (
    <div>
      <div style={{ ...card, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={cardTitle}>Plate totals</div>
          <div style={{ fontSize: 12, color: C.muted }}>How many of each item sold — for kitchen prep planning</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {periods.map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)} className="om-btn"
              style={{ ...tabBtn, padding: "7px 12px", fontSize: 13, background: period === id ? C.moss : "transparent", color: period === id ? "#FAF6EE" : C.muted, border: `1px solid ${period === id ? C.moss : C.border}` }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {period === "custom" && (
        <div style={{ ...card, marginBottom: 18, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={fieldLabel}>From</label>
            <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div>
            <label style={fieldLabel}>To</label>
            <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={customTo} min={customFrom} max={todayDateString()} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, paddingBottom: 8 }}>e.g. set both to last Saturday to check just that day, or Saturday to Sunday for the weekend.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ ...card, flex: "1 1 200px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Total plates — {periodLabel.toLowerCase()}</div>
          <div style={{ ...displayNum, fontSize: 40, color: C.moss }}>{totalPlates}</div>
        </div>
        <div style={{ ...card, flex: "1 1 200px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Total order value — {periodLabel.toLowerCase()}</div>
          <div style={{ ...displayNum, fontSize: 40, color: C.ember }}>{money(totalOrderValue)}</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 8, fontSize: 12 }}>
            <span style={{ color: C.moss }}>Paid {money(paidCollected)}</span>
            <span style={{ color: unpaidRemaining > 0 ? C.warning : C.muted }}>Unpaid {money(unpaidRemaining)}</span>
          </div>
          {overpaid > 0.005 && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>+ {money(overpaid)} extra handed over (owed back to customers)</div>}
        </div>
      </div>

      {topItems.length > 0 && (
        <div style={{ ...card, marginBottom: 18 }}>
          <div style={cardTitle}>Top items by quantity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            {topItems.map((r, i) => (
              <div key={`${r.category}-${r.key}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span><span style={{ color: C.muted, marginRight: 6 }}>{i + 1}.</span>{r.key} <span style={{ color: C.muted, fontSize: 11 }}>({r.category})</span></span>
                  <span style={{ ...displayNum, fontSize: 13 }}>{r.qty} plate{r.qty === 1 ? "" : "s"}</span>
                </div>
                <div style={{ height: 10, borderRadius: 999, background: C.paper, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(2, (r.qty / maxTopQty) * 100)}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length], borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalPlates === 0 ? (
        <div style={emptyState}>No orders in this period.</div>
      ) : (
        categories.map((cat) => (
          <div key={cat.name} style={{ ...card, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{cat.name}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{cat.qty} plate{cat.qty === 1 ? "" : "s"}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {cat.rows.map((r, idx) => (
                <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 14 }}><span style={{ color: C.muted, marginRight: 8 }}>{idx + 1}.</span>{r.key}</div>
                  <div style={{ ...displayNum, fontSize: 14 }}>{r.qty} plate{r.qty === 1 ? "" : "s"}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Re-derives the important totals a second way and compares them (see
// auditTotals in lib/defaults.js). Anything that doesn't reconcile is shown
// right here with exactly which records are involved, so a wrong number gets
// caught on the screen instead of at the cash drawer.
function TotalsCheckCard({ orders, expenses, withdrawals, credits, partners, totals }) {
  const [showPassed, setShowPassed] = useState(false);
  const { checks, worst } = auditTotals({ orders, expenses, withdrawals, credits, partners, totals });
  const problems = checks.filter((c) => c.status !== "ok");
  const passed = checks.filter((c) => c.status === "ok");
  const colorOf = (st) => (st === "error" ? C.danger : st === "warn" ? C.warning : C.moss);
  const iconOf = (st) => (st === "error" ? "✗" : st === "warn" ? "⚠" : "✓");
  const row = (c) => (
    <div key={c.id} style={{ padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ color: colorOf(c.status), fontWeight: 700, width: 16 }}>{iconOf(c.status)}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>
        <span style={{ fontSize: 12, color: colorOf(c.status), marginLeft: "auto", textAlign: "right" }}>{c.summary}</span>
      </div>
      {c.details.length > 0 && (c.status !== "ok" || showPassed) && (
        <ul style={{ margin: "6px 0 0 24px", padding: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          {c.details.map((d, i) => <li key={i} style={{ marginBottom: 2 }}>{d}</li>)}
        </ul>
      )}
    </div>
  );
  return (
    <div style={{ ...card, marginBottom: 18, borderColor: worst === "ok" ? C.moss : colorOf(worst) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...cardTitle, marginBottom: 2 }}>Totals check</div>
          <div style={{ fontSize: 12, color: C.muted }}>Every total re-derived a second way and compared</div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: colorOf(worst), border: `1px solid ${colorOf(worst)}`, borderRadius: 999, padding: "4px 12px" }}>
          {worst === "ok" ? "✓ All totals reconcile" : `${problems.length} to look at`}
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        {problems.map(row)}
        {passed.length > 0 && (
          <>
            <button onClick={() => setShowPassed((v) => !v)} className="om-btn" style={{ ...quickTagBtn, borderColor: C.border, color: C.muted, marginTop: 10 }}>
              {showPassed ? "Hide" : "Show"} {passed.length} passed check{passed.length === 1 ? "" : "s"}
            </button>
            {showPassed && passed.map(row)}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTab({ menu, orders, partners, credits, withdrawals, expenses, totals, onAddPayment, onAddCredit, onUpdateCredit, onDeleteCredit }) {
  return (
    <div>
      <KpiCards orders={orders} totals={totals} />
      <TotalsCheckCard orders={orders} expenses={expenses} withdrawals={withdrawals} credits={credits} partners={partners} totals={totals} />
      <DailyBarChart orders={orders} />
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <MethodBarChart orders={orders} credits={credits} withdrawals={withdrawals} expenses={expenses} />
        <CategoryBarChart orders={orders} menu={menu} />
      </div>
      <PaymentGapReconciler orders={orders} onAddPayment={onAddPayment} />
      <PaymentTypeTotals orders={orders} credits={credits} withdrawals={withdrawals} expenses={expenses} />
      <DailyBreakdown orders={orders} />
      <SalesBreakdown orders={orders} menu={menu} />
      <CustomerCreditsPanel credits={credits} partners={partners} onUpdateCredit={onUpdateCredit} onDeleteCredit={onDeleteCredit} onAddCredit={onAddCredit} />
    </div>
  );
}

function OrderHistoryTab({ menu, orders, partners, deliveryZones, credits, onTogglePaid, onAddPayment, onRemovePayment, onUpdate, onDelete, onAddCredit }) {
  const [editingId, setEditingId] = useState(null);
  const [pickingCollectorId, setPickingCollectorId] = useState(null);
  const [recordingAmountId, setRecordingAmountId] = useState(null);
  const [recordingPaymentId, setRecordingPaymentId] = useState(null);
  const [expandedPaymentsId, setExpandedPaymentsId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [returningId, setReturningId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | paid | unpaid
  const [dateOrder, setDateOrder] = useState("newest"); // newest | oldest
  // Which day's orders to show, by the ORDER's date. "all" until you pick one.
  const [datePeriod, setDatePeriod] = useState("all"); // all | today | yesterday | week | month | custom
  const [dateFrom, setDateFrom] = useState(todayDateString());
  const [dateTo, setDateTo] = useState(todayDateString());
  const [methodFilter, setMethodFilter] = useState("all"); // all | Cash | Zelle | Debit Card | Credit Card
  const [collectorFilter, setCollectorFilter] = useState("all"); // all | shared | <partnerId>

  const handleToggle = async (id) => {
    setTogglingId(id);
    await onTogglePaid(id); // instant, one click -- defaults to shared account
    setTogglingId(null);
  };

  const returnToShared = async (order) => {
    setReturningId(order.id);
    if (order.paymentMethod === INTERNAL_METHOD) {
      await onUpdate({ ...order, collectedBy: "" });
    } else {
      // Only touch the Zelle payment records -- Cash/Debit/Credit never
      // had a collector to begin with. Also written back as `payments` so
      // an old order still on the legacy single collectedBy shape gets
      // upgraded to the new per-payment shape at the same time.
      const payments = effectivePayments(order).map((p) => (p.method === "Zelle" ? { ...p, collectedBy: "" } : p));
      await onUpdate({ ...order, payments, collectedBy: "" });
    }
    setReturningId(null);
  };

  const recordAmountReceived = async (order, amountReceived) => {
    const previousReceived = order.amountReceived ?? order.total;
    const previousChange = Math.max(0, previousReceived - order.total);
    const newChange = Math.max(0, amountReceived - order.total);
    const delta = newChange - previousChange; // only the difference gets logged, not the whole amount again

    // The extra cash actually handed over needs to show up in the Cash
    // Drawer total too, not just as a credit liability -- the customer
    // really did hand over that much money at the time of the order, using
    // whatever method the order itself was paid in. Without this, the app
    // only ever counted the order's bill amount as money received, even
    // though more physically went into the drawer.
    const alreadyLogged = paymentsTotal(order);
    const targetLogged = order.total + newChange;
    const gap = targetLogged - alreadyLogged;
    let payments = effectivePayments(order);
    if (gap > 0.001) {
      payments = [...payments, { id: uid(), method: order.paymentMethod || "Cash", amount: gap, collectedBy: "", ts: Date.now() }];
    } else if (gap < -0.001) {
      payments = trimPayments(payments, -gap);
    }

    await onUpdate({ ...order, amountReceived, payments });
    if (delta !== 0) {
      await onAddCredit({
        customer: order.customer, amount: delta,
        note: previousChange > 0 ? `Corrected overpayment on order for ${order.customer}` : `Overpayment on order for ${order.customer}`,
      });
    }
    setRecordingAmountId(null);
  };

  const partnerName = (id) => partners.find((p) => p.id === id)?.name;

  // For the "Received $X ($Y owed to them)" note on an order: is that extra
  // still owed, or has it since been paid back / used? That's their CURRENT
  // credit balance, not something the order itself knows.
  const creditBalanceByKey = {};
  groupCreditsByCustomer(credits || []).forEach((g) => { creditBalanceByKey[g.key] = g.balance; });
  const overpaidByKey = {};
  orders.forEach((o) => {
    const over = Number(o.amountReceived) > Number(o.total) ? Number(o.amountReceived) - Number(o.total) : 0;
    if (over > 0) { const k = creditKey(o.customer); overpaidByKey[k] = (overpaidByKey[k] || 0) + over; }
  });

  // Who personally collected any part of this order -- Zelle payments and
  // internal partner-meal deductions can be attributed to a specific
  // partner (see the payment-level collectedBy design); Cash/Debit/Credit
  // never are, since that money always lands in the shared account/bank.
  // A split payment could in principle have more than one collector, so
  // this returns every distinct one, not just the first.
  const orderCollectors = (o) =>
    [...new Set(effectivePayments(o).filter((p) => (p.method === "Zelle" || p.method === INTERNAL_METHOD) && p.collectedBy).map((p) => p.collectedBy))];

  const datedOrders = filterOrdersByPeriod(orders, datePeriod, { from: dateFrom, to: dateTo });
  const filteredOrders = datedOrders.filter((o) => {
    if (search.trim() && !o.customer.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (statusFilter === "paid" && !o.paid) return false;
    if (statusFilter === "unpaid" && o.paid) return false;
    // Checks the real payments ledger (any payment of this method,
    // anywhere on the order), not just the single legacy paymentMethod
    // field -- that field only ever reflects the order's *first* payment,
    // so a split order (e.g. $100 Cash + $35 Zelle) would otherwise vanish
    // from a "Zelle" filter entirely, even though its Zelle portion is
    // correctly counted in the Total by payment method card above.
    if (methodFilter !== "all" && !effectivePayments(o).some((p) => (p.method || "Cash") === methodFilter)) return false;
    if (collectorFilter === "shared" && orderCollectors(o).length > 0) return false;
    if (collectorFilter !== "all" && collectorFilter !== "shared" && !orderCollectors(o).includes(collectorFilter)) return false;
    return true;
  });

  // Newest date first (or oldest first), with a date heading above each day.
  const sortedOrders = sortOrdersByDate(filteredOrders, dateOrder);
  const ordersPerDay = {};
  sortedOrders.forEach((o) => { const k = tsToDateString(o.ts || 0); ordersPerDay[k] = (ordersPerDay[k] || 0) + 1; });
  const longDate = (ts) => new Date(ts || 0).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const shortDate = (ts) => new Date(ts || 0).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div>
      <div style={safetyNote}><ShieldCheck size={15} /> Every order is saved to the database and synced to Google Sheets as a backup — nothing is lost.</div>

      <div style={{ ...card, marginTop: 18, marginBottom: 18 }}>
        <label style={fieldLabel}>Order date</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          {[["all", "All dates"], ["today", "Today"], ["yesterday", "Yesterday"], ["week", "Last 7 days"], ["month", "This month"], ["custom", "Pick dates"]].map(([id, label]) => (
            <button key={id} onClick={() => setDatePeriod(id)} className="om-btn"
              style={{ ...quickTagBtn, background: datePeriod === id ? C.moss : "transparent", color: datePeriod === id ? "#FAF6EE" : C.muted, borderColor: datePeriod === id ? C.moss : C.border }}>
              {label}
            </button>
          ))}
        </div>
        {datePeriod === "custom" && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
            <div>
              <label style={fieldLabel}>From</label>
              <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label style={fieldLabel}>To</label>
              <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>These use the date on the order itself, not the day it was entered.</div>
        <label style={{ ...fieldLabel, marginTop: 14 }}>Search by customer name</label>
        <input className="om-input" style={input} placeholder="e.g. Ramesh" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Status</label>
            <select className="om-input" style={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Payment method</label>
            <select className="om-input" style={input} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="all">All</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Collected by</label>
            <select className="om-input" style={input} value={collectorFilter} onChange={(e) => setCollectorFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="shared">Shared account</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
        <div style={{ ...sectionTitle, marginTop: 0, marginBottom: 0 }}>
          {filteredOrders.length} of {orders.length} order{orders.length === 1 ? "" : "s"} shown
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["newest", "Newest first"], ["oldest", "Oldest first"]].map(([id, label]) => (
            <button key={id} onClick={() => setDateOrder(id)} className="om-btn"
              style={{ ...quickTagBtn, background: dateOrder === id ? C.moss : "transparent", color: dateOrder === id ? "#FAF6EE" : C.muted, borderColor: dateOrder === id ? C.moss : C.border }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 10 }} />
      {orders.length === 0 ? (
        <div style={emptyState}>No orders yet — add one from the New order tab.</div>
      ) : filteredOrders.length === 0 ? (
        <div style={emptyState}>No orders match your search/filters.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sortedOrders.map((o, idx) => {
            const dayKey = tsToDateString(o.ts || 0);
            const newDay = idx === 0 || tsToDateString(sortedOrders[idx - 1].ts || 0) !== dayKey;
            return (
            <React.Fragment key={o.id}>
              {newDay && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: idx === 0 ? 0 : 10, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.ember }}>{longDate(o.ts)}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{ordersPerDay[dayKey]} order{ordersPerDay[dayKey] === 1 ? "" : "s"}</span>
                </div>
              )}
              {editingId === o.id ? (
              <OrderEditForm key={o.id} order={o} menu={menu} partners={partners} deliveryZones={deliveryZones} onAddCredit={onAddCredit}
                onSave={async (updated) => { const res = await onUpdate(updated); if (res.ok) setEditingId(null); return res; }}
                onCancel={() => setEditingId(null)} />
            ) : pickingCollectorId === o.id ? (
              <CollectorPicker key={o.id} order={o} partners={partners}
                onConfirm={async (collectedBy) => {
                  if (o.paymentMethod === INTERNAL_METHOD) {
                    // Partner-deduction orders stay on the simple
                    // order-level field they've always used -- there's
                    // only ever one "collector" concept here, and writing
                    // a synthesized payments array for these would freeze
                    // a stale collectedBy into it instead of the fresh
                    // value from this picker.
                    await onUpdate({ ...o, collectedBy });
                  } else {
                    // Blanket-assigns this collector to every Zelle
                    // payment on the order (the common case is a single
                    // Zelle payment, so this is exactly right there; for a
                    // genuinely split Zelle-among-multiple-collectors case,
                    // use "Log a payment" per portion instead, which lets
                    // each Zelle row pick its own collector as it's logged).
                    const payments = effectivePayments(o).map((p) => (p.method === "Zelle" ? { ...p, collectedBy } : p));
                    await onUpdate({ ...o, payments, collectedBy });
                  }
                  setPickingCollectorId(null);
                }}
                onCancel={() => setPickingCollectorId(null)} />
            ) : recordingAmountId === o.id ? (
              <AmountReceivedPicker key={o.id} order={o}
                onConfirm={(amt) => recordAmountReceived(o, amt)}
                onCancel={() => setRecordingAmountId(null)} />
            ) : recordingPaymentId === o.id ? (
              <PaymentRecorder key={o.id} order={o} partners={partners}
                onConfirm={async (payments) => { const res = await onAddPayment(o.id, payments); if (res.ok) setRecordingPaymentId(null); return res; }}
                onCancel={() => setRecordingPaymentId(null)} />
            ) : (
              <div key={o.id} style={{ ...rowCard, borderLeft: `3px solid ${o.paid ? C.success : C.warning}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{o.customer}</div>
                    <span style={{ fontSize: 12, color: C.muted }}>· {shortDate(o.ts)}</span>
                    {o.source === "online" && (
                      <span style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 8px" }}>Placed online</span>
                    )}
                  </div>
                  {o.phone && <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{o.phone}</div>}
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                    {o.items.map((i) => `${i.qty}× ${i.name}${i.variantLabel ? " (" + i.variantLabel + ")" : ""}`).join(", ")}
                  </div>
                  {o.discount > 0 && (
                    <div style={{ fontSize: 12, color: C.moss, marginTop: 2 }}>
                      🏷 Discount −{money(o.discount)}{o.discountType === "percent" ? ` (${o.discountValue}%)` : ""}
                    </div>
                  )}
                  {o.deliveryFee > 0 && (
                    <div style={{ fontSize: 12, color: C.ember, marginTop: 2 }}>
                      🚗 {o.deliveryZone || "Delivery"} — {money(o.deliveryFee)}{o.deliveryDriverId ? (driverCutRate(o) === 1 ? ` (full fee to ${partnerName(o.deliveryDriverId) || "Unknown"})` : ` (${partnerName(o.deliveryDriverId) || "Unknown"}'s delivery)`) : ""}
                    </div>
                  )}
                  {o.paid && (() => {
                    const payments = effectivePayments(o);
                    // Zelle can be personally received by a partner; so
                    // can an internal partner-meal deduction (that's the
                    // whole point of it) -- Cash always lands in the
                    // shared drawer, and Debit/Credit go straight to the
                    // shared merchant account, so neither is attributable.
                    const attributable = payments.filter((p) => p.method === "Zelle" || p.method === INTERNAL_METHOD);
                    const collected = attributable.filter((p) => p.collectedBy);
                    return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {payments.length <= 1 ? (
                        <select className="om-input" style={{ ...input, width: "auto", padding: "4px 8px", fontSize: 12, marginTop: 0 }}
                          value={o.paymentMethod || "Cash"}
                          onChange={(e) => {
                            const method = e.target.value;
                            const updatedPayments = payments.length === 1 ? [{ ...payments[0], method, collectedBy: method === "Zelle" ? payments[0].collectedBy : "" }] : payments;
                            onUpdate({ ...o, paymentMethod: method, payments: updatedPayments });
                          }}>
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                          {o.paymentMethod === INTERNAL_METHOD && <option value={INTERNAL_METHOD}>{INTERNAL_METHOD}</option>}
                        </select>
                      ) : (
                        // Split payment -- no single "the method" to edit
                        // anymore, so show the real breakdown instead.
                        <span style={{ fontSize: 12, color: C.muted }}>
                          {payments.map((p) => `${p.method} ${money(p.amount)}`).join(" + ")}
                        </span>
                      )}
                      {collected.length > 0 ? (
                        <>
                          <span style={{ fontSize: 12, color: C.ember }}>
                            {o.paymentMethod === INTERNAL_METHOD ? "Collected by " : "Zelle received by "}
                            {[...new Set(collected.map((p) => partnerName(p.collectedBy) || "Unknown"))].join(", ")}
                          </span>
                          {o.paymentMethod !== INTERNAL_METHOD && (
                            <button onClick={() => returnToShared(o)} disabled={returningId === o.id} className="om-btn"
                              style={quickTagBtn}>
                              {returningId === o.id ? <Loader2 className="om-spin" size={11} /> : null} Mark as returned to shared account
                            </button>
                          )}
                        </>
                      ) : attributable.length > 0 ? (
                        <button onClick={() => setPickingCollectorId(o.id)} className="om-btn" style={quickTagBtn}>
                          Was this Zelle sent to a partner personally?
                        </button>
                      ) : null}
                      {(() => {
                        const hasOver = o.amountReceived !== undefined && o.amountReceived > o.total;
                        const key = creditKey(o.customer);
                        const st = hasOver ? overpaymentStatus(creditBalanceByKey[key], overpaidByKey[key]) : null;
                        const over = hasOver ? o.amountReceived - o.total : 0;
                        const label = !hasOver ? "Paid more than the bill?"
                          : st.state === "settled" ? `Received ${money(o.amountReceived)} (${money(over)} over — settled)`
                          : st.state === "partly" ? `Received ${money(o.amountReceived)} (${money(over)} over — ${money(st.stillOwed)} still owed to them)`
                          : `Received ${money(o.amountReceived)} (${money(over)} owed to them)`;
                        return (
                          <button onClick={() => setRecordingAmountId(o.id)} className="om-btn"
                            style={hasOver && st.state === "settled" ? { ...quickTagBtn, borderColor: C.moss, color: C.moss } : quickTagBtn}>
                            {label}
                          </button>
                        );
                      })()}
                    </div>
                    );
                  })()}
                  {!o.paid && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      {paymentsTotal(o) > 0 && (
                        <span style={{ fontSize: 12, color: C.ember, fontWeight: 600 }}>
                          {money(paymentsTotal(o))} of {money(o.total)} paid — {money(Math.max(0, o.total - paymentsTotal(o)))} remaining
                        </span>
                      )}
                      <button onClick={() => setRecordingPaymentId(o.id)} className="om-btn" style={quickTagBtn}>
                        {paymentsTotal(o) > 0 ? "Log another payment" : "Log a payment (partial or split)"}
                      </button>
                    </div>
                  )}
                  {Array.isArray(o.payments) && o.payments.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => setExpandedPaymentsId(expandedPaymentsId === o.id ? null : o.id)} className="om-btn"
                        style={{ ...quickTagBtn, borderColor: C.border, color: C.muted }}>
                        {expandedPaymentsId === o.id ? "Hide" : "View"} logged payments ({o.payments.length})
                      </button>
                      {expandedPaymentsId === o.id && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                          {o.payments.map((p) => (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.paper, borderRadius: 8, padding: "6px 10px", fontSize: 13 }}>
                              <span style={{ flex: 1 }}>
                                {p.method} <span style={{ ...displayNum, fontSize: 13 }}>{money(p.amount)}</span>
                                <span style={{ color: C.muted, fontSize: 11 }}> · logged {p.ts ? tsToDateString(p.ts) : "—"}</span>
                                {p.collectedBy ? <span style={{ color: C.ember, fontSize: 11 }}> · received by {partnerName(p.collectedBy) || "Unknown"}</span> : null}
                              </span>
                              <ConfirmDelete label="payment" onConfirm={() => onRemovePayment(o.id, p.id)} />
                            </div>
                          ))}
                          <div style={{ fontSize: 11, color: C.muted }}>
                            Removing a payment only fixes the record -- use it to delete a duplicate, not to refund a customer.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ ...displayNum, fontSize: 15, marginRight: 14 }}>{money(o.total)}</div>
                <button
                  onClick={() => handleToggle(o.id)}
                  disabled={togglingId === o.id} className="om-btn"
                  style={{ ...pill, background: o.paid ? C.successTint : C.warningTint, color: o.paid ? C.success : C.warning, opacity: togglingId === o.id ? 0.6 : 1 }}>
                  {togglingId === o.id ? <Loader2 className="om-spin" size={13} /> : (o.paid ? <Check size={13} /> : null)} {o.paid ? "Paid" : "Unpaid"}
                </button>
                <button onClick={() => setEditingId(o.id)} style={{ ...iconBtn, marginRight: 6 }} className="om-btn" aria-label="Edit order"><Pencil size={14} /></button>
                <ConfirmDelete label="order" onConfirm={() => onDelete(o.id)} />
              </div>
            )}
            </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

// How a shared-account expense was paid -- decides which total it comes off
// on the Summary tab. "" means "don't deduct from any total" (e.g. paid from
// a bank card that isn't one of the tracked totals, or an older expense).
function PaidFromSelect({ value, onChange }) {
  return (
    <div>
      <label style={{ ...fieldLabel, marginTop: 12 }}>Paid from</label>
      <select className="om-input" style={input} value={value} onChange={(e) => onChange(e.target.value)}>
        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        <option value="">Not deducted from any total</option>
      </select>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
        {value ? `This comes off the ${value} total on the Summary tab.` : "This expense won't change any total on the Summary tab."}
      </div>
    </div>
  );
}

// Who bears an expense's cost. "Automatic" splits it among whoever was an
// active partner on the expense's date. "Specific partners" overrides that
// -- tick exactly who shares it -- for the cases the automatic rule can't
// get right: a cost that should hit the new partner but not the one who
// just left, or the reverse. `value` is the list of partner ids; an empty
// list means automatic.
function ExpenseSharePicker({ partners, value, onChange }) {
  const custom = value.length > 0;
  const [mode, setMode] = useState(custom ? "custom" : "auto");
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const pill = (active) => ({ padding: "7px 12px", fontSize: 13, borderRadius: 10, cursor: "pointer", background: active ? C.moss : "transparent", color: active ? "#FAF6EE" : C.muted, border: `1px solid ${active ? C.moss : C.border}` });
  return (
    <div>
      <label style={{ ...fieldLabel, marginTop: 12 }}>Who shares this cost?</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="om-btn" style={pill(mode === "auto")} onClick={() => { setMode("auto"); onChange([]); }}>Everyone active that day</button>
        <button type="button" className="om-btn" style={pill(mode === "custom")} onClick={() => setMode("custom")}>Only specific partners</button>
      </div>
      {mode === "custom" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {partners.map((p) => {
            const on = value.includes(p.id);
            return (
              <button type="button" key={p.id} className="om-btn" onClick={() => toggle(p.id)}
                style={{ padding: "6px 12px", fontSize: 13, borderRadius: 999, cursor: "pointer", background: on ? C.mossTint : "transparent", color: on ? C.mossDark : C.muted, border: `1px solid ${on ? C.moss : C.border}` }}>
                {on ? "✓ " : ""}{p.name}{p.inactiveSince ? " (left)" : ""}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
        {mode === "custom"
          ? (value.length === 0 ? "Tick at least one partner, or switch back to automatic." : `Split equally between ${value.length} partner${value.length === 1 ? "" : "s"}.`)
          : "Automatic: split among everyone who was a partner on the date this was logged."}
      </div>
    </div>
  );
}

function ExpenseEditForm({ expense, partners, onSave, onCancel }) {
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [note, setNote] = useState(expense.note || "");
  const [paidBy, setPaidBy] = useState(expense.paidBy || "");
  const [sharedBy, setSharedBy] = useState(Array.isArray(expense.sharedBy) ? expense.sharedBy : []);
  // Older expenses have no method recorded -- they open as "not deducted" so
  // that saving an edit never silently starts changing a total.
  const [paidWith, setPaidWith] = useState(expense.paidWith || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!category.trim()) { setError("Category is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...expense, category, amount: Number(amount), note, paidBy, paidWith: paidBy === "" ? paidWith : "", sharedBy });
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing expense</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={fieldLabel}>Category</label>
          <select className="om-input" style={input} value={category} onChange={(e) => { setCategory(e.target.value); setError(""); }}>
            {["Ingredients", "Rent", "Staff", "Gas/fuel", "Packaging", "Misc"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ width: 130 }}>
          <label style={fieldLabel}>Amount</label>
          <input type="number" step="0.01" min="0.01" className="om-input" style={input} value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
        </div>
      </div>
      <label style={{ ...fieldLabel, marginTop: 12 }}>Paid by</label>
      <select className="om-input" style={input} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
        <option value="">Shared account</option>
        {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {paidBy === "" && <PaidFromSelect value={paidWith} onChange={setPaidWith} />}
      <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
      <input className="om-input" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
      <ExpenseSharePicker partners={partners} value={sharedBy} onChange={setSharedBy} />
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={save} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ExpensesTab({ expenses, partners, onCreate, onUpdate, onDelete }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Ingredients");
  const [note, setNote] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [sharedBy, setSharedBy] = useState([]);
  const [paidWith, setPaidWith] = useState("Cash");
  const [shareKey, setShareKey] = useState(0); // remounts the picker after a save so it resets to automatic
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const submit = async () => {
    if (!category.trim()) { setError("Category is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    // Only a shared-account expense has a "paid from" -- one a partner paid
    // personally isn't business money leaving, so it records none.
    const res = await onCreate({ id: uid(), amount: Number(amount), category, note, paidBy, paidWith: paidBy === "" ? paidWith : "", sharedBy, ts: Date.now() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    setAmount(""); setNote(""); setPaidBy(""); setSharedBy([]); setPaidWith("Cash"); setShareKey((k) => k + 1);
  };

  const partnerName = (id) => partners.find((p) => p.id === id)?.name;
  const [reimbursingId, setReimbursingId] = useState(null);
  const markReimbursed = async (expense) => {
    setReimbursingId(expense.id);
    await onUpdate({ ...expense, paidBy: "" });
    setReimbursingId(null);
  };

  return (
    <div>
      <div style={card}>
        <div style={cardTitle}>Log an expense</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Category</label>
            <select className="om-input" style={input} value={category} onChange={(e) => { setCategory(e.target.value); setError(""); }}>
              {["Ingredients", "Rent", "Staff", "Gas/fuel", "Packaging", "Misc"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label style={fieldLabel}>Amount</label>
            <input type="number" step="0.01" min="0.01" className="om-input" style={input} placeholder="$0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
          </div>
        </div>
        <label style={{ ...fieldLabel, marginTop: 12 }}>Paid by</label>
        <select className="om-input" style={input} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          <option value="">Shared account</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {paidBy === "" && <PaidFromSelect value={paidWith} onChange={setPaidWith} />}
        <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
        <input className="om-input" style={input} placeholder="e.g. Sunday market veggie run" value={note} onChange={(e) => setNote(e.target.value)} />
        <ExpenseSharePicker key={shareKey} partners={partners} value={sharedBy} onChange={setSharedBy} />
        <ErrorText>{error}</ErrorText>
        <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Plus size={15} />} {submitting ? "Saving..." : "Add expense"}
        </button>
      </div>
      <div style={{ ...sectionTitle, marginTop: 26 }}>All expenses</div>
      {expenses.length === 0 ? (
        <div style={emptyState}>No expenses logged yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {expenses.map((e) =>
            editingId === e.id ? (
              <ExpenseEditForm key={e.id} expense={e} partners={partners}
                onSave={async (updated) => { const res = await onUpdate(updated); if (res.ok) setEditingId(null); return res; }}
                onCancel={() => setEditingId(null)} />
            ) : (
              <div key={e.id} style={{ ...rowCard, borderLeft: `3px solid ${C.danger}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{e.category}</div>
                  {e.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{e.note}</div>}
                  {!e.paidBy && e.paidWith && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Paid from {e.paidWith} (comes off that total)</div>
                  )}
                  {Array.isArray(e.sharedBy) && e.sharedBy.length > 0 && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Split between: {e.sharedBy.map((id) => partnerName(id) || "Unknown").join(", ")}</div>
                  )}
                  {e.paidBy && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: C.ember }}>Paid by {partnerName(e.paidBy) || "Unknown"}</span>
                      <button onClick={() => markReimbursed(e)} disabled={reimbursingId === e.id} className="om-btn"
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${C.ember}`, background: "transparent", color: C.ember, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                        {reimbursingId === e.id ? <Loader2 className="om-spin" size={11} /> : null} Mark as reimbursed
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ ...displayNum, fontSize: 15, marginRight: 14, color: C.danger }}>-{money(e.amount)}</div>
                <button onClick={() => setEditingId(e.id)} style={{ ...iconBtn, marginRight: 6 }} className="om-btn" aria-label="Edit expense"><Pencil size={14} /></button>
                <ConfirmDelete label="expense" onConfirm={() => onDelete(e.id)} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function WithdrawalEditForm({ withdrawal, partners, onSave, onCancel }) {
  const [partnerId, setPartnerId] = useState(withdrawal.partnerId);
  const [amount, setAmount] = useState(String(withdrawal.amount));
  const [note, setNote] = useState(withdrawal.note || "");
  const [method, setMethod] = useState(withdrawal.method || "Cash");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!partnerId) { setError("Partner is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...withdrawal, partnerId, amount: Number(amount), method, note });
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing withdrawal</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={fieldLabel}>Partner</label>
          <select className="om-input" style={input} value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setError(""); }}>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ width: 130 }}>
          <label style={fieldLabel}>Amount</label>
          <input type="number" step="0.01" min="0.01" className="om-input" style={input} value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
        </div>
        <div style={{ width: 150 }}>
          <label style={fieldLabel}>Paid out as</label>
          <select className="om-input" style={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
      <input className="om-input" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        <button onClick={save} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {submitting ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function AddPartnerForm({ onAdd }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setError("Enter the partner's name."); return; }
    if (!date) { setError("Pick the date they start sharing profit."); return; }
    setError("");
    setSubmitting(true);
    const res = await onAdd(name.trim(), startOfDayTs(date));
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); return; }
    setName(""); setDate(todayDateString());
  };

  return (
    <div style={{ ...card, marginBottom: 26 }}>
      <div style={cardTitle}>Add a partner</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 2, minWidth: 160 }}>
          <label style={fieldLabel}>Name</label>
          <input className="om-input" style={{ ...input, marginTop: 0 }} placeholder="e.g. Pal" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={fieldLabel}>Starts sharing profit on</label>
          <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={date} onChange={(e) => { setDate(e.target.value); setError(""); }} />
        </div>
        <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Plus size={15} />} Add partner
        </button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
        They only share orders and expenses dated on or after this day -- nobody's past numbers change. Any expense can still be assigned to specific partners from the Expenses tab.
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function InactiveDateForm({ partner, onConfirm, onCancel }) {
  const [date, setDate] = useState(partner.inactiveSince ? tsToDateString(partner.inactiveSince) : todayDateString());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (!date) { setError("Pick a date."); return; }
    setError("");
    setSubmitting(true);
    const res = await onConfirm(dateStringToTs(date));
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: C.paper, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
        When did they actually leave? (Not necessarily today -- any order dated on/after this stops counting them.)
      </div>
      <input type="date" className="om-input" style={{ ...input, marginTop: 0 }} value={date} onChange={(e) => { setDate(e.target.value); setError(""); }} />
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted, padding: "6px 10px", fontSize: 12 }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={13} /> : <Check size={13} />} Confirm
        </button>
      </div>
    </div>
  );
}

function SettlementOverrideForm({ partner, onConfirm, onCancel }) {
  const [amount, setAmount] = useState(partner.settlementOverride != null ? String(partner.settlementOverride) : "");
  const [note, setNote] = useState(partner.settlementNote || "");
  const [share, setShare] = useState(partner.settlementShared === true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (amount === "" || Number.isNaN(Number(amount))) { setError("Enter an amount."); return; }
    setError("");
    setSubmitting(true);
    const res = await onConfirm(Number(amount), note, share);
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: C.paper, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
        The negotiated final amount -- shown alongside the calculated balance, not instead of it, so nothing's hidden.
      </div>
      <input type="number" step="0.01" className="om-input" style={{ ...input, marginTop: 0 }} placeholder="e.g. 505.00" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
      <input className="om-input" style={{ ...input, marginTop: 8 }} placeholder="Note (optional) -- e.g. 'Agreed flat settlement'" value={note} onChange={(e) => setNote(e.target.value)} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 12 }}>Share any difference with the remaining partners
          <span style={{ display: "block", color: C.muted }}>Off (default): only this partner is affected, nobody else's balance changes. On: if the amount differs from the calculated balance, the difference is split equally between everyone else.</span>
        </span>
      </label>
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted, padding: "6px 10px", fontSize: 12 }} className="om-btn">Cancel</button>
        <button onClick={confirm} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, padding: "6px 12px", fontSize: 12, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={13} /> : <Check size={13} />} Confirm
        </button>
      </div>
    </div>
  );
}

function PartnersTab({ partners, totals, withdrawals, onCreate, onUpdate, onDelete, onSetInactive, onReactivate, onSetSettlement, onClearSettlement, onAddPartner }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingActiveDateFor, setEditingActiveDateFor] = useState(null);
  const [editingSettlementFor, setEditingSettlementFor] = useState(null);
  const [withdrawMethod, setWithdrawMethod] = useState("Cash");
  useEffect(() => { if (!partnerId && partners[0]) setPartnerId(partners[0].id); }, [partners]);

  const submit = async () => {
    if (!partnerId) { setError("Partner is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onCreate({ id: uid(), partnerId, amount: Number(amount), method: withdrawMethod, note, ts: Date.now() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    setAmount(""); setNote("");
  };

  return (
    <div>
      <AddPartnerForm onAdd={onAddPartner} />
      <div style={sectionTitle}>Live balance per partner</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 12, marginBottom: 26 }}>
        {partners.map((p) => {
          const withdrawn = totals.withdrawnByPartner[p.id] || 0;
          const collected = totals.collectedByPartner[p.id] || 0;
          const paidPersonally = totals.paidExpensesByPartner[p.id] || 0;
          const deliveryEarnings = totals.deliveryEarningsByPartner[p.id] || 0;
          const myShare = totals.perPartnerShare[p.id] || 0;
          // Their part of anyone else's negotiated settlement (+ saves them
          // money, - costs them) -- see computeSettlementAdjustments.
          const refundsPaid = totals.refundsPaidByPartner[p.id] || 0;
          const settlementAdj = totals.settlementAdjustmentByPartner[p.id] || 0;
          const sInfo = totals.settlementInfo[p.id]; // only set for a partner with a negotiated settlement
          const balance = myShare - withdrawn - collected + paidPersonally + deliveryEarnings + refundsPaid + settlementAdj;
          const isInactive = Boolean(p.inactiveSince);
          return (
            <div key={p.id} style={{ ...statCard, borderTop: `3px solid ${isInactive ? C.muted : C.ember}`, textAlign: "left", opacity: isInactive ? 0.75 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                {isInactive
                  ? <span style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "2px 8px" }}>Inactive since {tsToDateString(p.inactiveSince)}</span>
                  : p.activeFrom
                    ? <span style={{ fontSize: 11, color: C.mossDark, border: `1px solid ${C.moss}`, borderRadius: 999, padding: "2px 8px" }}>{p.activeFrom > Date.now() ? "Starts" : "Joined"} {tsToDateString(p.activeFrom)}</span>
                    : null}
              </div>
              <div style={statLabel}>Their share {isInactive ? "(frozen as of leaving)" : "(profit earned while active)"}</div>
              <div style={{ ...displayNum, fontSize: 16, marginBottom: 8 }}>{money(myShare)}</div>
              <div style={statLabel}>Withdrawn</div>
              <div style={{ ...displayNum, fontSize: 16, marginBottom: 8 }}>{money(withdrawn)}</div>
              {collected > 0 && (
                <>
                  <div style={statLabel}>Cash collected (not yet returned)</div>
                  <div style={{ ...displayNum, fontSize: 16, marginBottom: 8, color: C.danger }}>-{money(collected)}</div>
                </>
              )}
              {paidPersonally > 0 && (
                <>
                  <div style={statLabel}>Expenses paid personally</div>
                  <div style={{ ...displayNum, fontSize: 16, marginBottom: 8, color: C.success }}>+{money(paidPersonally)}</div>
                </>
              )}
              {deliveryEarnings > 0 && (
                <>
                  <div style={statLabel}>Delivery earnings (direct)</div>
                  <div style={{ ...displayNum, fontSize: 16, marginBottom: 8, color: C.success }}>+{money(deliveryEarnings)}</div>
                </>
              )}
              {refundsPaid > 0 && (
                <>
                  <div style={statLabel}>Customer refunds paid personally</div>
                  <div style={{ ...displayNum, fontSize: 16, marginBottom: 8, color: C.success }}>+{money(refundsPaid)}</div>
                </>
              )}
              {Math.abs(settlementAdj) > 0.004 && (
                <>
                  <div style={statLabel}>Share of a partner's settlement</div>
                  <div style={{ ...displayNum, fontSize: 16, marginBottom: 8, color: settlementAdj < 0 ? C.danger : C.success }}>{settlementAdj < 0 ? "-" : "+"}{money(Math.abs(settlementAdj))}</div>
                </>
              )}
              <div style={statLabel}>Current balance {p.settlementOverride != null ? "(calculated)" : ""}</div>
              <div style={{ ...displayNum, fontSize: p.settlementOverride != null ? 15 : 21, color: p.settlementOverride != null ? C.muted : C.ember, textDecoration: p.settlementOverride != null ? "line-through" : "none" }}>{money(sInfo ? sInfo.beforePayout : balance)}</div>
              {p.settlementOverride != null && sInfo && (
                <>
                  <div style={{ ...statLabel, marginTop: 8 }}>Negotiated settlement (final)</div>
                  <div style={{ ...displayNum, fontSize: 21, color: C.ember }}>{money(p.settlementOverride)}</div>
                  {p.settlementNote && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{p.settlementNote}</div>}
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                    {Math.abs(sInfo.delta) > 0.004
                      ? `${money(Math.abs(sInfo.delta))} ${sInfo.delta > 0 ? "more" : "less"} than calculated -- ${!sInfo.shared ? "not charged to the other partners" : sInfo.bearerCount > 0 ? `shared equally by the ${sInfo.bearerCount} remaining partner${sInfo.bearerCount === 1 ? "" : "s"}` : "no remaining partners to share it"}.`
                      : "Same as the calculated balance."}
                  </div>
                  {sInfo.paidSince > 0 && (
                    <div style={{ fontSize: 12, color: C.moss, marginTop: 4 }}>Paid so far {money(sInfo.paidSince)} · still to pay {money(Math.max(0, sInfo.remaining))}</div>
                  )}
                </>
              )}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isInactive ? (
                  <>
                    <button onClick={() => onReactivate(p)} className="om-btn" style={quickTagBtn}>Reactivate</button>
                    <button onClick={() => setEditingActiveDateFor(editingActiveDateFor === p.id ? null : p.id)} className="om-btn" style={quickTagBtn}>Fix departure date</button>
                  </>
                ) : (
                  <button onClick={() => setEditingActiveDateFor(editingActiveDateFor === p.id ? null : p.id)} className="om-btn" style={quickTagBtn}>Mark inactive (leaving)</button>
                )}
                <button onClick={() => setEditingSettlementFor(editingSettlementFor === p.id ? null : p.id)} className="om-btn" style={quickTagBtn}>
                  {p.settlementOverride != null ? "Edit settlement" : "Override final amount"}
                </button>
                {p.settlementOverride != null && (
                  <button onClick={() => onClearSettlement(p)} className="om-btn" style={{ ...quickTagBtn, borderColor: C.border, color: C.muted }}>Clear override</button>
                )}
              </div>
              {editingActiveDateFor === p.id && (
                <InactiveDateForm partner={p}
                  onConfirm={async (ts) => { const res = await onSetInactive(p, ts); if (res.ok) setEditingActiveDateFor(null); return res; }}
                  onCancel={() => setEditingActiveDateFor(null)} />
              )}
              {editingSettlementFor === p.id && (
                <SettlementOverrideForm partner={p}
                  onConfirm={async (amt, note, share) => { const res = await onSetSettlement(p, amt, note, share); if (res.ok) setEditingSettlementFor(null); return res; }}
                  onCancel={() => setEditingSettlementFor(null)} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 20, marginTop: -14 }}>
        "Their share" is time-aware: profit is split by however many partners were active when it was earned, not today's headcount. Marking someone inactive doesn't change anyone's past numbers -- it only means future profit splits among fewer people.
      </div>

      <div style={card}>
        <div style={cardTitle}>Record a withdrawal</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Partner</label>
            <select className="om-input" style={input} value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setError(""); }}>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label style={fieldLabel}>Amount</label>
            <input type="number" step="0.01" min="0.01" className="om-input" style={input} placeholder="$0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
          </div>
          <div style={{ width: 150 }}>
            <label style={fieldLabel}>Paid out as</label>
            <select className="om-input" style={input} value={withdrawMethod} onChange={(e) => setWithdrawMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>This amount comes off the {withdrawMethod} total on the Summary tab.</div>
        <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
        <input className="om-input" style={input} placeholder="e.g. Rent for June" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={15} /> : <Plus size={15} />} {submitting ? "Saving..." : "Add withdrawal"}
        </button>
      </div>

      <div style={{ ...sectionTitle, marginTop: 26 }}>Withdrawal history</div>
      {withdrawals.length === 0 ? (
        <div style={emptyState}>No withdrawals yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {withdrawals.map((w) =>
            editingId === w.id ? (
              <WithdrawalEditForm key={w.id} withdrawal={w} partners={partners}
                onSave={async (updated) => { const res = await onUpdate(updated); if (res.ok) setEditingId(null); return res; }}
                onCancel={() => setEditingId(null)} />
            ) : (
              <div key={w.id} style={{ ...rowCard, borderLeft: `3px solid ${C.ember}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{partners.find((p) => p.id === w.partnerId)?.name || "Unknown"} <span style={{ fontWeight: 400, fontSize: 12, color: C.muted }}>· {w.method || "Cash"}</span></div>
                  {w.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{w.note}</div>}
                </div>
                <div style={{ ...displayNum, fontSize: 15, marginRight: 14 }}>{money(w.amount)}</div>
                <button onClick={() => setEditingId(w.id)} style={{ ...iconBtn, marginRight: 6 }} className="om-btn" aria-label="Edit withdrawal"><Pencil size={14} /></button>
                <ConfirmDelete label="withdrawal" onConfirm={() => onDelete(w.id)} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ItemForm({ initialName = "", initialVariants, submitLabel, onSubmit, onCancel }) {
  const [itemName, setItemName] = useState(initialName);
  const [variantRows, setVariantRows] = useState(
    initialVariants && initialVariants.length
      ? initialVariants.map((v) => ({ id: uid(), label: v.label || "", price: String(v.price) }))
      : [{ id: uid(), label: "", price: "" }]
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const addVariantRow = () => setVariantRows([...variantRows, { id: uid(), label: "", price: "" }]);
  const updateVariantRow = (id, patch) => setVariantRows(variantRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeVariantRow = (id) => setVariantRows(variantRows.filter((r) => r.id !== id));

  const submit = async () => {
    if (!itemName.trim()) { setError("Item name is required."); return; }
    const variants = variantRows.filter((r) => r.price !== "" && Number(r.price) > 0).map((r) => ({ id: uid(), label: r.label.trim(), price: Number(r.price) }));
    if (variants.length === 0) { setError("At least one price is required."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSubmit({ name: itemName.trim(), variants });
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); return; }
    if (!onCancel) { setItemName(""); setVariantRows([{ id: uid(), label: "", price: "" }]); }
  };

  return (
    <div>
      <label style={fieldLabel}>Item name</label>
      <input className="om-input" style={input} placeholder="e.g. Cheese, Extra Red Sev" value={itemName} onChange={(e) => { setItemName(e.target.value); setError(""); }} />
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.4 }}>
        Toppings and add-ons are just their own item too -- e.g. "Cheese" as its own item, ordered with its own quantity alongside the base plate.
      </div>
      <label style={{ ...fieldLabel, marginTop: 10 }}>Price options</label>
      {variantRows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input className="om-input" style={{ ...input, flex: 1 }} placeholder="Style/size name (optional, e.g. 12 oz, Regular)" value={r.label} onChange={(e) => updateVariantRow(r.id, { label: e.target.value })} />
          <input type="number" step="0.01" min="0.01" className="om-input" style={{ ...input, width: 100 }} placeholder="$0.00" value={r.price} onChange={(e) => { updateVariantRow(r.id, { price: e.target.value }); setError(""); }} />
          {variantRows.length > 1 && (<button onClick={() => removeVariantRow(r.id)} style={iconBtn} className="om-btn" aria-label="Remove price option"><X size={14} /></button>)}
        </div>
      ))}
      <button onClick={addVariantRow} style={ghostBtn} className="om-btn"><Plus size={13} /> Add another price option</button>

      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {onCancel && (
          <button onClick={onCancel} disabled={submitting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
        )}
        <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, marginTop: 0, width: onCancel ? "auto" : "100%", opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={14} /> : <Plus size={14} />} {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

function GroupNameEditor({ group, onRenameGroup }) {
  // Local state decoupled from the server so typing doesn't fire a save on
  // every keystroke, and an in-progress empty field never gets persisted.
  // Mirrors PartnerNameInput below, just styled to sit inline as a heading.
  const [value, setValue] = useState(group.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(group.name); }, [group.name]);

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Category name cannot be empty.");
      setValue(group.name); // revert to the last saved value
      return;
    }
    if (trimmed === group.name) return;
    setError("");
    setSaving(true);
    const res = await onRenameGroup(trimmed);
    setSaving(false);
    if (res && !res.ok) { setError(res.error); setValue(group.name); }
  };

  return (
    <div style={{ flex: 1, marginRight: 10 }}>
      <div style={{ position: "relative" }}>
        <input
          className="om-input"
          style={{ ...cardTitle, marginBottom: 0, width: "100%", border: "none", background: "transparent", padding: "4px 28px 4px 0" }}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        />
        {saving && <Loader2 className="om-spin" size={13} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: C.muted }} />}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function GroupCard({ group, onAddItem, onUpdateItem, onRemoveItem, onRemoveGroup, onRenameGroup }) {
  const [editingItemId, setEditingItemId] = useState(null);

  return (
    <div style={lineBox}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <GroupNameEditor group={group} onRenameGroup={onRenameGroup} />
        <ConfirmDelete label={`${group.name} category`} onConfirm={onRemoveGroup} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {group.items.map((it) =>
          editingItemId === it.id ? (
            <div key={it.id} style={{ ...lineBox, background: C.card }}>
              <ItemForm
                initialName={it.name} initialVariants={it.variants} submitLabel="Save item"
                onSubmit={async (updated) => {
                  const res = await onUpdateItem({ id: it.id, ...updated });
                  if (res.ok) setEditingItemId(null);
                  return res;
                }}
                onCancel={() => setEditingItemId(null)}
              />
            </div>
          ) : (
            <div key={it.id} style={rowCard}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{it.name}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {(it.variants || []).map((v) => `${v.label ? v.label + " " : ""}${money(v.price)}`).join(" · ")}
                </div>
              </div>
              <button onClick={() => setEditingItemId(it.id)} style={{ ...iconBtn, marginRight: 6 }} className="om-btn" aria-label="Edit item"><Pencil size={14} /></button>
              <ConfirmDelete label={it.name} onConfirm={() => onRemoveItem(it.id)} />
            </div>
          )
        )}
      </div>
      <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
        <ItemForm submitLabel={`Add item to ${group.name}`} onSubmit={(item) => onAddItem({ id: uid(), ...item })} />
      </div>
    </div>
  );
}

function PartnerNameInput({ partner, index, onRenamePartner }) {
  // Local state decoupled from the server so typing doesn't fire a save on
  // every keystroke, and an in-progress empty field never gets persisted.
  const [value, setValue] = useState(partner.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(partner.name); }, [partner.name]);

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Partner name cannot be empty.");
      setValue(partner.name); // revert to the last saved value
      return;
    }
    if (trimmed === partner.name) return;
    setError("");
    setSaving(true);
    const res = await onRenamePartner(partner.id, trimmed);
    setSaving(false);
    if (res && !res.ok) { setError(res.error); setValue(partner.name); }
  };

  return (
    <div>
      <label style={fieldLabel}>Partner {index + 1}</label>
      <div style={{ position: "relative" }}>
        <input
          className="om-input" style={input} value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        />
        {saving && <Loader2 className="om-spin" size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: C.muted }} />}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function CustomerOrderLinkCard() {
  const [link, setLink] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/order`;
    setLink(url);
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: "#121412", light: "#F0EDE6" } })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    });
  }, []);

  const copyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Customer order link</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>
        Share this link (or the QR code) so customers can place their own orders. They show up in the{" "}
        <strong>Incoming</strong> tab for you to review before they're added to Order History.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input readOnly className="om-input" style={{ ...input, flex: 1, minWidth: 200 }} value={link} onFocus={(e) => e.target.select()} />
        <button onClick={copyLink} style={{ ...primaryBtn, width: "auto", marginTop: 0 }} className="om-btn">
          {copied ? <Check size={15} /> : null} {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      {qrDataUrl && (
        <div style={{ textAlign: "center" }}>
          <img src={qrDataUrl} alt="QR code for the customer order link" style={{ borderRadius: 12, border: `1px solid ${C.border}` }} />
          <div style={{ marginTop: 10 }}>
            <a href={qrDataUrl} download="surti-aloopuri-order-qr.png" style={{ fontSize: 13, color: C.ember }}>Download QR code to print</a>
          </div>
        </div>
      )}
    </div>
  );
}

function ResetMenuButton({ onReset }) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const doReset = async () => {
    setResetting(true);
    await onReset();
    setResetting(false);
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} style={{ ...ghostBtn, marginTop: 0, borderColor: C.danger, color: C.danger }} className="om-btn">
        Reset menu to defaults
      </button>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: C.danger }}>This replaces your entire menu -- any custom items or prices will be lost. Sure?</span>
      <button onClick={() => setConfirming(false)} disabled={resetting} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
      <button onClick={doReset} disabled={resetting} style={{ ...primaryBtn, marginTop: 0, width: "auto", background: C.danger }} className="om-btn">
        {resetting ? <Loader2 className="om-spin" size={14} /> : null} Yes, reset it
      </button>
    </div>
  );
}

function SyncSheetsButton({ onSync }) {
  const [status, setStatus] = useState("idle"); // idle | syncing | success | error
  const [message, setMessage] = useState("");

  const run = async () => {
    setStatus("syncing");
    setMessage("");
    const res = await onSync();
    if (res && res.ok === false) {
      setStatus("error");
      setMessage(res.error || "Sync failed.");
    } else {
      setStatus("success");
      const counts = ["Orders", "Expenses", "Withdrawals", "Credits", "Partners"]
        .map((tab) => (res?.[tab]?.rowsWritten !== undefined ? `${res[tab].rowsWritten} ${tab.toLowerCase()}` : null))
        .filter(Boolean)
        .join(", ");
      setMessage(counts ? `Synced ${counts}.` : "Synced.");
    }
  };

  return (
    <div>
      <button onClick={run} disabled={status === "syncing"} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: status === "syncing" ? 0.7 : 1 }} className="om-btn">
        {status === "syncing" ? <Loader2 className="om-spin" size={15} /> : <Check size={15} />} {status === "syncing" ? "Syncing..." : "Sync to Google Sheet"}
      </button>
      {message && (
        <div style={{ fontSize: 12, marginTop: 6, color: status === "error" ? C.danger : C.moss }}>{message}</div>
      )}
    </div>
  );
}

function DeliveryZonesCard({ zones, onAdd, onUpdate, onRemove }) {
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editFee, setEditFee] = useState("");

  const add = async () => {
    if (!name.trim()) { setError("Zone name is required."); return; }
    if (!(Number(fee) >= 0)) { setError("Fee must be zero or greater."); return; }
    setError("");
    setAdding(true);
    const res = await onAdd(name.trim(), Number(fee));
    setAdding(false);
    if (res && !res.ok) { setError(res.error); return; }
    setName(""); setFee("");
  };

  const startEdit = (z) => { setEditingId(z.id); setEditName(z.name); setEditFee(String(z.fee)); };
  const saveEdit = async (id) => {
    const res = await onUpdate(id, editName.trim(), Number(editFee));
    if (res && res.ok) setEditingId(null);
  };

  return (
    <div style={{ ...card, marginTop: 24 }}>
      <div style={cardTitle}>Delivery zones & fees</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Used by the delivery picker on New Order and when editing an order. 60% of the fee goes straight to the delivering partner, 40% to shared profit. Uber Courier deliveries are separate: the whole fee goes to the driver.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {zones.map((z) => (
          <div key={z.id} style={{ display: "flex", gap: 8, alignItems: "center", background: C.paper, borderRadius: 10, padding: 10 }}>
            {editingId === z.id ? (
              <>
                <input className="om-input" style={{ ...input, marginTop: 0, flex: 2 }} value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0, width: 90 }} value={editFee} onChange={(e) => setEditFee(e.target.value)} />
                <button onClick={() => saveEdit(z.id)} style={{ ...iconBtn, width: 32, height: 32 }} className="om-btn" aria-label="Save"><Check size={14} /></button>
                <button onClick={() => setEditingId(null)} style={{ ...iconBtn, width: 32, height: 32 }} className="om-btn" aria-label="Cancel"><X size={14} /></button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, fontSize: 14 }}>{z.name}</div>
                <div style={{ ...displayNum, fontSize: 14 }}>{money(z.fee)}</div>
                <button onClick={() => startEdit(z)} style={{ ...iconBtn, width: 32, height: 32 }} className="om-btn" aria-label="Edit"><Pencil size={13} /></button>
                <ConfirmDelete label={`${z.name} zone`} onConfirm={() => onRemove(z.id)} />
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="om-input" style={{ ...input, marginTop: 0, flex: 2, minWidth: 160 }} placeholder="Zone name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, marginTop: 0, width: 100 }} placeholder="Fee" value={fee} onChange={(e) => { setFee(e.target.value); setError(""); }} />
        <button onClick={add} disabled={adding} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: adding ? 0.7 : 1 }} className="om-btn">
          {adding ? <Loader2 className="om-spin" size={14} /> : <Plus size={14} />} Add zone
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function SettingsTab({ menu, partners, deliveryZones, backupData, onAddGroup, onRenameGroup, onRemoveGroup, onAddItem, onUpdateItem, onRemoveItem, onRenamePartner, onResetMenu, onSyncSheets, onAddDeliveryZone, onUpdateDeliveryZone, onRemoveDeliveryZone }) {
  const [groupName, setGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);

  const addGroup = async () => {
    if (!groupName.trim()) { setGroupError("Category name is required."); return; }
    setGroupError("");
    setAddingGroup(true);
    const res = await onAddGroup(groupName.trim());
    setAddingGroup(false);
    if (res && !res.ok) { setGroupError(res.error); return; }
    setGroupName("");
  };

  return (
    <div>
      <CustomerOrderLinkCard />
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={cardTitle}>Google Sheets backup</div>
          <div style={{ fontSize: 13, color: C.muted }}>Runs automatically every night, plus you can trigger it manually any time.</div>
        </div>
        <SyncSheetsButton onSync={onSyncSheets} />
      </div>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={cardTitle}>Backup your data</div>
          <div style={{ fontSize: 13, color: C.muted }}>Download a copy of everything, in addition to the Google Sheets backup.</div>
        </div>
        <button onClick={() => exportBackup(backupData)} style={{ ...primaryBtn, width: "auto", marginTop: 0 }} className="om-btn"><Download size={15} /> Download backup</button>
      </div>
      <div style={{ ...cardTitle, marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span>Menu categories</span>
        <ResetMenuButton onReset={onResetMenu} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {menu.map((g) => (
          <GroupCard key={g.id} group={g}
            onAddItem={(item) => onAddItem(g.id, item)}
            onUpdateItem={(item) => onUpdateItem(g.id, item)}
            onRemoveItem={(iid) => onRemoveItem(g.id, iid)}
            onRemoveGroup={() => onRemoveGroup(g.id)}
            onRenameGroup={(name) => onRenameGroup(g.id, name)} />
        ))}
      </div>
      <div style={{ ...card, marginTop: 14 }}>
        <label style={fieldLabel}>New category name</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="om-input" style={{ ...input, flex: 1 }} placeholder="e.g. Surti Aloopuri" value={groupName} onChange={(e) => { setGroupName(e.target.value); setGroupError(""); }} />
          <button onClick={addGroup} disabled={addingGroup} style={{ ...iconBtn, height: 38, opacity: addingGroup ? 0.7 : 1 }} className="om-btn" aria-label="Add category">
            {addingGroup ? <Loader2 className="om-spin" size={16} /> : <Plus size={16} />}
          </button>
        </div>
        <ErrorText>{groupError}</ErrorText>
      </div>
      <DeliveryZonesCard zones={deliveryZones} onAdd={onAddDeliveryZone} onUpdate={onUpdateDeliveryZone} onRemove={onRemoveDeliveryZone} />
      <div style={{ ...card, marginTop: 20 }}>
        <div style={cardTitle}>Partner names</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {partners.map((p, i) => (
            <PartnerNameInput key={p.id} partner={p} index={i} onRenamePartner={onRenamePartner} />
          ))}
        </div>
      </div>
    </div>
  );
}

const wrap = { maxWidth: 740, margin: "0 auto", padding: "1.25rem 1rem", color: C.ink, background: C.paper, minHeight: "100vh" };
const displayH1 = { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 21, textAlign: "center", color: C.ink, letterSpacing: "-0.01em" };
const displayNum = { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, color: C.ink };
const badge = { background: C.moss, color: "#FAF6EE", width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const gateCard = { maxWidth: 360, margin: "3rem auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "30px 26px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 8px 24px rgba(0,0,0,0.4)" };
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 10px rgba(0,0,0,0.3)" };
const lineBox = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, background: "#22261F" };
const cardTitle = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, marginBottom: 14, color: C.ink };
const sectionTitle = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 };
const rowCard = { display: "flex", alignItems: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" };
const emptyState = { color: C.muted, fontSize: 14, padding: "18px 0", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 12 };
const safetyNote = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.moss, background: C.mossTint, border: `1px solid ${C.moss}22`, borderRadius: 10, padding: "10px 12px" };
const fieldLabel = { display: "block", fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontSize: 14, transition: "border-color .15s, box-shadow .15s" };
const primaryBtn = { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", width: "100%", marginTop: 16, padding: "11px 18px", borderRadius: 10, border: "none", background: C.moss, color: "#FAF6EE", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 12px", borderRadius: 10, border: `1px dashed ${C.ember}`, background: "transparent", color: C.ember, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const iconBtn = { display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.muted, cursor: "pointer", flexShrink: 0 };
const pill = { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 999, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 10 };
const quickTagBtn = { fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${C.ember}`, background: "transparent", color: C.ember, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 };
const qtyPreset = { padding: "6px 13px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const qtyPresetActive = { background: C.mossTint, borderColor: C.moss, color: C.mossDark, fontWeight: 700 };
const stepBtn = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const tabRow = { display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 12 };
const tabBtn = { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500 };
const statCard = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "left", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" };
const statLabel = { fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 500 };
const statValue = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600 };
