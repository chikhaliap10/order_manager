import { cookies } from "next/headers";
import { getKey } from "./kv";

export const SESSION_COOKIE = "ol_session";

export async function isAuthed() {
  const passcode = await getKey("settings:passcode", null);
  if (!passcode) return false;
  const session = cookies().get(SESSION_COOKIE)?.value;
  return session === passcode;
}
