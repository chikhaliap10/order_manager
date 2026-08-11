import { getOrInitMenu } from "../../../lib/kv";

export const dynamic = "force-dynamic";

// Deliberately public, no auth check -- this only ever returns the menu
// (categories, items, prices), never anything else. A customer placing an
// order needs to see prices without logging in; nothing sensitive lives
// on this route.
export async function GET() {
  try {
    const menu = await getOrInitMenu();
    return Response.json({ menu });
  } catch (err) {
    console.error("Public menu load failed:", err);
    return Response.json({ error: "Could not load the menu." }, { status: 500 });
  }
}
