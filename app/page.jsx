"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Check, X, Lock, Receipt, History, Wallet, Users, Settings2, ChefHat, Loader2, Download, ShieldCheck, Pencil } from "lucide-react";

const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);
const QTY_PRESETS = [5, 10, 15, 20, 25];

const C = {
  ink: "#23291F", paper: "#FAF6EE", card: "#FFFFFF",
  moss: "#2F4B3C", mossDark: "#1F3529", mossTint: "#E3EAE1",
  ember: "#C9622B", emberTint: "#F6E4D6",
  success: "#2F7D4F", successTint: "#E2F0E7",
  danger: "#B3402E", dangerTint: "#FAE7E3",
  warning: "#B8791E", warningTint: "#FAEDD9",
  border: "#E8E1D2", muted: "#8A8570",
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
  const [tab, setTab] = useState("orders");

  const refresh = async () => {
    try {
      setLoadError(null);
      const data = await api("/api/state");
      if (data.authed) {
        setUnlocked(true);
        setMenu(data.menu); setPartners(data.partners); setOrders(data.orders);
        setExpenses(data.expenses); setWithdrawals(data.withdrawals);
      } else {
        setUnlocked(false);
      }
    } catch (err) {
      setLoadError(err.message || "Something went wrong loading the app.");
    }
    setReady(true);
  };

  useEffect(() => { refresh(); }, []);

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
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || "Something went wrong. Please try again." };
    }
  };

  const totals = useMemo(() => {
    const income = orders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0);
    const pending = orders.filter((o) => !o.paid).reduce((s, o) => s + o.total, 0);
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
      collectedByPartner[p.id] = orders.filter((o) => o.paid && o.collectedBy === p.id).reduce((s, o) => s + o.total, 0);
      // Expenses a partner paid out of their own pocket are the opposite --
      // they fronted business money personally, so it's credited back.
      paidExpensesByPartner[p.id] = expenses.filter((e) => e.paidBy === p.id).reduce((s, e) => s + Number(e.amount || 0), 0);
    });
    return { income, pending, expenseTotal, netProfit, share, withdrawnByPartner, collectedByPartner, paidExpensesByPartner };
  }, [orders, expenses, withdrawals, partners]);

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

  const tabs = [
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
            style={{ ...tabBtn, background: tab === t.id ? C.moss : "transparent", color: tab === t.id ? "#FAF6EE" : C.muted }}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <SummaryStrip totals={totals} />

      <div key={tab} className="om-fade">
        {tab === "orders" && (
          <NewOrderTab menu={menu}
            onCreate={(order) => act("order", "create", order)} />
        )}
        {tab === "history" && (
          <OrderHistoryTab menu={menu} orders={orders} partners={partners}
            onTogglePaid={(id, collectedBy) => act("order", "toggle-paid", { id, collectedBy })}
            onUpdate={(order) => act("order", "update", order)}
            onDelete={(id) => act("order", "delete", { id })} />
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
            onRemoveGroup={(groupId) => act("menu", "remove-group", { groupId })}
            onAddItem={(groupId, item) => act("menu", "add-item", { groupId, item })}
            onRemoveItem={(groupId, itemId) => act("menu", "remove-item", { groupId, itemId })}
            onRenamePartner={(id, name) => act("partners", "rename", { id, name })} />
        )}
      </div>
    </div>
  );
}

function SummaryStrip({ totals }) {
  const items = [
    { label: "Income (paid)", value: totals.income, color: C.success },
    { label: "Pending", value: totals.pending, color: C.warning },
    { label: "Expenses", value: totals.expenseTotal, color: C.danger },
    { label: "Net profit", value: totals.netProfit, color: C.moss },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12, marginBottom: 26 }}>
      {items.map((it) => (
        <div key={it.label} style={{ ...statCard, borderTop: `3px solid ${it.color}` }}>
          <div style={statLabel}>{it.label}</div>
          <div style={{ ...statValue, color: it.color }}>{money(it.value)}</div>
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
  const total = (variant?.price || 0) * (Number(line.qty) || 0);

  const onGroupChange = (groupId) => {
    const g = menu.find((mg) => mg.id === groupId);
    const it = g?.items?.[0];
    const v = it?.variants?.[0];
    onChange({ ...line, groupId, itemId: it?.id || "", variantId: v?.id || "" });
  };
  const onItemChange = (itemId) => {
    const it = group?.items.find((i) => i.id === itemId);
    const v = it?.variants?.[0];
    onChange({ ...line, itemId, variantId: v?.id || "" });
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

      {hasVariants ? (
        <>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Style</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {item.variants.map((v) => (
              <button key={v.id} onClick={() => onChange({ ...line, variantId: v.id })} className="om-btn"
                style={{ ...qtyPreset, ...(line.variantId === v.id ? qtyPresetActive : {}) }}>{v.label} — {money(v.price)}</button>
            ))}
          </div>
        </>
      ) : (
        <div style={{ marginTop: 10, fontSize: 13, color: C.muted }}>Price: <span style={{ color: C.moss, fontWeight: 600 }}>{money(item?.variants[0]?.price)}</span></div>
      )}

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

function NewOrderTab({ menu, onCreate }) {
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const makeLine = () => {
    const g = menu[0]; const it = firstItem(g); const v = firstVariant(it);
    return { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1 };
  };
  const [lines, setLines] = useState(menu.length ? [makeLine()] : []);
  useEffect(() => { if (menu.length && lines.length === 0) setLines([makeLine()]); }, [menu]);

  const getVariant = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId)?.variants.find((v) => v.id === l.variantId);
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => setLines([...lines, makeLine()]);
  const lineTotal = (l) => (getVariant(l)?.price || 0) * (Number(l.qty) || 0);
  const orderTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  const submit = async () => {
    if (!customer.trim()) { setError("Customer name is required."); return; }
    const items = lines.filter((l) => l.groupId && l.itemId && l.variantId && Number(l.qty) > 0).map((l) => {
      const it = menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
      const v = getVariant(l);
      return { name: it?.name || "Item", variantLabel: v?.label || "", price: v?.price || 0, qty: Number(l.qty) };
    });
    if (items.length === 0) { setError("Add at least one item with a valid quantity."); return; }
    setError("");
    setSubmitting(true);
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const res = await onCreate({ id: uid(), customer: customer.trim(), items, total, paid: false, ts: Date.now() });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    setCustomer(""); setLines([makeLine()]);
  };

  return (
    <div>
      <div style={card}>
        <div style={cardTitle}>New order</div>
        {menu.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 14 }}>Add categories and items in Setup first.</div>
        ) : (
          <>
            <label style={fieldLabel}>Customer name</label>
            <input className="om-input" style={input} placeholder="e.g. Ramesh" value={customer} onChange={(e) => { setCustomer(e.target.value); setError(""); }} />
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {lines.map((l) => (
                <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
              ))}
            </div>
            <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
            <ErrorText>{error}</ErrorText>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={fieldLabel}>Order total</div>
                <div style={{ ...displayNum, fontSize: 22, color: C.moss }}>{money(orderTotal)}</div>
              </div>
              <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, width: "auto", marginTop: 0, opacity: submitting ? 0.7 : 1 }} className="om-btn">
                {submitting ? <Loader2 className="om-spin" size={15} /> : <Plus size={15} />} {submitting ? "Saving..." : "Save order"}
              </button>
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
        return { id: uid(), groupId: g.id, itemId: item.id, variantId: variant?.id || "", qty: it.qty };
      }
    }
    const g = menu[0]; const item = firstItem(g); const v = firstVariant(item);
    return { id: uid(), groupId: g?.id || "", itemId: item?.id || "", variantId: v?.id || "", qty: it.qty };
  });
}

function OrderEditForm({ order, menu, partners, onSave, onCancel }) {
  const [customer, setCustomer] = useState(order.customer);
  const [lines, setLines] = useState(orderToLines(order, menu));
  const [collectedBy, setCollectedBy] = useState(order.collectedBy || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const getVariant = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId)?.variants.find((v) => v.id === l.variantId);
  const lineTotal = (l) => (getVariant(l)?.price || 0) * (Number(l.qty) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => {
    const g = menu[0]; const it = firstItem(g); const v = firstVariant(it);
    setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1 }]);
  };
  const save = async () => {
    if (!customer.trim()) { setError("Customer name is required."); return; }
    const items = lines.filter((l) => l.groupId && l.itemId && l.variantId && Number(l.qty) > 0).map((l) => {
      const item = menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
      const v = getVariant(l);
      return { name: item?.name || "Item", variantLabel: v?.label || "", price: v?.price || 0, qty: Number(l.qty) };
    });
    if (items.length === 0) { setError("Add at least one item with a valid quantity."); return; }
    setError("");
    setSubmitting(true);
    const res = await onSave({ ...order, customer: customer.trim(), items, total: items.reduce((s, i) => s + i.price * i.qty, 0), collectedBy: order.paid ? collectedBy : "" });
    setSubmitting(false);
    if (res && !res.ok) setError(res.error);
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing order</div>
      <label style={fieldLabel}>Customer name</label>
      <input className="om-input" style={input} value={customer} onChange={(e) => { setCustomer(e.target.value); setError(""); }} />
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
      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
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
  );
}

function CollectorPicker({ order, partners, onConfirm, onCancel }) {
  const [collectedBy, setCollectedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
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

function OrderHistoryTab({ menu, orders, partners, onTogglePaid, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [pickingCollectorId, setPickingCollectorId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [returningId, setReturningId] = useState(null);

  const markUnpaid = async (id) => {
    setTogglingId(id);
    await onTogglePaid(id);
    setTogglingId(null);
  };

  const returnToShared = async (order) => {
    setReturningId(order.id);
    await onUpdate({ ...order, collectedBy: "" });
    setReturningId(null);
  };

  const partnerName = (id) => partners.find((p) => p.id === id)?.name;

  return (
    <div>
      <div style={safetyNote}><ShieldCheck size={15} /> Every order is saved to the database and synced to Google Sheets as a backup — nothing is lost.</div>
      <div style={{ ...sectionTitle, marginTop: 18 }}>{orders.length} order{orders.length === 1 ? "" : "s"} recorded</div>
      {orders.length === 0 ? (
        <div style={emptyState}>No orders yet — add one from the New order tab.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) =>
            editingId === o.id ? (
              <OrderEditForm key={o.id} order={o} menu={menu} partners={partners}
                onSave={async (updated) => { const res = await onUpdate(updated); if (res.ok) setEditingId(null); return res; }}
                onCancel={() => setEditingId(null)} />
            ) : pickingCollectorId === o.id ? (
              <CollectorPicker key={o.id} order={o} partners={partners}
                onConfirm={async (collectedBy) => { await onTogglePaid(o.id, collectedBy); setPickingCollectorId(null); }}
                onCancel={() => setPickingCollectorId(null)} />
            ) : (
              <div key={o.id} style={{ ...rowCard, borderLeft: `3px solid ${o.paid ? C.success : C.warning}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{o.customer}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                    {o.items.map((i) => `${i.qty}× ${i.name}${i.variantLabel ? " (" + i.variantLabel + ")" : ""}`).join(", ")}
                  </div>
                  {o.paid && o.collectedBy && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: C.ember }}>Collected by {partnerName(o.collectedBy) || "Unknown"}</span>
                      <button onClick={() => returnToShared(o)} disabled={returningId === o.id} className="om-btn"
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${C.ember}`, background: "transparent", color: C.ember, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                        {returningId === o.id ? <Loader2 className="om-spin" size={11} /> : null} Mark as returned to shared account
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ ...displayNum, fontSize: 15, marginRight: 14 }}>{money(o.total)}</div>
                <button
                  onClick={() => (o.paid ? markUnpaid(o.id) : setPickingCollectorId(o.id))}
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

function GroupCard({ group, onAddItem, onRemoveItem, onRemoveGroup }) {
  const [itemName, setItemName] = useState("");
  const [variantRows, setVariantRows] = useState([{ id: uid(), label: "", price: "" }]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const addVariantRow = () => setVariantRows([...variantRows, { id: uid(), label: "", price: "" }]);
  const updateVariantRow = (id, patch) => setVariantRows(variantRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeVariantRow = (id) => setVariantRows(variantRows.filter((r) => r.id !== id));

  const submitItem = async () => {
    if (!itemName.trim()) { setError("Item name is required."); return; }
    const variants = variantRows.filter((r) => r.price !== "" && Number(r.price) > 0).map((r) => ({ id: uid(), label: r.label.trim(), price: Number(r.price) }));
    if (variants.length === 0) { setError("At least one price is required."); return; }
    setError("");
    setSubmitting(true);
    const res = await onAddItem({ id: uid(), name: itemName.trim(), variants });
    setSubmitting(false);
    if (res && !res.ok) { setError(res.error); return; }
    setItemName(""); setVariantRows([{ id: uid(), label: "", price: "" }]);
  };

  return (
    <div style={lineBox}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</div>
        <ConfirmDelete label={`${group.name} category`} onConfirm={onRemoveGroup} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {group.items.map((it) => (
          <div key={it.id} style={rowCard}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{it.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{it.variants.map((v) => `${v.label ? v.label + " " : ""}${money(v.price)}`).join(" · ")}</div>
            </div>
            <ConfirmDelete label={it.name} onConfirm={() => onRemoveItem(it.id)} />
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 12 }}>
        <label style={fieldLabel}>New item name</label>
        <input className="om-input" style={input} placeholder="e.g. Red Sev" value={itemName} onChange={(e) => { setItemName(e.target.value); setError(""); }} />
        <label style={{ ...fieldLabel, marginTop: 10 }}>Price options</label>
        {variantRows.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input className="om-input" style={{ ...input, flex: 1 }} placeholder="Style name (optional, e.g. Regular)" value={r.label} onChange={(e) => updateVariantRow(r.id, { label: e.target.value })} />
            <input type="number" step="0.01" min="0.01" className="om-input" style={{ ...input, width: 100 }} placeholder="$0.00" value={r.price} onChange={(e) => { updateVariantRow(r.id, { price: e.target.value }); setError(""); }} />
            {variantRows.length > 1 && (<button onClick={() => removeVariantRow(r.id)} style={iconBtn} className="om-btn" aria-label="Remove price option"><X size={14} /></button>)}
          </div>
        ))}
        <button onClick={addVariantRow} style={ghostBtn} className="om-btn"><Plus size={13} /> Add another price option</button>
        <ErrorText>{error}</ErrorText>
        <button onClick={submitItem} disabled={submitting} style={{ ...primaryBtn, marginTop: 12, opacity: submitting ? 0.7 : 1 }} className="om-btn">
          {submitting ? <Loader2 className="om-spin" size={14} /> : <Plus size={14} />} {submitting ? "Adding..." : `Add item to ${group.name}`}
        </button>
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

function SettingsTab({ menu, partners, backupData, onAddGroup, onRemoveGroup, onAddItem, onRemoveItem, onRenamePartner }) {
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
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={cardTitle}>Backup your data</div>
          <div style={{ fontSize: 13, color: C.muted }}>Download a copy of everything, in addition to the automatic Google Sheets backup.</div>
        </div>
        <button onClick={() => exportBackup(backupData)} style={{ ...primaryBtn, width: "auto", marginTop: 0 }} className="om-btn"><Download size={15} /> Download backup</button>
      </div>
      <div style={{ ...cardTitle, marginTop: 24 }}>Menu categories</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {menu.map((g) => (
          <GroupCard key={g.id} group={g}
            onAddItem={(item) => onAddItem(g.id, item)}
            onRemoveItem={(iid) => onRemoveItem(g.id, iid)}
            onRemoveGroup={() => onRemoveGroup(g.id)} />
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
const gateCard = { maxWidth: 360, margin: "3rem auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "30px 26px", boxShadow: "0 1px 2px rgba(35,41,31,0.05), 0 8px 24px rgba(35,41,31,0.06)" };
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 1px 2px rgba(35,41,31,0.04), 0 4px 12px rgba(35,41,31,0.03)" };
const lineBox = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, background: "#FDFBF6" };
const cardTitle = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, marginBottom: 14, color: C.ink };
const sectionTitle = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 };
const rowCard = { display: "flex", alignItems: "center", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", boxShadow: "0 1px 2px rgba(35,41,31,0.03)" };
const emptyState = { color: C.muted, fontSize: 14, padding: "18px 0", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 12 };
const safetyNote = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.moss, background: C.mossTint, border: `1px solid ${C.moss}22`, borderRadius: 10, padding: "10px 12px" };
const fieldLabel = { display: "block", fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontSize: 14, transition: "border-color .15s, box-shadow .15s" };
const primaryBtn = { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", width: "100%", marginTop: 16, padding: "11px 18px", borderRadius: 10, border: "none", background: C.moss, color: "#FAF6EE", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 12px", borderRadius: 10, border: `1px dashed ${C.ember}`, background: "transparent", color: C.ember, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const iconBtn = { display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.muted, cursor: "pointer", flexShrink: 0 };
const pill = { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 999, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 10 };
const qtyPreset = { padding: "6px 13px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const qtyPresetActive = { background: C.mossTint, borderColor: C.moss, color: C.mossDark, fontWeight: 700 };
const stepBtn = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 16, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const tabRow = { display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 12 };
const tabBtn = { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500 };
const statCard = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", textAlign: "left", boxShadow: "0 1px 2px rgba(35,41,31,0.03)" };
const statLabel = { fontSize: 12, color: C.muted, marginBottom: 5, fontWeight: 500 };
const statValue = { fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600 };
