/**
 * 局域网投屏设备发现接口
 *
 * 通过 SSDP 广播发现同一局域网下的 DLNA/UPnP 媒体渲染设备；
 * 兼容模式（?compatibility=1）下还会通过 mDNS 发现苹果 AirPlay 设备，
 * 并返回合并后的设备列表供前端投屏菜单展示。
 */

import { NextResponse } from 'next/server';
import { discoverDlnaDevices } from '@/lib/cast/dlna';
import { discoverAirPlayDevices } from '@/lib/cast/airplay';

// 必须运行在 Node.js 运行时（需使用 UDP 套接字）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const compatibility = searchParams.get('compatibility') === '1';

    // 兼容模式下延长 DLNA 超时并追加 AirPlay 发现，二者并行执行
    const tasks: Promise<unknown[]>[] = [
      discoverDlnaDevices(compatibility ? 6000 : 5000, { compatibility }),
    ];
    if (compatibility) {
      tasks.push(discoverAirPlayDevices(4000));
    }

    const results = await Promise.all(tasks);
    const devices = results.flat();

    return NextResponse.json({ devices, compatibility });
  } catch (error) {
    console.error('[Cast] 设备发现失败:', error);
    return NextResponse.json(
      {
        devices: [],
        error: error instanceof Error ? error.message : '设备发现失败',
      },
      { status: 500 },
    );
  }
}
