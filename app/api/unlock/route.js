import { NextResponse } from "next/server";
import { getKey, setKey } from "../../../lib/kv";
import { SESSION_COOKIE } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { passcode } = body || {};
  if (!passcode || String(passcode).trim().length < 4) {
    return NextResponse.json({ error: "Passcode must be at least 4 characters" }, { status: 400 });
  }

  const clean = String(passcode).trim();

  let existing;
  try {
    existing = await getKey("settings:passcode", null);
  } catch (err) {
    return NextResponse.json({ error: err.message || "Database error" }, { status: 500 });
  }

  if (!existing) {
    try {
      await setKey("settings:passcode", clean);
    } catch (err) {
      return NextResponse.json({ error: err.message || "Database error" }, { status: 500 });
    }
  } else if (existing !== clean) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  // Use Next's official cookie API (NextResponse.cookies) rather than
  // manually building a Set-Cookie header string — this is the
  // Next.js-documented way to reliably set cookies from a Route Handler,
  // and avoids edge cases where a hand-built header can silently fail
  // to reach the browser depending on runtime/deployment specifics.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, clean, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: true,
  });
  return res;
}
