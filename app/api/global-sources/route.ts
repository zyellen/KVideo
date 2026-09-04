/**
 * Global Video Sources API Route
 *
 * Server-side global source store shared by all accounts.
 * GET: any authenticated session may read the list.
 * POST: admin-only (source_management permission) — replaces the whole list.
 *
 * Note: reuses lib/server/global-sources.ts, which uses the standard
 * @upstash/redis package (node build, shared with /api/search-parallel),
 * so this route runs on the nodejs runtime.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticationRequiredResponse } from '@/lib/server/api-responses';
import { getServerSession, hasServerPermission } from '@/lib/server/auth';
import { getGlobalSources, setGlobalSources } from '@/lib/server/global-sources';
import type { VideoSource } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getServerSession(request);

  if (!session) {
    return authenticationRequiredResponse();
  }

  try {
    const sources = await getGlobalSources();
    return NextResponse.json({ success: true, sources });
  } catch (error) {
    console.error('Global sources read error:', error);
    return NextResponse.json(
      { error: 'Failed to read global sources' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(request);

  if (!session) {
    return authenticationRequiredResponse();
  }

  if (!hasServerPermission(session, 'source_management')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { sources } = body as { sources?: unknown };
    const list = Array.isArray(sources) ? (sources as VideoSource[]) : [];

    await setGlobalSources(list);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Global sources write error:', error);
    return NextResponse.json(
      { error: 'Failed to save global sources' },
      { status: 500 }
    );
  }
}
