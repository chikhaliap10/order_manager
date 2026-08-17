import { getKey, setKey, getOrInitMenu, getOrInitPartners } from "../../../lib/kv";
import { isAuthed } from "../../../lib/auth";
import { uid, defaultMenu } from "../../../lib/defaults";

export const dynamic = "force-dynamic";

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

function badRequest(message) {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(req) {
  try {
    if (!(await isAuthed())) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const { resource, action, payload } = await req.json();

    // ---------- ORDERS ----------
    if (resource === "order") {
      if (action === "create" || action === "update") {
        if (!payload?.customer?.trim()) return badRequest("Customer name is required.");
        if (!Array.isArray(payload.items) || payload.items.length === 0) return badRequest("At least one item is required.");
        if (payload.tip !== undefined && Number(payload.tip) < 0) return badRequest("Tip cannot be negative.");
        if (payload.creditApplied !== undefined && Number(payload.creditApplied) < 0) return badRequest("Applied credit cannot be negative.");
        if (payload.items.some((i) => !(Number(i.price) > 0))) return badRequest("Each item's price must be greater than 0.");
        if (payload.phone) {
          const digits = String(payload.phone).replace(/[^\d]/g, "");
          if (digits.length < 10 || digits.length > 15) return badRequest("Enter a valid phone number.");
        }
      }

      let orders = await getKey("orders", []);

      if (action === "create") {
        orders = [payload, ...orders];
      } else if (action === "update") {
        orders = orders.map((o) => (o.id === payload.id ? payload : o));
      } else if (action === "toggle-paid") {
        orders = orders.map((o) => {
          if (o.id !== payload.id) return o;
          const newPaid = !o.paid;
          // collectedBy is who physically holds the cash for this order --
          // "" means the shared account, a partner id means that partner
          // personally took it. Cleared automatically when marked unpaid,
          // since nobody holds money for an order that hasn't been paid.
          let payments = Array.isArray(o.payments) ? o.payments : [];
          if (newPaid) {
            // If partial payments were already recorded against this order,
            // only log a top-up for whatever's left -- so the payments
            // ledger always sums to the order total once it's marked paid,
            // without double-counting money already logged.
            const alreadyPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const shortfall = Number(o.total || 0) - alreadyPaid;
            if (shortfall > 0.001) {
              payments = [...payments, { id: uid(), method: o.paymentMethod || "Cash", amount: shortfall, ts: Date.now() }];
            }
          }
          // Marking back to unpaid intentionally leaves the payments ledger
          // alone -- it's an audit trail of money actually received, not
          // something that should be erased by flipping a status flag.
          return { ...o, paid: newPaid, payments, collectedBy: newPaid ? (payload.collectedBy || "") : "" };
        });
      } else if (action === "add-payment") {
        if (!Array.isArray(payload.payments) || payload.payments.length === 0) return badRequest("At least one payment is required.");
        if (payload.payments.some((p) => !(Number(p.amount) > 0))) return badRequest("Each payment amount must be greater than 0.");
        if (payload.payments.some((p) => !p.method)) return badRequest("Each payment needs a method.");
        const order = orders.find((o) => o.id === payload.id);
        if (!order) return badRequest("Order not found.");
        orders = orders.map((o) => {
          if (o.id !== payload.id) return o;
          const existing = Array.isArray(o.payments) ? o.payments : [];
          const added = payload.payments.map((p) => ({ id: uid(), method: p.method, amount: Number(p.amount), collectedBy: p.method === "Cash" ? (p.collectedBy || "") : "", ts: Date.now() }));
          const payments = [...existing, ...added];
          const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
          // Once the payments logged cover the full order total, the order
          // flips to paid automatically -- staff shouldn't have to also
          // remember a separate "mark paid" click right after logging the
          // payment that closes the gap.
          const paid = o.paid || totalPaid >= Number(o.total || 0) - 0.001;
          return { ...o, payments, paid, collectedBy: paid && !o.paid ? (o.collectedBy || "") : o.collectedBy };
        });
      } else if (action === "delete") {
        orders = orders.filter((o) => o.id !== payload.id);
      }
      await setKey("orders", orders);
      return Response.json({ orders });
    }

    // ---------- EXPENSES ----------
    if (resource === "expense") {
      if (action === "create" || action === "update") {
        if (!payload?.category?.trim()) return badRequest("Category is required.");
        if (!(Number(payload.amount) > 0)) return badRequest("Amount must be greater than 0.");
      }

      let expenses = await getKey("expenses", []);

      if (action === "create") {
        expenses = [payload, ...expenses];
      } else if (action === "update") {
        expenses = expenses.map((e) => (e.id === payload.id ? payload : e));
      } else if (action === "delete") {
        expenses = expenses.filter((e) => e.id !== payload.id);
      }
      await setKey("expenses", expenses);
      return Response.json({ expenses });
    }

    // ---------- WITHDRAWALS ----------
    if (resource === "withdrawal") {
      if (action === "create" || action === "update") {
        if (!payload?.partnerId) return badRequest("Partner is required.");
        if (!(Number(payload.amount) > 0)) return badRequest("Amount must be greater than 0.");
      }

      let withdrawals = await getKey("withdrawals", []);
      const partners = await getOrInitPartners();
      const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";

      if (action === "create") {
        withdrawals = [payload, ...withdrawals];
      } else if (action === "update") {
        withdrawals = withdrawals.map((w) => (w.id === payload.id ? payload : w));
      } else if (action === "delete") {
        withdrawals = withdrawals.filter((w) => w.id !== payload.id);
      }
      await setKey("withdrawals", withdrawals);
      return Response.json({ withdrawals });
    }

    // ---------- MENU ----------
    if (resource === "menu") {
      if ((action === "add-group" || action === "rename-group") && !payload?.name?.trim()) return badRequest("Category name is required.");
      if (action === "add-item" || action === "update-item") {
        const item = payload?.item;
        if (!item?.name?.trim()) return badRequest("Item name is required.");
        if (!Array.isArray(item.variants) || item.variants.length === 0 || !item.variants.some((v) => Number(v.price) > 0)) {
          return badRequest("At least one price is required.");
        }
      }

      let menu = await getOrInitMenu();

      if (action === "reset") {
        menu = defaultMenu();
      } else if (action === "add-group") {
        menu = [...menu, { id: uid(), name: payload.name.trim(), items: [] }];
      } else if (action === "rename-group") {
        menu = menu.map((g) => (g.id === payload.groupId ? { ...g, name: payload.name.trim() } : g));
      } else if (action === "remove-group") {
        menu = menu.filter((g) => g.id !== payload.groupId);
      } else if (action === "add-item") {
        menu = menu.map((g) => (g.id === payload.groupId ? { ...g, items: [...g.items, payload.item] } : g));
      } else if (action === "update-item") {
        menu = menu.map((g) => (g.id === payload.groupId ? { ...g, items: g.items.map((i) => (i.id === payload.item.id ? payload.item : i)) } : g));
      } else if (action === "remove-item") {
        menu = menu.map((g) => (g.id === payload.groupId ? { ...g, items: g.items.filter((i) => i.id !== payload.itemId) } : g));
      }
      await setKey("menu", menu);
      return Response.json({ menu });
    }

    // ---------- PARTNERS ----------
    if (resource === "partners") {
      if (action === "rename" && !payload?.name?.trim()) return badRequest("Partner name cannot be empty.");

      let partners = await getOrInitPartners();
      if (action === "rename") {
        partners = partners.map((p) => (p.id === payload.id ? { ...p, name: payload.name.trim() } : p));
      }
      await setKey("partners", partners);
      return Response.json({ partners });
    }

    // ---------- CUSTOMER CREDITS ----------
    // A simple ledger, not folded into income/expense math -- this tracks
    // money the business owes back to a customer (positive amounts) or
    // credit that's been applied to reduce what they owe on a later order
    // (negative amounts). A customer's current balance is just the sum of
    // their entries.
    if (resource === "credits") {
      if (action === "create") {
        if (!payload?.customer?.trim()) return badRequest("Customer name is required.");
        if (typeof payload.amount !== "number" || Number.isNaN(payload.amount)) return badRequest("A valid amount is required.");
        let credits = await getKey("credits", []);
        credits = [{ id: uid(), customer: payload.customer.trim(), amount: payload.amount, note: payload.note || "", ts: Date.now() }, ...credits];
        await setKey("credits", credits);
        return Response.json({ credits });
      } else if (action === "update") {
        if (!payload?.customer?.trim()) return badRequest("Customer name is required.");
        if (typeof payload.amount !== "number" || Number.isNaN(payload.amount)) return badRequest("A valid amount is required.");
        let credits = await getKey("credits", []);
        credits = credits.map((c) => (c.id === payload.id ? { ...c, customer: payload.customer.trim(), amount: payload.amount, note: payload.note || "" } : c));
        await setKey("credits", credits);
        return Response.json({ credits });
      } else if (action === "delete") {
        let credits = await getKey("credits", []);
        credits = credits.filter((c) => c.id !== payload.id);
        await setKey("credits", credits);
        return Response.json({ credits });
      }
      return Response.json({ error: "unknown action" }, { status: 400 });
    }

    return Response.json({ error: "unknown resource" }, { status: 400 });
  } catch (err) {
    console.error("Action failed:", err);
    return Response.json({ error: err.message || "Something went wrong saving that." }, { status: 500 });
  }
}
