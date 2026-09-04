/**
 * Parallel Streaming Search API Route
 * Searches all sources in parallel and streams results immediately as they arrive.
 * Supports abort via request.signal when clients disconnect.
 * Caps results per source and total to prevent OOM.
 */

import { NextRequest } from 'next/server';
import { searchVideos } from '@/lib/api/client';
import { getSourceName } from '@/lib/utils/source-names';
import { traditionalToSimplified } from '@/lib/utils/chinese-convert';
import { dedupeById, getGlobalSources } from '@/lib/server/global-sources';
import { getServerSession } from '@/lib/server/auth';
import type { VideoSource } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_TOTAL_VIDEOS = 2000;
const MAX_PAGES_PER_SOURCE = 3;
const PER_SOURCE_TIMEOUT_MS = 20000;

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Use the request signal for abort detection
      const signal = request.signal;

      const safeSend = (data: object) => {
        if (signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed
        }
      };

      try {
        const body = await request.json();
        const { query, sources: sourceConfigs } = body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
          safeSend({ type: 'error', message: 'Invalid query' });
          controller.close();
          return;
        }

        const normalizedQuery = traditionalToSimplified(query.trim());
        const clientSources: VideoSource[] =
          Array.isArray(sourceConfigs) && sourceConfigs.length > 0
            ? (sourceConfigs as VideoSource[])
            : [];

        // 按当前账户的「共享全局视频源」开关决定是否注入全局源。
        // 未登录（或 legacy 模式）默认视为共享，避免影响既有体验。
        const session = await getServerSession(request);
        const shareGlobal = session ? (session.shareGlobalSources !== false) : true;
        const globalSources = shareGlobal ? await getGlobalSources() : [];
        // Merge global sources with client sources; client sources win on id conflict.
        const sources = dedupeById([...clientSources, ...globalSources]);

        if (sources.length === 0) {
          safeSend({ type: 'error', message: 'No valid sources provided' });
          controller.close();
          return;
        }

        safeSend({ type: 'start', totalSources: sources.length });

        let completedSources = 0;
        let totalVideosFound = 0;

        const searchPromises = sources.map(async (source: any) => {
          if (signal.aborted) return;

          const startTime = performance.now();

          // Per-source timeout via AbortController
          const sourceController = new AbortController();
          const sourceTimeout = setTimeout(
            () => sourceController.abort(),
            PER_SOURCE_TIMEOUT_MS
          );

          // Cascade request abort to source controller
          const onRequestAbort = () => sourceController.abort();
          signal.addEventListener('abort', onRequestAbort, { once: true });

          try {
            const result = await searchVideos(
              normalizedQuery, [source], 1, sourceController.signal
            );
            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);
            const videos = result[0]?.results || [];
            const pagecount = result[0]?.pagecount ?? 1;

            completedSources++;
            totalVideosFound += videos.length;

            if (videos.length > 0 && !signal.aborted) {
              safeSend({
                type: 'videos',
                videos: videos.map((video: any) => ({
                  ...video,
                  sourceDisplayName: getSourceName(source.id),
                  latency,
                })),
                source: source.id,
                completedSources,
                totalSources: sources.length,
                latency,
              });
            }

            safeSend({
              type: 'progress',
              completedSources,
              totalSources: sources.length,
              totalVideosFound,
            });

            // Auto-fetch remaining pages (capped)
            if (pagecount > 1 && totalVideosFound < MAX_TOTAL_VIDEOS && !signal.aborted) {
              const maxPages = Math.min(pagecount, MAX_PAGES_PER_SOURCE);
              const remainingPages = Array.from(
                { length: maxPages - 1 }, (_, i) => i + 2
              );

              for (const pg of remainingPages) {
                if (signal.aborted || totalVideosFound >= MAX_TOTAL_VIDEOS) break;

                try {
                  const pageResult = await searchVideos(
                    normalizedQuery, [source], pg, sourceController.signal
                  );
                  const pageVideos = pageResult[0]?.results || [];
                  totalVideosFound += pageVideos.length;

                  if (pageVideos.length > 0 && !signal.aborted) {
                    safeSend({
                      type: 'videos',
                      videos: pageVideos.map((video: any) => ({
                        ...video,
                        sourceDisplayName: getSourceName(source.id),
                        latency,
                      })),
                      source: source.id,
                      completedSources,
                      totalSources: sources.length,
                      latency,
                    });
                  }

                  safeSend({
                    type: 'progress',
                    completedSources,
                    totalSources: sources.length,
                    totalVideosFound,
                  });
                } catch {
                  // Page fetch failed, continue
                }
              }
            }
          } catch (error) {
            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);
            console.error(
              `[Search] Source ${source.id} failed after ${latency}ms:`,
              error
            );
            completedSources++;

            safeSend({
              type: 'progress',
              completedSources,
              totalSources: sources.length,
              totalVideosFound,
            });
          } finally {
            clearTimeout(sourceTimeout);
            signal.removeEventListener('abort', onRequestAbort);
          }
        });

        await Promise.all(searchPromises);

        if (!signal.aborted) {
          safeSend({
            type: 'complete',
            totalVideosFound,
            totalSources: sources.length,
            maxPageCount: MAX_PAGES_PER_SOURCE,
          });
        }

        controller.close();
      } catch (error) {
        if (!signal.aborted) {
          console.error('Search error:', error);
          safeSend({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
