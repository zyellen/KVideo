/**
 * Pure helpers for the global video source store.
 *
 * Kept in a separate module (no Redis / Cloudflare imports) so they can be
 * unit-tested with plain tsx without pulling in platform-specific bindings.
 */

import type { VideoSource } from '@/lib/types';

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
