import { getOrInitMenu, getKey, setKey } from "../../../lib/kv";
import { uid } from "../../../lib/defaults";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 3; // max orders per window per visitor
const MAX_PLATES_PER_ORDER = 50;
const DUPLICATE_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours

function getClientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

async function checkRateLimit(ip) {
  const key = `ratelimit:${ip}`;
  const now = Date.now();
  const recent = (await getKey(key, [])).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  await setKey(key, recent);
  return true;
}

function isValidPhone(phone) {
  const digits = (phone || "").replace(/[^\d]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export async function POST(req) {
  try {
    const body = await req.json();

    // Honeypot: a real customer never fills this hidden field in. Any bot
    // that blindly fills every field will trip it. Silently pretend
    // success so the bot doesn't learn anything from the response.
    if (body.website) {
      return Response.json({ ok: true });
    }

    if (!body.customer?.trim()) {
      return Response.json({ error: "Please enter your name." }, { status: 400 });
    }
    if (!isValidPhone(body.phone)) {
      return Response.json({ error: "Please enter a valid phone number." }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return Response.json({ error: "Please add at least one item." }, { status: 400 });
    }

    const ip = getClientIp(req);
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return Response.json({ error: "Too many orders submitted recently. Please wait a few minutes and try again." }, { status: 429 });
    }

    // Never trust prices or item names from the client -- look everything
    // up from the real, current menu server-side, so nobody can submit a
    // tampered price or a nonexistent item.
    const menu = await getOrInitMenu();
    const resolvedItems = [];
    let totalPlates = 0;

    for (const reqItem of body.items) {
      const group = menu.find((g) => g.id === reqItem.groupId);
      const item = group?.items.find((i) => i.id === reqItem.itemId);
      const qty = Number(reqItem.qty);
      if (!group || !item || !(qty > 0)) continue;

      if (item.addOnMode) {
        const style = reqItem.style === "Crunchy" ? "Crunchy" : "Regular";
        const sevOption = (item.sevOptions || []).find((s) => s.id === reqItem.sevOptionId);
        if (!sevOption) continue;
        const addOnIds = Array.isArray(reqItem.addOnIds) ? reqItem.addOnIds : [];
        const selectedAddOns = (item.addOns || []).filter((a) => addOnIds.includes(a.id));
        const base = style === "Crunchy" ? Number(item.basePriceCrunchy) : Number(item.basePriceRegular);
        const price = base + Number(sevOption.extra) + selectedAddOns.reduce((s, a) => s + Number(a.extra), 0);
        const parts = [style, sevOption.name, ...selectedAddOns.map((a) => a.name)];
        totalPlates += qty;
        resolvedItems.push({ name: item.name, variantLabel: parts.join(" + "), price, qty });
      } else if (item.sizeFlavorMode) {
        const size = (item.sizes || []).find((s) => s.id === reqItem.sizeId);
        if (!size) continue;
        const flavor = (item.flavors || []).find((f) => f.id === reqItem.flavorId);
        const extra = flavor ? Number(flavor.extraBySize?.[size.id] || 0) : 0;
        const price = Number(size.basePrice) + extra;
        const variantLabel = [size.name, flavor?.name].filter(Boolean).join(" + ");
        totalPlates += qty;
        resolvedItems.push({ name: item.name, variantLabel, price, qty });
      } else {
        const variant = item.variants.find((v) => v.id === reqItem.variantId);
        if (!variant) continue;
        totalPlates += qty;
        resolvedItems.push({ name: item.name, variantLabel: variant.label || "", price: variant.price, qty });
      }
    }

    if (resolvedItems.length === 0) {
      return Response.json({ error: "Please add at least one valid item." }, { status: 400 });
    }
    if (totalPlates > MAX_PLATES_PER_ORDER) {
      return Response.json({ error: `Orders are limited to ${MAX_PLATES_PER_ORDER} plates. Please call in larger orders.` }, { status: 400 });
    }

    const total = resolvedItems.reduce((s, i) => s + i.price * i.qty, 0);
    const now = Date.now();
    const orders = await getKey("orders", []);

    // Flag (never block) an order that shares the same name or phone with
    // another order placed recently -- staff sees a warning and can
    // confirm it's legitimate before prepping, catching accidental
    // double-taps or deliberate duplicate/fraudulent orders.
    const normalizedName = body.customer.trim().toLowerCase();
    const normalizedPhone = body.phone.replace(/[^\d]/g, "");
    const possibleDuplicate = orders.some((o) => {
      if (now - (o.ts || 0) > DUPLICATE_WINDOW_MS) return false;
      const oName = (o.customer || "").trim().toLowerCase();
      const oPhone = (o.phone || "").replace(/[^\d]/g, "");
      return oName === normalizedName || (normalizedPhone && oPhone && oPhone === normalizedPhone);
    });

    const order = {
      id: uid(),
      customer: body.customer.trim().slice(0, 80),
      phone: body.phone.trim().slice(0, 20),
      items: resolvedItems,
      total,
      paid: false,
      source: "online",
      reviewed: false,
      possibleDuplicate,
      ts: now,
    };

    await setKey("orders", [order, ...orders]);

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Public order submission failed:", err);
    return Response.json({ error: "Something went wrong submitting your order. Please try again." }, { status: 500 });
  }
}
