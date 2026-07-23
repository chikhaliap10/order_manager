import { getKey, setKey, getOrInitMenu, getOrInitPartners } from "../../../lib/kv";
import { isAuthed } from "../../../lib/auth";
import { uid } from "../../../lib/defaults";

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
          return { ...o, paid: newPaid, collectedBy: newPaid ? (payload.collectedBy || "") : "" };
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
        const item = action === "add-item" ? payload?.item : payload?.item;
        if (!item?.name?.trim()) return badRequest("Item name is required.");
        if (!Array.isArray(item.variants) || item.variants.length === 0 || !item.variants.some((v) => Number(v.price) > 0)) {
          return badRequest("At least one price is required.");
        }
      }

      let menu = await getOrInitMenu();

      if (action === "add-group") {
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

    return Response.json({ error: "unknown resource" }, { status: 400 });
  } catch (err) {
    console.error("Action failed:", err);
    return Response.json({ error: err.message || "Something went wrong saving that." }, { status: 500 });
  }
}
