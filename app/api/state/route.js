import { getKey, getOrInitMenu, getOrInitPartners } from "../../../lib/kv";
import { isAuthed } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authed = await isAuthed();

    if (!authed) {
      return Response.json({ authed: false });
    }

    const [menu, partners, orders, expenses, withdrawals] = await Promise.all([
      getOrInitMenu(),
      getOrInitPartners(),
      getKey("orders", []),
      getKey("expenses", []),
      getKey("withdrawals", []),
    ]);

    return Response.json({ authed: true, menu, partners, orders, expenses, withdrawals });
  } catch (err) {
    console.error("State load failed:", err);
    return Response.json({ error: err.message || "Could not load app data." }, { status: 500 });
  }
}
