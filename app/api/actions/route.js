import { getKey, setKey } from "../../../lib/kv";
import { appendRow } from "../../../lib/sheets";
import { isAuthed } from "../../../lib/auth";
import { uid } from "../../../lib/defaults";

export const dynamic = "force-dynamic";

const itemsSummary = (items) =>
  (items || []).map((i) => `${i.qty}x ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ");

export async function POST(req) {
  if (!(await isAuthed())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { resource, action, payload } = await req.json();

  // ---------- ORDERS ----------
  if (resource === "order") {
    let orders = await getKey("orders", []);

    if (action === "create") {
      orders = [payload, ...orders];
      await appendRow("Orders", [
        new Date().toISOString(), "created", payload.id, payload.customer,
        itemsSummary(payload.items), payload.total, payload.paid ? "paid" : "unpaid",
      ]);
    } else if (action === "update") {
      orders = orders.map((o) => (o.id === payload.id ? payload : o));
      await appendRow("Orders", [
        new Date().toISOString(), "edited", payload.id, payload.customer,
        itemsSummary(payload.items), payload.total, payload.paid ? "paid" : "unpaid",
      ]);
    } else if (action === "toggle-paid") {
      orders = orders.map((o) => (o.id === payload.id ? { ...o, paid: !o.paid } : o));
      const updated = orders.find((o) => o.id === payload.id);
      if (updated) {
        await appendRow("Orders", [
          new Date().toISOString(), updated.paid ? "marked-paid" : "marked-unpaid", updated.id,
          updated.customer, itemsSummary(updated.items), updated.total, updated.paid ? "paid" : "unpaid",
        ]);
      }
    } else if (action === "delete") {
      const removed = orders.find((o) => o.id === payload.id);
      orders = orders.filter((o) => o.id !== payload.id);
      if (removed) {
        await appendRow("Orders", [
          new Date().toISOString(), "deleted", removed.id, removed.customer,
          itemsSummary(removed.items), removed.total, removed.paid ? "paid" : "unpaid",
        ]);
      }
    }
    await setKey("orders", orders);
    return Response.json({ orders });
  }

  // ---------- EXPENSES ----------
  if (resource === "expense") {
    let expenses = await getKey("expenses", []);

    if (action === "create") {
      expenses = [payload, ...expenses];
      await appendRow("Expenses", [new Date().toISOString(), "created", payload.id, payload.category, payload.amount, payload.note || ""]);
    } else if (action === "delete") {
      const removed = expenses.find((e) => e.id === payload.id);
      expenses = expenses.filter((e) => e.id !== payload.id);
      if (removed) {
        await appendRow("Expenses", [new Date().toISOString(), "deleted", removed.id, removed.category, removed.amount, removed.note || ""]);
      }
    }
    await setKey("expenses", expenses);
    return Response.json({ expenses });
  }

  // ---------- WITHDRAWALS ----------
  if (resource === "withdrawal") {
    let withdrawals = await getKey("withdrawals", []);
    const partners = await getKey("partners", []);
    const partnerName = (id) => partners.find((p) => p.id === id)?.name || "Unknown";

    if (action === "create") {
      withdrawals = [payload, ...withdrawals];
      await appendRow("Withdrawals", [new Date().toISOString(), "created", payload.id, partnerName(payload.partnerId), payload.amount, payload.note || ""]);
    } else if (action === "delete") {
      const removed = withdrawals.find((w) => w.id === payload.id);
      withdrawals = withdrawals.filter((w) => w.id !== payload.id);
      if (removed) {
        await appendRow("Withdrawals", [new Date().toISOString(), "deleted", removed.id, partnerName(removed.partnerId), removed.amount, removed.note || ""]);
      }
    }
    await setKey("withdrawals", withdrawals);
    return Response.json({ withdrawals });
  }

  // ---------- MENU ----------
  if (resource === "menu") {
    let menu = await getKey("menu", []);

    if (action === "add-group") {
      menu = [...menu, { id: uid(), name: payload.name, items: [] }];
    } else if (action === "remove-group") {
      menu = menu.filter((g) => g.id !== payload.groupId);
    } else if (action === "add-item") {
      menu = menu.map((g) => (g.id === payload.groupId ? { ...g, items: [...g.items, payload.item] } : g));
    } else if (action === "remove-item") {
      menu = menu.map((g) => (g.id === payload.groupId ? { ...g, items: g.items.filter((i) => i.id !== payload.itemId) } : g));
    }
    await setKey("menu", menu);
    return Response.json({ menu });
  }

  // ---------- PARTNERS ----------
  if (resource === "partners") {
    let partners = await getKey("partners", []);
    if (action === "rename") {
      partners = partners.map((p) => (p.id === payload.id ? { ...p, name: payload.name } : p));
    }
    await setKey("partners", partners);
    return Response.json({ partners });
  }

  return Response.json({ error: "unknown resource" }, { status: 400 });
}
