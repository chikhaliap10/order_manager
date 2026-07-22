import { NextResponse } from "next/server";
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
  const appPasscode = process.env.APP_PASSCODE;

  if (!appPasscode) {
    return NextResponse.json(
      { error: "APP_PASSCODE is not set in this deployment's environment variables. Add it in Vercel Settings -> Environment Variables and redeploy." },
      { status: 500 }
    );
  }

  if (!passcode || String(passcode).trim() !== appPasscode) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, appPasscode, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: true,
  });
  return res;
}
