/**
 * Server-side global video source store.
 *
 * A single Redis-backed list of VideoSource objects shared by ALL accounts.
 * `/api/search-parallel` merges these into every search so an account with an
 * empty client-side sources array still gets results. Maintained by admins
 * through the `/api/global-sources` route (permission: `source_management`).
 *
 * NOTE: this module runs under the nodejs runtime (imported by
 * /api/search-parallel), so it uses the standard `@upstash/redis` package —
 * NOT the `/cloudflare` subpath used by edge routes.
 */

import { Redis } from '@upstash/redis';
import type { VideoSource } from '@/lib/types';

export const GLOBAL_SOURCES_KEY = 'config:global:sources';

let cachedRedis: Redis | null | undefined;

/**
 * Lazily build the Redis client from env (same approach as
 * app/api/user/sync/route.ts). Returns null when Redis is not configured so
 * module import has no side effects and pure functions stay testable.
 */
function getRedisClient(): Redis | null {
  if (cachedRedis !== undefined) {
    return cachedRedis;
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    cachedRedis = null;
    return cachedRedis;
  }

  cachedRedis = Redis.fromEnv();
  return cachedRedis;
}

/**
 * Keep only well-formed sources. Drops entries missing id/name/baseUrl.
 */
export function sanitizeSources(input: unknown): VideoSource[] {
  if (!Array.isArray(input)) return [];

  const result: VideoSource[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== 'string' || !source.id) continue;
    if (typeof source.name !== 'string' || !source.name) continue;
    if (typeof source.baseUrl !== 'string' || !source.baseUrl) continue;
    result.push(source as unknown as VideoSource);
  }
  return result;
}

/**
 * Merge sources by id, keeping the FIRST occurrence of each id
 * (client sources win over global sources).
 */
export function dedupeById(sources: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  const result: VideoSource[] = [];

  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || !source.id) continue;
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    result.push(source);
  }

  return result;
}

/**
 * Read the global source list. Returns [] when the key is missing,
 * the stored value is invalid, or Redis is unavailable.
 */
export async function getGlobalSources(): Promise<VideoSource[]> {
  const redis = getRedisClient();
  if (!redis) return [];

  try {
    const stored = await redis.get<unknown>(GLOBAL_SOURCES_KEY);
    return sanitizeSources(stored);
  } catch (error) {
    console.error('Global sources read failed:', error);
    return [];
  }
}

/**
 * Replace the entire global source list (sanitized + deduped by id).
 */
export async function setGlobalSources(sources: VideoSource[]): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Global sources storage unavailable');
  }

  const cleaned = dedupeById(sanitizeSources(sources));
  await redis.set(GLOBAL_SOURCES_KEY, cleaned);
}
