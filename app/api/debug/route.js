import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// A single, comprehensive diagnostic page. Visit this URL directly in a
// browser (no login needed) to see, in one shot: which Supabase project
// this server is actually configured to use, whether a real write+read
// round-trip succeeds, and how many rows currently exist. This exists
// purely to cut out multi-step DevTools debugging.
export async function GET() {
  const rawUrl = process.env.SUPABASE_URL || "";
  const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const report = {
    config: {
      SUPABASE_URL_raw: rawUrl || "(not set)",
      SUPABASE_URL_host: rawUrl.replace(/^https?:\/\//, "").split("/")[0] || "(not set)",
      SUPABASE_URL_has_bad_suffix: /\/rest\/v1/.test(rawUrl),
      SUPABASE_SERVICE_ROLE_KEY_set: hasKey,
      SUPABASE_SERVICE_ROLE_KEY_length: hasKey ? process.env.SUPABASE_SERVICE_ROLE_KEY.length : 0,
    },
    writeTest: null,
    readBackTest: null,
    passcodeRow: null,
    allRows: null,
    error: null,
  };

  if (!rawUrl || !hasKey) {
    report.error = "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from this deployment's environment variables.";
    return Response.json(report);
  }

  try {
    const supabase = createClient(rawUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Try writing a throwaway test value
    const testValue = `ping-${Date.now()}`;
    const { error: writeErr } = await supabase.from("kv_store").upsert({ key: "debug:ping", value: testValue });
    report.writeTest = writeErr ? { success: false, error: writeErr.message } : { success: true, wrote: testValue };

    // 2. Immediately read it back
    const { data: readData, error: readErr } = await supabase
      .from("kv_store").select("value").eq("key", "debug:ping").maybeSingle();
    report.readBackTest = readErr
      ? { success: false, error: readErr.message }
      : { success: true, found: readData ? readData.value : null, matches: readData?.value === testValue };

    // 3. Check the actual passcode row
    const { data: passData, error: passErr } = await supabase
      .from("kv_store").select("value").eq("key", "settings:passcode").maybeSingle();
    report.passcodeRow = passErr
      ? { success: false, error: passErr.message }
      : { success: true, found: Boolean(passData), value: passData ? passData.value : null };

    // 4. List every row currently in the table (keys only, not full values, for a clean overview)
    const { data: allData, error: allErr } = await supabase.from("kv_store").select("key");
    report.allRows = allErr
      ? { success: false, error: allErr.message }
      : { success: true, count: allData.length, keys: allData.map((r) => r.key) };
  } catch (err) {
    report.error = err.message || String(err);
  }

  return Response.json(report, { headers: { "Content-Type": "application/json" } });
}
