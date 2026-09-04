/**
 * Server-side global video source store.
 *
 * A single Redis-backed list of VideoSource objects shared by ALL accounts.
 * `/api/search-parallel` merges these into every search so an account with an
 * empty client-side sources array still gets results. Maintained by admins
 * through the `/api/global-sources` route (permission: `source_management`).
 *
 * Pure helpers (dedupeById / sanitizeSources) live in global-sources-utils.ts
 * so tests can import them without pulling in Redis / Cloudflare bindings.
 */

import { getRedisClient } from '@/lib/server/redis';
import type { VideoSource } from '@/lib/types';
import { dedupeById, sanitizeSources } from '@/lib/server/global-sources-utils';

export { dedupeById, sanitizeSources } from '@/lib/server/global-sources-utils';

export const GLOBAL_SOURCES_KEY = 'config:global:sources';

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
