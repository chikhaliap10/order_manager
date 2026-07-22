import { Redis } from "@upstash/redis";

// Vercel's Upstash integration auto-injects KV_REST_API_URL / KV_REST_API_TOKEN
// (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN depending on setup).
// We check both so either naming works without code changes.
function client() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Redis is not configured. Add the Upstash/KV integration in Vercel, or set KV_REST_API_URL and KV_REST_API_TOKEN in your environment."
    );
  }
  return new Redis({ url, token });
}

export async function getKey(key, fallback) {
  const redis = client();
  const value = await redis.get(key);
  return value === null || value === undefined ? fallback : value;
}

export async function setKey(key, value) {
  const redis = client();
  await redis.set(key, value);
}
