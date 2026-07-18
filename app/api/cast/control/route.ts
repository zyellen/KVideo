/**
 * 局域网投屏控制接口
 *
 * 接收前端下发的投屏动作（播放 / 暂停 / 继续 / 停止 / 跳转），
 * 通过 SOAP 调用目标设备的 AVTransport 服务。
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  dlnaSetAndPlay,
  dlnaPause,
  dlnaResume,
  dlnaStop,
  dlnaSeek,
} from '@/lib/cast/dlna';

// 必须运行在 Node.js 运行时
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ControlBody {
  action: 'play' | 'pause' | 'resume' | 'stop' | 'seek';
  controlUrl?: string;
  mediaUrl?: string;
  title?: string;
  seekSeconds?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ControlBody;
    const { action, controlUrl, mediaUrl, title, seekSeconds } = body;

    if (!controlUrl || typeof controlUrl !== 'string') {
      return NextResponse.json({ error: '缺少 controlUrl 参数' }, { status: 400 });
    }

    let result;
    switch (action) {
      case 'play':
        if (!mediaUrl || typeof mediaUrl !== 'string') {
          return NextResponse.json({ error: '播放动作缺少 mediaUrl 参数' }, { status: 400 });
        }
        result = await dlnaSetAndPlay(controlUrl, mediaUrl, title ?? 'KVideo', seekSeconds ?? 0);
        break;
      case 'pause':
        result = await dlnaPause(controlUrl);
        break;
      case 'resume':
        result = await dlnaResume(controlUrl);
        break;
      case 'stop':
        result = await dlnaStop(controlUrl);
        break;
      case 'seek':
        result = await dlnaSeek(controlUrl, seekSeconds ?? 0);
        break;
      default:
        return NextResponse.json({ error: '未知的投屏动作' }, { status: 400 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '投屏控制失败' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Cast] 控制失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '投屏控制失败' },
      { status: 500 },
    );
  }
}
