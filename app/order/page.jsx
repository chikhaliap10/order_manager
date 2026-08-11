"use client";
import React, { useState, useEffect } from "react";
import { Plus, X, Loader2, Check, ChevronDown } from "lucide-react";

const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);

const C = {
  ink: "#F0EDE6", paper: "#121412", card: "#1C1F1B",
  moss: "#43966B", mossTint: "rgba(67,150,107,0.18)",
  ember: "#F0A868", border: "#2C302A", muted: "#9BA39A",
};

function firstItem(group) { return group?.items?.[0]; }
function firstVariant(item) { return item?.variants?.[0]; }
const STYLE_OPTIONS = ["Regular", "Crunchy"];

function basePriceAt(item, style) { return style === "Crunchy" ? Number(item.basePriceCrunchy) : Number(item.basePriceRegular); }
function defaultSevOptionId(item) {
  const found = (item.sevOptions || []).find((s) => s.defaultChecked);
  return found ? found.id : (item.sevOptions || [])[0]?.id;
}
function computeAddOnLinePrice(item, style, sevOptionId, selectedAddOnIds) {
  const base = basePriceAt(item, style);
  const sevOption = (item.sevOptions || []).find((s) => s.id === sevOptionId);
  const sevExtra = sevOption ? Number(sevOption.extra) : 0;
  const addOnsExtra = (item.addOns || []).filter((a) => selectedAddOnIds.includes(a.id)).reduce((s, a) => s + Number(a.extra), 0);
  return base + sevExtra + addOnsExtra;
}

function OrderLine({ line, menu, onChange, onRemove, removable }) {
  const group = menu.find((g) => g.id === line.groupId);
  const item = group?.items.find((i) => i.id === line.itemId);
  const isAddOnItem = Boolean(item?.addOnMode);
  const hasVariants = !isAddOnItem && item && item.variants.length > 1;
  const variant = !isAddOnItem ? item?.variants.find((v) => v.id === line.variantId) : null;
  const total = isAddOnItem
    ? computeAddOnLinePrice(item, line.style || "Regular", line.sevOptionId, line.selectedAddOnIds || []) * (Number(line.qty) || 0)
    : (variant?.price || 0) * (Number(line.qty) || 0);

  const onGroupChange = (groupId) => {
    const g = menu.find((mg) => mg.id === groupId);
    const it = g?.items?.[0];
    if (it?.addOnMode) {
      onChange({ ...line, groupId, itemId: it.id, style: "Regular", sevOptionId: defaultSevOptionId(it), selectedAddOnIds: [], variantId: undefined });
    } else {
      const v = it?.variants?.[0];
      onChange({ ...line, groupId, itemId: it?.id || "", variantId: v?.id || "", style: undefined, sevOptionId: undefined, selectedAddOnIds: undefined });
    }
  };
  const onItemChange = (itemId) => {
    const it = group?.items.find((i) => i.id === itemId);
    if (it?.addOnMode) {
      onChange({ ...line, itemId, style: "Regular", sevOptionId: defaultSevOptionId(it), selectedAddOnIds: [], variantId: undefined });
    } else {
      const v = it?.variants?.[0];
      onChange({ ...line, itemId, variantId: v?.id || "", style: undefined, sevOptionId: undefined, selectedAddOnIds: undefined });
    }
  };
  const toggleAddOn = (addOnId) => {
    const current = line.selectedAddOnIds || [];
    const next = current.includes(addOnId) ? current.filter((id) => id !== addOnId) : [...current, addOnId];
    onChange({ ...line, selectedAddOnIds: next });
  };

  return (
    <div style={lineBox}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <label style={fieldLabel}>Category</label>
        {removable && <button onClick={onRemove} style={iconBtn} aria-label="Remove"><X size={15} /></button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {menu.map((g) => (
          <button key={g.id} onClick={() => onGroupChange(g.id)} style={{ ...pill, ...(line.groupId === g.id ? pillActive : {}) }}>{g.name}</button>
        ))}
      </div>
      <label style={{ ...fieldLabel, marginTop: 12 }}>Item</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {group?.items.map((i) => (
          <button key={i.id} onClick={() => onItemChange(i.id)} style={{ ...pill, ...(line.itemId === i.id ? pillActive : {}) }}>{i.name}</button>
        ))}
      </div>

      {isAddOnItem ? (
        <>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Style</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {STYLE_OPTIONS.map((s) => (
              <button key={s} onClick={() => onChange({ ...line, style: s })} style={{ ...pill, ...((line.style || "Regular") === s ? pillActive : {}) }}>
                {s} — {money(basePriceAt(item, s))}
              </button>
            ))}
          </div>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Sev</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {(item.sevOptions || []).map((s) => (
              <button key={s.id} onClick={() => onChange({ ...line, sevOptionId: s.id })}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", borderRadius: 8, textAlign: "left",
                  border: `1px solid ${line.sevOptionId === s.id ? C.moss : C.border}`, background: line.sevOptionId === s.id ? C.mossTint : C.card,
                  color: line.sevOptionId === s.id ? "#8FE0B3" : C.muted, fontSize: 13, cursor: "pointer",
                }}>
                <span>{s.name}</span>
                <span>{s.extra > 0 ? `+${money(s.extra)}` : "included"}</span>
              </button>
            ))}
          </div>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Add-ons (pick any number)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {(item.addOns || []).map((a) => {
              const checked = (line.selectedAddOnIds || []).includes(a.id);
              return (
                <button key={a.id} onClick={() => toggleAddOn(a.id)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 12px", borderRadius: 8, textAlign: "left",
                    border: `1px solid ${checked ? C.moss : C.border}`, background: checked ? C.mossTint : C.card,
                    color: checked ? "#8FE0B3" : C.muted, fontSize: 13, cursor: "pointer",
                  }}>
                  <span>{checked ? "✓ " : ""}{a.name}</span>
                  <span>+{money(a.extra)}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : hasVariants && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12 }}>Style</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {item.variants.map((v) => (
              <button key={v.id} onClick={() => onChange({ ...line, variantId: v.id })} style={{ ...pill, ...(line.variantId === v.id ? pillActive : {}) }}>
                {v.label} — {money(v.price)}
              </button>
            ))}
          </div>
        </>
      )}
      {!isAddOnItem && !hasVariants && item && (
        <div style={{ marginTop: 10, fontSize: 13, color: C.muted }}>Price: <span style={{ color: C.moss, fontWeight: 600 }}>{money(item.variants[0]?.price)}</span></div>
      )}

      <label style={{ ...fieldLabel, marginTop: 12 }}>Quantity</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        {[1, 2, 3, 4, 5, 10].map((n) => (
          <button key={n} onClick={() => onChange({ ...line, qty: n })} style={{ ...pill, ...(Number(line.qty) === n ? pillActive : {}) }}>{n}</button>
        ))}
        <button onClick={() => onChange({ ...line, qty: Math.max(1, Number(line.qty || 1) - 1) })} style={stepBtn}>−</button>
        <input type="number" min="1" style={{ ...input, width: 60, textAlign: "center", marginTop: 0 }}
          value={line.qty} onChange={(e) => onChange({ ...line, qty: e.target.value })} />
        <button onClick={() => onChange({ ...line, qty: Number(line.qty || 0) + 1 })} style={stepBtn}>+</button>
        <div style={{ marginLeft: "auto", fontWeight: 700, color: C.moss }}>{money(total)}</div>
      </div>
    </div>
  );
}

function PriceList({ menu }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "transparent", border: `1px dashed ${C.ember}`, borderRadius: 10, padding: "10px 14px",
        fontSize: 13, color: C.ember, cursor: "pointer",
      }}>
        <span>See full price list</span>
        <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div style={{ marginTop: 10, background: C.card, borderRadius: 10, padding: "12px 14px" }}>
          {menu.map((g) => (
            <div key={g.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{g.name}</div>
              {g.items.map((it) => (
                <div key={it.id} style={{ marginBottom: 6 }}>
                  {it.addOnMode ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "2px 0" }}>
                        <span>Base (Regular / Crunchy)</span><span>{money(it.basePriceRegular)} / {money(it.basePriceCrunchy)}</span>
                      </div>
                      {(it.sevOptions || []).filter((s) => s.extra > 0).map((s) => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "2px 0" }}>
                          <span>{s.name}</span><span>+{money(s.extra)}</span>
                        </div>
                      ))}
                      {(it.addOns || []).map((a) => (
                        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "2px 0" }}>
                          <span>{a.name}</span><span>+{money(a.extra)}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    (it.variants || []).map((v) => (
                      <div key={v.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "2px 0" }}>
                        <span>{it.name}{v.label ? ` (${v.label})` : ""}</span><span>{money(v.price)}</span>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PublicOrderPage() {
  const [menu, setMenu] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [customer, setCustomer] = useState("");
  const [website, setWebsite] = useState("");
  const [lines, setLines] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const savedName = typeof window !== "undefined" ? localStorage.getItem("surti_customer_name") : "";
    if (savedName) setCustomer(savedName);

    fetch("/api/public-menu")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setLoadError(data.error); return; }
        setMenu(data.menu);
        const g = data.menu[0]; const it = firstItem(g);
        if (g) {
          if (it?.addOnMode) {
            setLines([{ id: uid(), groupId: g.id, itemId: it.id, style: "Regular", sevOptionId: defaultSevOptionId(it), selectedAddOnIds: [], qty: 1 }]);
          } else {
            const v = firstVariant(it);
            setLines([{ id: uid(), groupId: g.id, itemId: it?.id || "", variantId: v?.id || "", qty: 1 }]);
          }
        }
      })
      .catch(() => setLoadError("Could not load the menu. Please check your connection and try again."));
  }, []);

  const updateLine = (updated) => setLines(lines.map((l) => (l.id === updated.id ? updated : l)));
  const removeLine = (id) => setLines(lines.filter((l) => l.id !== id));
  const getItemFor = (l) => menu?.find((g) => g.id === l.groupId)?.items.find((i) => i.id === l.itemId);
  const addLine = () => {
    const g = menu[0]; const it = firstItem(g);
    if (it?.addOnMode) {
      setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", style: "Regular", sevOptionId: defaultSevOptionId(it), selectedAddOnIds: [], qty: 1 }]);
      return;
    }
    const v = firstVariant(it);
    setLines([...lines, { id: uid(), groupId: g?.id || "", itemId: it?.id || "", variantId: v?.id || "", qty: 1 }]);
  };

  const getVariant = (l) => getItemFor(l)?.variants?.find((v) => v.id === l.variantId);
  const total = lines.reduce((s, l) => {
    const it = getItemFor(l);
    const price = it?.addOnMode ? computeAddOnLinePrice(it, l.style || "Regular", l.sevOptionId, l.selectedAddOnIds || []) : (getVariant(l)?.price || 0);
    return s + price * (Number(l.qty) || 0);
  }, 0);

  const submit = async () => {
    if (!customer.trim()) { setError("Please enter your name."); return; }
    const items = lines
      .filter((l) => {
        const it = getItemFor(l);
        if (!l.groupId || !l.itemId || !(Number(l.qty) > 0)) return false;
        if (it?.addOnMode) return true;
        return Boolean(l.variantId);
      })
      .map((l) => {
        const it = getItemFor(l);
        if (it?.addOnMode) {
          return { groupId: l.groupId, itemId: l.itemId, style: l.style || "Regular", sevOptionId: l.sevOptionId, addOnIds: l.selectedAddOnIds || [], qty: Number(l.qty) };
        }
        return { groupId: l.groupId, itemId: l.itemId, variantId: l.variantId, qty: Number(l.qty) };
      });
    if (items.length === 0) { setError("Please add at least one item."); return; }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/public-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: customer.trim(), items, website }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setSubmitting(false); return; }
      if (typeof window !== "undefined") localStorage.setItem("surti_customer_name", customer.trim());
      setSubmitted(true);
    } catch {
      setError("Something went wrong submitting your order. Please try again.");
    }
    setSubmitting(false);
  };

  if (loadError) {
    return (
      <div style={wrap}>
        <div style={{ ...card, marginTop: 40, textAlign: "center" }}>
          <div style={{ color: "#F0796B", fontWeight: 600, marginBottom: 8 }}>Couldn't load the menu</div>
          <div style={{ color: C.muted, fontSize: 14 }}>{loadError}</div>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div style={wrap}>
        <div style={{ display: "flex", justifyContent: "center", padding: "5rem 0", color: C.muted }}>
          <Loader2 className="om-spin" size={24} />
        </div>
        <style>{`.om-spin{animation:omSpin 1s linear infinite}@keyframes omSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&display=swap');
        *{font-family:'Inter',sans-serif;box-sizing:border-box}
        .om-spin{animation:omSpin 1s linear infinite}
        @keyframes omSpin{to{transform:rotate(360deg)}}
        input:focus{outline:none;border-color:${C.ember} !important}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <img src="/logo.png" alt="Gully Gourmet logo" style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Gully Gourmet</h1
          ><div style={{ fontSize: 12, color: C.muted }}>Surti Aloopuri — place your order below</div>
        </div>
      </div>

      {submitted ? (
        <div style={{ ...card, textAlign: "center", padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.mossTint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Check size={26} color={C.moss} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Thanks for your order, {customer}!</div>
          <div style={{ fontSize: 14, color: C.muted }}>We've got it — pay when you pick up.</div>
        </div>
      ) : (
        <div style={card}>
          <label style={fieldLabel}>Your name</label>
          <input style={input} placeholder="e.g. Ramesh" value={customer} onChange={(e) => { setCustomer(e.target.value); setError(""); }} />

          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="website">Leave this field empty</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"
              value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {lines.map((l) => (
              <OrderLine key={l.id} line={l} menu={menu} onChange={updateLine} onRemove={() => removeLine(l.id)} removable={lines.length > 1} />
            ))}
          </div>
          <button onClick={addLine} style={ghostBtn}><Plus size={14} /> Add another item</button>

          {error && <div style={{ color: "#F0796B", fontSize: 13, marginTop: 10 }}>{error}</div>}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={fieldLabel}>Total</div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: C.moss }}>{money(total)}</div>
            </div>
            <button onClick={submit} disabled={submitting} style={{ ...primaryBtn, width: "auto", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? <Loader2 className="om-spin" size={16} /> : <Plus size={16} />} {submitting ? "Sending..." : "Send order"}
            </button>
          </div>

          <PriceList menu={menu} />
        </div>
      )}
    </div>
  );
}

const wrap = { maxWidth: 480, margin: "0 auto", padding: "1.25rem 1rem", color: C.ink, background: C.paper, minHeight: "100vh" };
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, position: "relative" };
const lineBox = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, background: "#191C17" };
const fieldLabel = { display: "block", fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 };
const input = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontSize: 14, marginTop: 0 };
const primaryBtn = { display: "flex", alignItems: "center", gap: 6, justifyContent: "center", padding: "11px 18px", borderRadius: 10, border: "none", background: C.moss, color: "#FAF6EE", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 12px", borderRadius: 10, border: `1px dashed ${C.ember}`, background: "transparent", color: C.ember, fontSize: 13, fontWeight: 500, cursor: "pointer" };
const iconBtn = { display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.muted, cursor: "pointer" };
const stepBtn = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
const pill = { padding: "6px 13px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.card, color: C.muted, fontSize: 13, cursor: "pointer" };
const pillActive = { background: C.mossTint, borderColor: C.moss, color: "#8FE0B3", fontWeight: 700 };
