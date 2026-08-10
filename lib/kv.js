import { defaultMenu, defaultPartners } from "./defaults";
const store = {};
export async function getKey(key, fallback) { return key in store ? store[key] : fallback; }
export async function setKey(key, value) { store[key] = value; }
export async function getOrInitMenu() {
  const existing = await getKey("menu", null);
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const fresh = defaultMenu(); await setKey("menu", fresh); return fresh;
}
export async function getOrInitPartners() {
  const existing = await getKey("partners", null);
  if (Array.isArray(existing) && existing.length > 0) return existing;
  const fresh = defaultPartners(); await setKey("partners", fresh); return fresh;
}
