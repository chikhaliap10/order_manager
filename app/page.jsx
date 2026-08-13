"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Check, X, Lock, Receipt, History, Wallet, Users, Settings2, ChefHat, Loader2, Download, ShieldCheck, Pencil, Inbox } from "lucide-react";

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
  const [tab, setTab] = useState("orders");

  const refresh = async () => {
    try {
      setLoadError(null);
      const data = await api("/api/state");
      if (data.authed) {
        setUnlocked(true);
        setMenu(data.menu); setPartners(data.partners); setOrders(data.orders);
        setExpenses(data.expenses); setWithdrawals(data.withdrawals); setCredits(data.credits || []);
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
      return { ok: true };
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
    const income = visibleOrders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0);
    const pending = visibleOrders.filter((o) => !o.paid).reduce((s, o) => s + o.total, 0);
    const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const netProfit = income - expenseTotal;
    const share = partners.length ? netProfit / partners.length : 0;
    const withdrawnByPartner = {};
    const collectedByPartner = {};
    const paidExpensesByPartner = {};
    partners.forEach((p) => {
      withdrawnByPartner[p.id] = withdrawals.filter((w) => w.partnerId === p.id).reduce((s, w) => s + Number(w.amount || 0), 0);
      // Cash a partner personally collected from a paid order is money
      // they're already holding -- it counts against their balance exactly
      // like a withdrawal would, even though no formal withdrawal was made.
      collectedByPartner[p.id] = visibleOrders.filter((o) => o.paid && o.collectedBy === p.id).reduce((s, o) => s + o.total, 0);
      // Expenses a partner paid out of their own pocket are the opposite --
      // they fronted business money personally, so it's credited back.
      paidExpensesByPartner[p.id] = expenses.filter((e) => e.paidBy === p.id).reduce((s, e) => s + Number(e.amount || 0), 0);
    });
    const expensePercent = income > 0 ? (expenseTotal / income) * 100 : 0;
    const profitPercent = income > 0 ? (netProfit / income) * 100 : 0;
    return { income, pending, expenseTotal, netProfit, share, withdrawnByPartner, collectedByPartner, paidExpensesByPartner, expensePercent, profitPercent };
  }, [visibleOrders, expenses, withdrawals, partners]);

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
          <NewOrderTab menu={menu} partners={partners} credits={credits} orders={visibleOrders}
            onCreate={(order) => act("order", "create", order)}
            onAddCredit={(entry) => act("credits", "create", entry)} />
        )}
        {tab === "history" && (
          <OrderHistoryTab menu={menu} orders={visibleOrders} partners={partners} credits={credits}
            onTogglePaid={(id) => act("order", "toggle-paid", { id })}
            onUpdate={(order) => act("order", "update", order)}
            onDelete={(id) => act("order", "delete", { id })}
            onAddCredit={(entry) => act("credits", "create", entry)}
            onUpdateCredit={(entry) => act("credits", "update", entry)}
            onDeleteCredit={(id) => act("credits", "delete", { id })} />
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
            onDelete={(id) => act("withdrawal", "delete", { id })} />
        )}
        {tab === "settings" && (
          <SettingsTab menu={menu} partners={partners}
            backupData={{ menu, partners, orders, expenses, withdrawals }}
            onAddGroup={(name) => act("menu", "add-group", { name })}
            onRenameGroup={(groupId, name) => act("menu", "rename-group", { groupId, name })}
            onRemoveGroup={(groupId) => act("menu", "remove-group", { groupId })}
            onAddItem={(groupId, item) => act("menu", "add-item", { groupId, item })}
            onUpdateItem={(groupId, item) => act("menu", "update-item", { groupId, item })}
            onRemoveItem={(groupId, itemId) => act("menu", "remove-item", { groupId, itemId })}
            onRenamePartner={(id, name) => act("partners", "rename", { id, name })}
            onResetMenu={() => act("menu", "reset", {})} />
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
  const hasVariants = item && item.variants.length > 1;
  const variant = item?.variants.find((v) => v.id === line.variantId);
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
            {item.variants.map((v) => (
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
  const key = customerName.trim().toLowerCase();
  if (!key) return 0;
  return credits.filter((c) => c.customer.trim().toLowerCase() === key).reduce((s, c) => s + Number(c.amount || 0), 0);
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

function NewOrderTab({ menu, partners, credits, orders, onCreate, onAddCredit }) {
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [tip, setTip] = useState("");
  const [applyCredit, setApplyCredit] = useState(false);
  const [forPartner, setForPartner] = useState(false);
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [settlement, setSettlement] = useState("deduct"); // deduct | cash
  const [orderDate, setOrderDate] = useState(todayDateString());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
  const preTotal = subtotal + tipAmount;
  const effectiveCustomer = forPartner ? (partners.find((p) => p.id === partnerId)?.name || "") : customer;
  const availableCredit = forPartner ? 0 : creditBalanceFor(credits, customer);
  const creditToApply = applyCredit && availableCredit > 0 ? Math.min(availableCredit, preTotal) : 0;
  const orderTotal = preTotal - creditToApply;

  const submit = async () => {
    if (!effectiveCustomer.trim()) { setError(forPartner ? "Choose a partner." : "Customer name is required."); return; }
    if (!forPartner && !isValidPhone(phone)) { setError("Enter a valid phone number (at least 10 digits)."); return; }
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
    const finalTotal = itemsTotal + tipAmount - creditToApply;
    const ts = dateStringToTs(orderDate);
    const res = await onCreate(
      forPartner
        ? {
            id: uid(), customer: effectiveCustomer.trim(), items, tip: 0, total: itemsTotal,
            paid: true, paymentMethod: settlement === "cash" ? "Cash" : INTERNAL_METHOD,
            collectedBy: settlement === "deduct" ? partnerId : "", ts,
          }
        : {
            id: uid(), customer: customer.trim(), phone: phone.trim(), items, tip: tipAmount,
            creditApplied: creditToApply, total: finalTotal, paid: false, ts,
          }
    );
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    if (!forPartner && creditToApply > 0) {
      await onAddCredit({ customer: customer.trim(), amount: -creditToApply, note: "Applied to a new order" });
    }
    setCustomer(""); setPhone(""); setTip(""); setApplyCredit(false); setForPartner(false); setOrderDate(todayDateString()); setLines([makeLine()]);
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
                  {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                <label style={{ ...fieldLabel, marginTop: 12 }}>Phone number</label>
                <input type="tel" className="om-input" style={input} placeholder="e.g. (551) 359-1166" value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} />
                {phone.trim() && !isValidPhone(phone) && (
                  <div style={{ fontSize: 12, color: C.danger, marginTop: 4 }}>Enter at least 10 digits.</div>
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
              </>
            )}
            <label style={{ ...fieldLabel, marginTop: 16 }}>Order date</label>
            <input type="date" className="om-input" style={{ ...input, width: 170 }} value={orderDate} max={todayDateString()} onChange={(e) => setOrderDate(e.target.value)} />
            {orderDate !== todayDateString() && (
              <div style={{ fontSize: 12, color: C.ember, marginTop: 6 }}>This will be logged as a past order, not today's.</div>
            )}
            <ErrorText>{error}</ErrorText>
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              {(tipAmount > 0 || creditToApply > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginBottom: 6 }}>
                  <span>
                    Subtotal {money(subtotal)}{tipAmount > 0 ? ` + tip ${money(tipAmount)}` : ""}{creditToApply > 0 ? ` − credit ${money(creditToApply)}` : ""}
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

function orderToLines(order, menu) {
  return order.items.map((it) => {
    for (const g of menu) {
      const item = g.items.find((i) => i.name === it.name);
      if (item) {
        const variant = item.variants.find((v) => v.label === it.variantLabel) || item.variants[0];
        return { id: uid(), groupId: g.id, itemId: item.id, variantId: variant?.id || "", qty: it.qty, price: it.price };
      }
    }
    const g = menu[0]; const item = firstItem(g);
    const v = firstVariant(item);
    return { id: uid(), groupId: g?.id || "", itemId: item?.id || "", variantId: v?.id || "", qty: it.qty, price: it.price };
  });
}

function OrderEditForm({ order, menu, partners, onSave, onCancel }) {
  const [customer, setCustomer] = useState(order.customer);
  const [phone, setPhone] = useState(order.phone || "");
  const [lines, setLines] = useState(orderToLines(order, menu));
  const [tip, setTip] = useState(order.tip ? String(order.tip) : "");
  const [collectedBy, setCollectedBy] = useState(order.collectedBy || "");
  const [orderDate, setOrderDate] = useState(tsToDateString(order.ts || Date.now()));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const getItemFor = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
  const getVariant = (l) => getItemFor(l)?.variants?.find((v) => v.id === l.variantId);
  const linePrice = (l) => {
    const it = getItemFor(l);
    return l.price !== undefined && l.price !== "" ? Number(l.price) : (getVariant(l)?.price || 0);
  };
  const lineTotal = (l) => linePrice(l) * (Number(l.qty) || 0);
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tipAmount = Number(tip) || 0;
  const total = subtotal + tipAmount;
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => {
    const g = menu[0]; const it = firstItem(g);
    const v = firstVariant(it);
    setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1, price: v?.price ?? "" }]);
  };
  const save = async () => {
    if (!customer.trim()) { setError("Customer name is required."); return; }
    if (!isValidPhone(phone)) { setError("Enter a valid phone number (at least 10 digits)."); return; }
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
    const res = await onSave({ ...order, customer: customer.trim(), phone: phone.trim(), items, tip: tipAmount, total: itemsTotal + tipAmount, collectedBy: order.paid ? collectedBy : "", ts: dateStringToTs(orderDate) });
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing order</div>
      <label style={fieldLabel}>Customer name</label>
      <input className="om-input" style={input} value={customer} onChange={(e) => { setCustomer(e.target.value); setError(""); }} />
      <label style={{ ...fieldLabel, marginTop: 12 }}>Phone number</label>
      <input type="tel" className="om-input" style={input} value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} />
      {order.paid && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Collected by</label>
          <select className="om-input" style={input} value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)}>
            <option value="">Shared account</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {lines.map((l) => (
          <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
        ))}
      </div>
      <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
      <label style={{ ...fieldLabel, marginTop: 16 }}>Tip (optional)</label>
      <input type="number" step="0.01" min="0" className="om-input" style={{ ...input, width: 140 }} placeholder="$0.00" value={tip} onChange={(e) => setTip(e.target.value)} />
      <label style={{ ...fieldLabel, marginTop: 16 }}>Order date</label>
      <input type="date" className="om-input" style={{ ...input, width: 170 }} value={orderDate} max={todayDateString()} onChange={(e) => setOrderDate(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        {tipAmount > 0 && (
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Subtotal {money(subtotal)} + tip {money(tipAmount)}</div>
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
        {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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

function computeItemBreakdown(orders) {
  const map = {};
  orders.forEach((o) => {
    (o.items || []).forEach((i) => {
      const key = i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name;
      if (!map[key]) map[key] = { key, qty: 0, revenue: 0 };
      map[key].qty += Number(i.qty) || 0;
      map[key].revenue += (Number(i.price) || 0) * (Number(i.qty) || 0);
    });
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
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

function SalesBreakdown({ orders }) {
  const rows = computeItemBreakdown(orders);
  if (rows.length === 0) return null;
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Plates sold by item</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Across all orders, paid and unpaid</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 14 }}>{r.key}</div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.muted }}>{r.qty} plate{r.qty === 1 ? "" : "s"}</span>
              <span style={{ ...displayNum, fontSize: 14, color: C.moss }}>{money(r.revenue)}</span>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0 0" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Total, all categories</div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{totalQty} plate{totalQty === 1 ? "" : "s"}</span>
            <span style={{ ...displayNum, fontSize: 15, color: C.ember }}>{money(totalRevenue)}</span>
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

const PAYMENT_METHODS = ["Cash", "Zelle", "Debit Card", "Credit Card"];
const INTERNAL_METHOD = "Internal (deducted, no cash)";

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

function CustomerCreditsPanel({ credits, onUpdateCredit, onDeleteCredit }) {
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [editingEntryId, setEditingEntryId] = useState(null);

  const byCustomer = {};
  credits.forEach((c) => {
    const key = c.customer.trim();
    if (!byCustomer[key]) byCustomer[key] = { customer: key, entries: [], balance: 0 };
    byCustomer[key].entries.push(c);
    byCustomer[key].balance += Number(c.amount) || 0;
  });
  const customers = Object.values(byCustomer).filter((c) => Math.abs(c.balance) > 0.001 || c.entries.length > 0);
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
              <span style={{ fontSize: 12, color: C.muted }}>{expandedCustomer === c.customer ? "hide" : "details"}</span>
            </div>
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
                        <div style={{ fontSize: 13 }}>{entry.note || "(no note)"}</div>
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

function computePaymentTypeTotals(orders) {
  const map = {};
  orders.filter((o) => o.paid).forEach((o) => {
    const method = o.paymentMethod || "Cash";
    map[method] = (map[method] || 0) + o.total;
  });
  const realMethods = PAYMENT_METHODS.filter((m) => map[m] !== undefined).map((m) => ({ method: m, total: map[m], internal: false }));
  const internal = map[INTERNAL_METHOD] !== undefined ? [{ method: INTERNAL_METHOD, total: map[INTERNAL_METHOD], internal: true }] : [];
  return [...realMethods, ...internal];
}

function PaymentTypeTotals({ orders }) {
  const rows = computePaymentTypeTotals(orders);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={cardTitle}>Total by payment method</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Paid orders only — this is what you should physically have in cash/Zelle/cards, excluding internal partner-meal deductions below</div>
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

function OrderHistoryTab({ menu, orders, partners, credits, onTogglePaid, onUpdate, onDelete, onAddCredit, onUpdateCredit, onDeleteCredit }) {
  const [editingId, setEditingId] = useState(null);
  const [pickingCollectorId, setPickingCollectorId] = useState(null);
  const [recordingAmountId, setRecordingAmountId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [returningId, setReturningId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | paid | unpaid
  const [methodFilter, setMethodFilter] = useState("all"); // all | Cash | Zelle | Debit Card | Credit Card

  const handleToggle = async (id) => {
    setTogglingId(id);
    await onTogglePaid(id); // instant, one click -- defaults to shared account
    setTogglingId(null);
  };

  const returnToShared = async (order) => {
    setReturningId(order.id);
    await onUpdate({ ...order, collectedBy: "" });
    setReturningId(null);
  };

  const recordAmountReceived = async (order, amountReceived) => {
    const previousReceived = order.amountReceived ?? order.total;
    const previousChange = Math.max(0, previousReceived - order.total);
    const newChange = Math.max(0, amountReceived - order.total);
    const delta = newChange - previousChange; // only the difference gets logged, not the whole amount again
    await onUpdate({ ...order, amountReceived });
    if (delta !== 0) {
      await onAddCredit({
        customer: order.customer, amount: delta,
        note: previousChange > 0 ? `Corrected overpayment on order for ${order.customer}` : `Overpayment on order for ${order.customer}`,
      });
    }
    setRecordingAmountId(null);
  };

  const partnerName = (id) => partners.find((p) => p.id === id)?.name;

  const filteredOrders = orders.filter((o) => {
    if (search.trim() && !o.customer.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (statusFilter === "paid" && !o.paid) return false;
    if (statusFilter === "unpaid" && o.paid) return false;
    if (methodFilter !== "all" && (o.paymentMethod || "Cash") !== methodFilter) return false;
    return true;
  });

  return (
    <div>
      <CustomerCreditsPanel credits={credits} onUpdateCredit={onUpdateCredit} onDeleteCredit={onDeleteCredit} />
      <PaymentTypeTotals orders={orders} />
      <DailyBreakdown orders={orders} />
      <SalesBreakdown orders={orders} />
      <div style={safetyNote}><ShieldCheck size={15} /> Every order is saved to the database and synced to Google Sheets as a backup — nothing is lost.</div>

      <div style={{ ...card, marginTop: 18, marginBottom: 18 }}>
        <label style={fieldLabel}>Search by customer name</label>
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
        </div>
      </div>

      <div style={{ ...sectionTitle, marginTop: 18 }}>
        {filteredOrders.length} of {orders.length} order{orders.length === 1 ? "" : "s"} shown
      </div>
      {orders.length === 0 ? (
        <div style={emptyState}>No orders yet — add one from the New order tab.</div>
      ) : filteredOrders.length === 0 ? (
        <div style={emptyState}>No orders match your search/filters.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredOrders.map((o) =>
            editingId === o.id ? (
              <OrderEditForm key={o.id} order={o} menu={menu} partners={partners}
                onSave={async (updated) => { const res = await onUpdate(updated); if (res.ok) setEditingId(null); return res; }}
                onCancel={() => setEditingId(null)} />
            ) : pickingCollectorId === o.id ? (
              <CollectorPicker key={o.id} order={o} partners={partners}
                onConfirm={async (collectedBy) => { await onUpdate({ ...o, collectedBy }); setPickingCollectorId(null); }}
                onCancel={() => setPickingCollectorId(null)} />
            ) : recordingAmountId === o.id ? (
              <AmountReceivedPicker key={o.id} order={o}
                onConfirm={(amt) => recordAmountReceived(o, amt)}
                onCancel={() => setRecordingAmountId(null)} />
            ) : (
              <div key={o.id} style={{ ...rowCard, borderLeft: `3px solid ${o.paid ? C.success : C.warning}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{o.customer}</div>
                    {o.source === "online" && (
                      <span style={{ fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 8px" }}>Placed online</span>
                    )}
                  </div>
                  {o.phone && <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{o.phone}</div>}
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                    {o.items.map((i) => `${i.qty}× ${i.name}${i.variantLabel ? " (" + i.variantLabel + ")" : ""}`).join(", ")}
                  </div>
                  {o.paid && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                      <select className="om-input" style={{ ...input, width: "auto", padding: "4px 8px", fontSize: 12, marginTop: 0 }}
                        value={o.paymentMethod || "Cash"} onChange={(e) => onUpdate({ ...o, paymentMethod: e.target.value })}>
                        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        {o.paymentMethod === INTERNAL_METHOD && <option value={INTERNAL_METHOD}>{INTERNAL_METHOD}</option>}
                      </select>
                      {o.collectedBy ? (
                        <>
                          <span style={{ fontSize: 12, color: C.ember }}>Collected by {partnerName(o.collectedBy) || "Unknown"}</span>
                          <button onClick={() => returnToShared(o)} disabled={returningId === o.id} className="om-btn"
                            style={quickTagBtn}>
                            {returningId === o.id ? <Loader2 className="om-spin" size={11} /> : null} Mark as returned to shared account
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setPickingCollectorId(o.id)} className="om-btn" style={quickTagBtn}>
                          A partner collected this cash instead of shared?

                        </button>
                      )}
                      <button onClick={() => setRecordingAmountId(o.id)} className="om-btn" style={quickTagBtn}>
                        {o.amountReceived !== undefined && o.amountReceived > o.total
                          ? `Received ${money(o.amountReceived)} (${money(o.amountReceived - o.total)} owed to them)`
                          : "Paid more than the bill?"}
                      </button>
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
            )
          )}
        </div>
      )}
    </div>
  );
}

function ExpenseEditForm({ expense, partners, onSave, onCancel }) {
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [note, setNote] = useState(expense.note || "");
  const [paidBy, setPaidBy] = useState(expense.paidBy || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!category.trim()) { setError("Category is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...expense, category, amount: Number(amount), note, paidBy });
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

function ExpensesTab({ expenses, partners, onCreate, onUpdate, onDelete }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Ingredients");
  const [note, setNote] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const submit = async () => {
    if (!category.trim()) { setError("Category is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onCreate({ id: uid(), amount: Number(amount), category, note, paidBy, ts: Date.now() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    setAmount(""); setNote(""); setPaidBy("");
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
        <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
        <input className="om-input" style={input} placeholder="e.g. Sunday market veggie run" value={note} onChange={(e) => setNote(e.target.value)} />
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
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!partnerId) { setError("Partner is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...withdrawal, partnerId, amount: Number(amount), note });
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

function PartnersTab({ partners, totals, withdrawals, onCreate, onUpdate, onDelete }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  useEffect(() => { if (!partnerId && partners[0]) setPartnerId(partners[0].id); }, [partners]);

  const submit = async () => {
    if (!partnerId) { setError("Partner is required."); return; }
    if (!amount || Number(amount) <= 0) { setError("Amount must be greater than 0."); return; }
    setError("");
    setSubmitting(true);
    const res = await onCreate({ id: uid(), partnerId, amount: Number(amount), note, ts: Date.now() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    setAmount(""); setNote("");
  };

  return (
    <div>
      <div style={sectionTitle}>Live balance per partner</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 12, marginBottom: 26 }}>
        {partners.map((p) => {
          const withdrawn = totals.withdrawnByPartner[p.id] || 0;
          const collected = totals.collectedByPartner[p.id] || 0;
          const paidPersonally = totals.paidExpensesByPartner[p.id] || 0;
          const balance = totals.share - withdrawn - collected + paidPersonally;
          return (
            <div key={p.id} style={{ ...statCard, borderTop: `3px solid ${C.ember}`, textAlign: "left" }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{p.name}</div>
              <div style={statLabel}>Lifetime share</div>
              <div style={{ ...displayNum, fontSize: 16, marginBottom: 8 }}>{money(totals.share)}</div>
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
              <div style={statLabel}>Current balance</div>
              <div style={{ ...displayNum, fontSize: 21, color: C.ember }}>{money(balance)}</div>
            </div>
          );
        })}
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
        </div>
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
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{partners.find((p) => p.id === w.partnerId)?.name || "Unknown"}</div>
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

function SettingsTab({ menu, partners, backupData, onAddGroup, onRenameGroup, onRemoveGroup, onAddItem, onUpdateItem, onRemoveItem, onRenamePartner, onResetMenu }) {
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
          <div style={cardTitle}>Backup your data</div>
          <div style={{ fontSize: 13, color: C.muted }}>Download a copy of everything, in addition to the automatic Google Sheets backup.</div>
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
