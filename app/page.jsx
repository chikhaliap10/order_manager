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
  return res.json();
}

function ConfirmDelete({ onConfirm, label }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} style={iconBtn} className="om-btn" aria-label={`Delete ${label}`}>
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button onClick={() => { onConfirm(); setConfirming(false); }} style={{ ...iconBtn, background: C.dangerTint, color: C.danger, borderColor: C.danger }} className="om-btn" aria-label="Confirm delete"><Check size={14} /></button>
      <button onClick={() => setConfirming(false)} style={iconBtn} className="om-btn" aria-label="Cancel delete"><X size={14} /></button>
    </div>
  );
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
  const [unlocked, setUnlocked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState("");

  const [menu, setMenu] = useState([]);
  const [partners, setPartners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [tab, setTab] = useState("orders");

  const refresh = async () => {
    const data = await api("/api/state");
    if (data.authed) {
      setUnlocked(true);
      setMenu(data.menu); setPartners(data.partners); setOrders(data.orders);
      setExpenses(data.expenses); setWithdrawals(data.withdrawals);
    } else {
      setUnlocked(false);
      setNeedsSetup(data.needsSetup);
    }
    setReady(true);
  };

  useEffect(() => { refresh(); }, []);

  const handleUnlock = async () => {
    if (passInput.trim().length < 4) { setPassError("Pick a passcode of at least 4 characters"); return; }
    const res = await api("/api/unlock", { method: "POST", body: { passcode: passInput.trim() } });
    if (res.error) { setPassError(res.error); return; }
    setPassError("");
    await refresh();
  };

  const act = async (resource, action, payload) => {
    await api("/api/actions", { method: "POST", body: { resource, action, payload } });
    await refresh();
  };

  const totals = useMemo(() => {
    const income = orders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0);
    const pending = orders.filter((o) => !o.paid).reduce((s, o) => s + o.total, 0);
    const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const netProfit = income - expenseTotal;
    const share = partners.length ? netProfit / partners.length : 0;
    const withdrawnByPartner = {};
    partners.forEach((p) => {
      withdrawnByPartner[p.id] = withdrawals.filter((w) => w.partnerId === p.id).reduce((s, w) => s + Number(w.amount || 0), 0);
    });
    return { income, pending, expenseTotal, netProfit, share, withdrawnByPartner };
  }, [orders, expenses, withdrawals, partners]);

  const GlobalStyle = () => (
    <style>{`
      .om-fade{animation:omFade .18s ease-out}
      @keyframes omFade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
      .om-spin{animation:omSpin 1s linear infinite}
      @keyframes omSpin{to{transform:rotate(360deg)}}
      .om-input:focus{outline:none;border-color:${C.ember} !important;box-shadow:0 0 0 3px ${C.emberTint}}
      .om-btn:hover{filter:brightness(0.96)}
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

  if (!unlocked) {
    return (
      <div style={wrap}><GlobalStyle />
        <div style={gateCard} className="om-fade">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><div style={badge}><ChefHat size={22} /></div></div>
          <h2 style={displayH1}>Order ledger</h2>
          <p style={{ textAlign: "center", color: C.muted, margin: "6px 0 22px", fontSize: 14, lineHeight: 1.5 }}>
            {needsSetup ? "Set a shared passcode — everyone on the team will use this one." : "Enter the shared passcode to continue."}
          </p>
          <label style={fieldLabel}>Passcode</label>
          <input type="password" value={passInput} onChange={(e) => { setPassInput(e.target.value); setPassError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()} placeholder="••••" style={input} className="om-input" autoFocus />
          {passError && <div style={{ color: C.danger, fontSize: 13, marginTop: 8 }}>{passError}</div>}
          <button onClick={handleUnlock} style={primaryBtn} className="om-btn"><Lock size={15} /> {needsSetup ? "Save passcode" : "Unlock"}</button>
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
          <OrderHistoryTab menu={menu} orders={orders}
            onTogglePaid={(id) => act("order", "toggle-paid", { id })}
            onUpdate={(order) => act("order", "update", order)}
            onDelete={(id) => act("order", "delete", { id })} />
        )}
        {tab === "expenses" && (
          <ExpensesTab expenses={expenses}
            onCreate={(e) => act("expense", "create", e)}
            onDelete={(id) => act("expense", "delete", { id })} />
        )}
        {tab === "partners" && (
          <PartnersTab partners={partners} totals={totals} withdrawals={withdrawals}
            onCreate={(w) => act("withdrawal", "create", w)}
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

  const submit = () => {
    if (!customer.trim() || menu.length === 0) return;
    const items = lines.filter((l) => l.groupId && l.itemId && l.variantId && Number(l.qty) > 0).map((l) => {
      const it = menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
      const v = getVariant(l);
      return { name: it?.name || "Item", variantLabel: v?.label || "", price: v?.price || 0, qty: Number(l.qty) };
    });
    if (items.length === 0) return;
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    onCreate({ id: uid(), customer: customer.trim(), items, total, paid: false, ts: Date.now() });
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
            <input className="om-input" style={input} placeholder="e.g. Ramesh" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              {lines.map((l) => (
                <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
              ))}
            </div>
            <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={fieldLabel}>Order total</div>
                <div style={{ ...displayNum, fontSize: 22, color: C.moss }}>{money(orderTotal)}</div>
              </div>
              <button onClick={submit} style={{ ...primaryBtn, width: "auto", marginTop: 0 }} className="om-btn"><Plus size={15} /> Save order</button>
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

function OrderEditForm({ order, menu, onSave, onCancel }) {
  const [customer, setCustomer] = useState(order.customer);
  const [lines, setLines] = useState(orderToLines(order, menu));
  const getVariant = (l) => menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId)?.variants.find((v) => v.id === l.variantId);
  const lineTotal = (l) => (getVariant(l)?.price || 0) * (Number(l.qty) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const addLine = () => {
    const g = menu[0]; const it = firstItem(g); const v = firstVariant(it);
    setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1 }]);
  };
  const save = () => {
    if (!customer.trim()) return;
    const items = lines.filter((l) => l.groupId && l.itemId && l.variantId && Number(l.qty) > 0).map((l) => {
      const item = menu.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
      const v = getVariant(l);
      return { name: item?.name || "Item", variantLabel: v?.label || "", price: v?.price || 0, qty: Number(l.qty) };
    });
    if (items.length === 0) return;
    onSave({ ...order, customer: customer.trim(), items, total: items.reduce((s, i) => s + i.price * i.qty, 0) });
  };

  return (
    <div style={{ ...card, borderColor: C.ember }}>
      <div style={cardTitle}>Editing order</div>
      <label style={fieldLabel}>Customer name</label>
      <input className="om-input" style={input} value={customer} onChange={(e) => setCustomer(e.target.value)} />
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {lines.map((l) => (
          <OrderLineRow key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
        ))}
      </div>
      <button onClick={addLine} style={ghostBtn} className="om-btn"><Plus size={14} /> Add another item</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <div>
          <div style={fieldLabel}>New total</div>
          <div style={{ ...displayNum, fontSize: 22, color: C.moss }}>{money(total)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ ...ghostBtn, marginTop: 0, borderColor: C.border, color: C.muted }} className="om-btn">Cancel</button>
          <button onClick={save} style={{ ...primaryBtn, width: "auto", marginTop: 0 }} className="om-btn"><Check size={15} /> Save changes</button>
        </div>
      </div>
    </div>
  );
}

function OrderHistoryTab({ menu, orders, onTogglePaid, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  return (
    <div>
      <div style={safetyNote}><ShieldCheck size={15} /> Every order is saved to the database and logged to Google Sheets as a backup — nothing is lost.</div>
      <div style={{ ...sectionTitle, marginTop: 18 }}>{orders.length} order{orders.length === 1 ? "" : "s"} recorded</div>
      {orders.length === 0 ? (
        <div style={emptyState}>No orders yet — add one from the New order tab.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) =>
            editingId === o.id ? (
              <OrderEditForm key={o.id} order={o} menu={menu}
                onSave={(updated) => { onUpdate(updated); setEditingId(null); }}
                onCancel={() => setEditingId(null)} />
            ) : (
              <div key={o.id} style={{ ...rowCard, borderLeft: `3px solid ${o.paid ? C.success : C.warning}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{o.customer}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                    {o.items.map((i) => `${i.qty}× ${i.name}${i.variantLabel ? " (" + i.variantLabel + ")" : ""}`).join(", ")}
                  </div>
                </div>
                <div style={{ ...displayNum, fontSize: 15, marginRight: 14 }}>{money(o.total)}</div>
                <button onClick={() => onTogglePaid(o.id)} className="om-btn"
                  style={{ ...pill, background: o.paid ? C.successTint : C.warningTint, color: o.paid ? C.success : C.warning }}>
                  {o.paid ? <Check size={13} /> : null} {o.paid ? "Paid" : "Unpaid"}
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

function ExpensesTab({ expenses, onCreate, onDelete }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Ingredients");
  const [note, setNote] = useState("");
  const submit = () => {
    if (!amount || Number(amount) <= 0) return;
    onCreate({ id: uid(), amount: Number(amount), category, note, ts: Date.now() });
    setAmount(""); setNote("");
  };
  return (
    <div>
      <div style={card}>
        <div style={cardTitle}>Log an expense</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={fieldLabel}>Category</label>
            <select className="om-input" style={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              {["Ingredients", "Rent", "Staff", "Gas/fuel", "Packaging", "Misc"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label style={fieldLabel}>Amount</label>
            <input type="number" step="0.01" className="om-input" style={input} placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
        <input className="om-input" style={input} placeholder="e.g. Sunday market veggie run" value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={submit} style={primaryBtn} className="om-btn"><Plus size={15} /> Add expense</button>
      </div>
      <div style={{ ...sectionTitle, marginTop: 26 }}>All expenses</div>
      {expenses.length === 0 ? (
        <div style={emptyState}>No expenses logged yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {expenses.map((e) => (
            <div key={e.id} style={{ ...rowCard, borderLeft: `3px solid ${C.danger}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{e.category}</div>
                {e.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{e.note}</div>}
              </div>
              <div style={{ ...displayNum, fontSize: 15, marginRight: 14, color: C.danger }}>-{money(e.amount)}</div>
              <ConfirmDelete label="expense" onConfirm={() => onDelete(e.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PartnersTab({ partners, totals, withdrawals, onCreate, onDelete }) {
  const [partnerId, setPartnerId] = useState(partners[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (!partnerId && partners[0]) setPartnerId(partners[0].id); }, [partners]);
  const submit = () => {
    if (!partnerId || !amount || Number(amount) <= 0) return;
    onCreate({ id: uid(), partnerId, amount: Number(amount), note, ts: Date.now() });
    setAmount(""); setNote("");
  };
  return (
    <div>
      <div style={sectionTitle}>Live balance per partner</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 12, marginBottom: 26 }}>
        {partners.map((p) => {
          const withdrawn = totals.withdrawnByPartner[p.id] || 0;
          const balance = totals.share - withdrawn;
          return (
            <div key={p.id} style={{ ...statCard, borderTop: `3px solid ${C.ember}`, textAlign: "left" }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{p.name}</div>
              <div style={statLabel}>Lifetime share</div>
              <div style={{ ...displayNum, fontSize: 16, marginBottom: 8 }}>{money(totals.share)}</div>
              <div style={statLabel}>Withdrawn</div>
              <div style={{ ...displayNum, fontSize: 16, marginBottom: 8 }}>{money(withdrawn)}</div>
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
            <select className="om-input" style={input} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label style={fieldLabel}>Amount</label>
            <input type="number" step="0.01" className="om-input" style={input} placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <label style={{ ...fieldLabel, marginTop: 12 }}>Note (optional)</label>
        <input className="om-input" style={input} placeholder="e.g. Rent for June" value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={submit} style={primaryBtn} className="om-btn"><Plus size={15} /> Add withdrawal</button>
      </div>
      <div style={{ ...sectionTitle, marginTop: 26 }}>Withdrawal history</div>
      {withdrawals.length === 0 ? (
        <div style={emptyState}>No withdrawals yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {withdrawals.map((w) => (
            <div key={w.id} style={{ ...rowCard, borderLeft: `3px solid ${C.ember}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{partners.find((p) => p.id === w.partnerId)?.name || "Unknown"}</div>
                {w.note && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{w.note}</div>}
              </div>
              <div style={{ ...displayNum, fontSize: 15, marginRight: 14 }}>{money(w.amount)}</div>
              <ConfirmDelete label="withdrawal" onConfirm={() => onDelete(w.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({ group, onAddItem, onRemoveItem, onRemoveGroup }) {
  const [itemName, setItemName] = useState("");
  const [variantRows, setVariantRows] = useState([{ id: uid(), label: "", price: "" }]);
  const addVariantRow = () => setVariantRows([...variantRows, { id: uid(), label: "", price: "" }]);
  const updateVariantRow = (id, patch) => setVariantRows(variantRows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeVariantRow = (id) => setVariantRows(variantRows.filter((r) => r.id !== id));
  const submitItem = () => {
    if (!itemName.trim()) return;
    const variants = variantRows.filter((r) => r.price !== "" && Number(r.price) > 0).map((r) => ({ id: uid(), label: r.label.trim(), price: Number(r.price) }));
    if (variants.length === 0) return;
    onAddItem({ id: uid(), name: itemName.trim(), variants });
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
        <input className="om-input" style={input} placeholder="e.g. Red Sev" value={itemName} onChange={(e) => setItemName(e.target.value)} />
        <label style={{ ...fieldLabel, marginTop: 10 }}>Price options</label>
        {variantRows.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input className="om-input" style={{ ...input, flex: 1 }} placeholder="Style name (optional, e.g. Regular)" value={r.label} onChange={(e) => updateVariantRow(r.id, { label: e.target.value })} />
            <input type="number" step="0.01" className="om-input" style={{ ...input, width: 100 }} placeholder="$0.00" value={r.price} onChange={(e) => updateVariantRow(r.id, { price: e.target.value })} />
            {variantRows.length > 1 && (<button onClick={() => removeVariantRow(r.id)} style={iconBtn} className="om-btn" aria-label="Remove price option"><X size={14} /></button>)}
          </div>
        ))}
        <button onClick={addVariantRow} style={ghostBtn} className="om-btn"><Plus size={13} /> Add another price option</button>
        <button onClick={submitItem} style={{ ...primaryBtn, marginTop: 12 }} className="om-btn"><Plus size={14} /> Add item to {group.name}</button>
      </div>
    </div>
  );
}

function SettingsTab({ menu, partners, backupData, onAddGroup, onRemoveGroup, onAddItem, onRemoveItem, onRenamePartner }) {
  const [groupName, setGroupName] = useState("");
  const addGroup = () => { if (!groupName.trim()) return; onAddGroup(groupName.trim()); setGroupName(""); };
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
          <input className="om-input" style={{ ...input, flex: 1 }} placeholder="e.g. Surti Aloopuri" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <button onClick={addGroup} style={{ ...iconBtn, height: 38 }} className="om-btn" aria-label="Add category"><Plus size={16} /></button>
        </div>
      </div>
      <div style={{ ...card, marginTop: 20 }}>
        <div style={cardTitle}>Partner names</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {partners.map((p, i) => (
            <div key={p.id}>
              <label style={fieldLabel}>Partner {i + 1}</label>
              <input className="om-input" style={input} value={p.name} onChange={(e) => onRenamePartner(p.id, e.target.value)} />
            </div>
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
