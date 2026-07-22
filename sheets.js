import { getKey } from "../../../lib/kv";
import { isAuthed } from "../../../lib/auth";
import { defaultMenu, defaultPartners } from "../../../lib/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  const passcode = await getKey("settings:passcode", null);
  const authed = await isAuthed();

  if (!authed) {
    return Response.json({ authed: false, needsSetup: !passcode });
  }

  const [menu, partners, orders, expenses, withdrawals] = await Promise.all([
    getKey("menu", defaultMenu()),
    getKey("partners", defaultPartners()),
    getKey("orders", []),
    getKey("expenses", []),
    getKey("withdrawals", []),
  ]);

  return Response.json({ authed: true, menu, partners, orders, expenses, withdrawals });
}
