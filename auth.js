import { getKey, setKey } from "../../../lib/kv";
import { SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const { passcode } = await req.json();
  if (!passcode || String(passcode).trim().length < 4) {
    return Response.json({ error: "Passcode must be at least 4 characters" }, { status: 400 });
  }
  const clean = String(passcode).trim();
  const existing = await getKey("settings:passcode", null);

  if (!existing) {
    await setKey("settings:passcode", clean);
  } else if (existing !== clean) {
    return Response.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(clean)}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
  );
  return res;
}
