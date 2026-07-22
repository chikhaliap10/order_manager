import { createClient } from "@supabase/supabase-js";
import { defaultMenu, defaultPartners } from "./defaults";

// Uses a single Postgres table (kv_store) as simple key-value storage,
// so the rest of the app (API routes, page.jsx) doesn't need to change —
// getKey/setKey work exactly the same as before.
//
// SUPABASE_SERVICE_ROLE_KEY is required (not the anon/public key) because
// these calls happen server-side, with no logged-in Supabase user, and
// need to bypass row-level security to read/write app data directly.
function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getKey(key, fallback) {
  const supabase = client();
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return data ? data.value : fallback;
}

export async function setKey(key, value) {
  const supabase = client();
  const { error } = await supabase.from("kv_store").upsert({ key, value });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}

// getKey(key, defaultX()) is NOT safe to call from multiple places for
// menu/partners, because defaultMenu()/defaultPartners() generate fresh
// random IDs every time they're invoked. If two different requests each
// fall back to their own freshly-generated default (because nothing was
// persisted yet), they'll disagree on IDs and edits will silently fail to
// match anything. These two helpers fix that: the FIRST time menu/partners
// are ever read, the default is generated once and immediately persisted,
// so every future read (from any route) sees the exact same stable IDs.
export async function getOrInitMenu() {
  const existing = await getKey("menu", null);
  // An empty array is technically "truthy" in JS, but it means the same
  // thing as "nothing saved yet" for our purposes — without this length
  // check, a database that ended up with an empty list saved (e.g. from
  // an earlier bug) would be treated as valid and never get repopulated.
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const fresh = defaultMenu();
  await setKey("menu", fresh);
  return fresh;
}

export async function getOrInitPartners() {
  const existing = await getKey("partners", null);
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const fresh = defaultPartners();
  await setKey("partners", fresh);
  return fresh;
}
