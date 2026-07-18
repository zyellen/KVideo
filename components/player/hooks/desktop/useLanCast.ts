'use client';

import { useCallback, useRef, useState } from 'react';

/** 局域网投屏设备 */
export interface LanCastDevice {
  id: string;
  name: string;
  controlUrl: string;
  modelName?: string;
  /** 设备协议：dlna 为标准 DLNA/UPnP，airplay 为苹果 AirPlay */
  protocol?: 'dlna' | 'airplay';
}

/** 发现设备时的选项 */
export interface DiscoverOptions {
  /** 是否启用兼容模式（更广的 SSDP 搜索 + AirPlay 发现） */
  compatibility?: boolean;
}

export type LanCastAction = 'play' | 'pause' | 'resume' | 'stop' | 'seek';

interface UseLanCastResult {
  devices: LanCastDevice[];
  isDiscovering: boolean;
  error: string | null;
  /** 发现局域网内的投屏设备 */
  discover: (options?: DiscoverOptions) => Promise<void>;
  /** 向指定设备下发投屏控制指令 */
  control: (
    action: LanCastAction,
    controlUrl: string,
    options?: { mediaUrl?: string; title?: string; seekSeconds?: number },
  ) => Promise<boolean>;
}

/**
 * 管理局域网投屏（DLNA）的设备发现与控制
 *
 * 封装对 /api/cast/* 接口的调用，供投屏菜单使用。
 */
export function useLanCast(): UseLanCastResult {
  const [devices, setDevices] = useState<LanCastDevice[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverRef = useRef<AbortController | null>(null);

  const discover = useCallback(async (options?: DiscoverOptions) => {
    setIsDiscovering(true);
    setError(null);
    discoverRef.current?.abort();
    const controller = new AbortController();
    discoverRef.current = controller;

    try {
      const query = options?.compatibility ? '?compatibility=1' : '';
      const response = await fetch(`/api/cast/devices${query}`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? '发现设备失败');
      }
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '发现设备失败');
      setDevices([]);
    } finally {
      if (!controller.signal.aborted) {
        setIsDiscovering(false);
      }
    }
  }, []);

  const control = useCallback(
    async (
      action: LanCastAction,
      controlUrl: string,
      options?: { mediaUrl?: string; title?: string; seekSeconds?: number },
    ): Promise<boolean> => {
      try {
        const response = await fetch('/api/cast/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            controlUrl,
            mediaUrl: options?.mediaUrl,
            title: options?.title,
            seekSeconds: options?.seekSeconds,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? '投屏控制失败');
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : '投屏控制失败');
        return false;
      }
    },
    [],
  );

  return { devices, isDiscovering, error, discover, control };
}
