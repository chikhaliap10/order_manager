import { getKey } from "../../../lib/kv";
import { isAuthed } from "../../../lib/auth";
import { defaultMenu, defaultPartners } from "../../../lib/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const passcode = await getKey("settings:passcode", null);
    const authed = await isAuthed();

    // Temporary diagnostic info — masked, safe to view in a browser.
    // Shows which Supabase project this request actually reached and
    // whether it found a saved passcode, so we can confirm every request
    // is hitting the same database instead of guessing.
    const rawUrl = process.env.SUPABASE_URL || "";
    const debug = {
      supabaseUrlHost: rawUrl ? rawUrl.replace(/^https?:\/\//, "").split("/")[0] : "(not set)",
      supabaseUrlHasTrailingPath: /\/rest\/v1/.test(rawUrl),
      serviceRoleKeySet: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      passcodeFound: Boolean(passcode),
    };

    if (!authed) {
      return Response.json({ authed: false, needsSetup: !passcode, debug });
    }

    const [menu, partners, orders, expenses, withdrawals] = await Promise.all([
      getKey("menu", defaultMenu()),
      getKey("partners", defaultPartners()),
      getKey("orders", []),
      getKey("expenses", []),
      getKey("withdrawals", []),
    ]);

    return Response.json({ authed: true, menu, partners, orders, expenses, withdrawals, debug });
  } catch (err) {
    console.error("State load failed:", err);
    return Response.json({ error: err.message || "Could not load app data." }, { status: 500 });
  }
}
