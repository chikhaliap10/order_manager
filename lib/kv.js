import { createClient } from "@supabase/supabase-js";

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
