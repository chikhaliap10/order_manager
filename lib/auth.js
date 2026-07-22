import { cookies } from "next/headers";

export const SESSION_COOKIE = "ol_session";

// The shared passcode now lives in an environment variable (APP_PASSCODE),
// set once in Vercel — not in the database. This means there's no
// "first person sets it up" step, no database read/write involved in
// login at all, and everyone always sees the same simple "enter passcode"
// screen from day one.
export async function isAuthed() {
  const appPasscode = process.env.APP_PASSCODE;
  if (!appPasscode) return false;
  const session = cookies().get(SESSION_COOKIE)?.value;
  return session === appPasscode;
}
