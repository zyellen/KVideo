'use client';

import React from 'react';
import { Icons } from '@/components/ui/Icon';
import { useLanCast, type LanCastDevice } from '../hooks/desktop/useLanCast';

interface CastMenuProps {
  /** 当前播放地址 */
  src: string;
  /** 视频元素引用，用于读取当前播放进度 */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 是否存在可用的 Google Cast（Chromecast） */
  isCastAvailable: boolean;
  /** 触发 Chromecast 原生投屏选择器 */
  onShowChromecastMenu: () => void;
  /** 是否正在投屏（含 Chromecast） */
  isCasting: boolean;
  /** 通知播放器更新投屏状态（用于高亮按钮） */
  onCastingChange: (casting: boolean) => void;
}

/**
 * 投屏菜单：聚合「局域网设备（DLNA）」与「Google Cast」，并提供停止投屏。
 */
export function CastMenu({
  src,
  videoRef,
  isCastAvailable,
  onShowChromecastMenu,
  isCasting,
  onCastingChange,
}: CastMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [lanDevice, setLanDevice] = React.useState<LanCastDevice | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // 兼容模式：更广的 DLNA 搜索 + AirPlay 发现，持久化到 localStorage
  const [compatibility, setCompatibility] = React.useState(false);
  const [airPlayHint, setAirPlayHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      if (localStorage.getItem('kvideo_cast_compat') === '1') setCompatibility(true);
    } catch {
      // 忽略本地存储读取异常
    }
  }, []);

  const { devices, isDiscovering, error, discover, control } = useLanCast();

  // 解析设备可访问的媒体地址（相对路径基于当前源站拼成绝对地址）
  const mediaUrl = React.useMemo(() => {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (typeof window === 'undefined') return src;
    return `${window.location.origin}${src.startsWith('/') ? '' : '/'}${src}`;
  }, [src]);

  // HLS 在多数 DLNA 设备上不支持，提示用户
  const isHls = src.includes('.m3u8');

  // 打开菜单时自动发现一次局域网设备（遵循当前兼容模式）
  React.useEffect(() => {
    if (open) {
      setAirPlayHint(null);
      void discover({ compatibility });
    }
  }, [open, discover, compatibility]);

  // 点击菜单外部关闭
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // 组件卸载时若正在 DLNA 投屏则尝试停止
  React.useEffect(() => {
    return () => {
      if (lanDevice) {
        void control('stop', lanDevice.controlUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanDevice]);

  /**
   * 将当前内容投屏到指定局域网设备
   *
   * AirPlay 设备不支持 DLNA SOAP 控制，仅提示用户使用设备自带屏幕镜像。
   */
  const handleCastToDevice = React.useCallback(
    async (device: LanCastDevice) => {
      if (device.protocol === 'airplay') {
        setAirPlayHint('已发现 AirPlay 设备，请使用其自带的「屏幕镜像」功能完成投屏（当前版本暂不支持直接控制 AirPlay 设备）。');
        return;
      }
      const ok = await control('play', device.controlUrl, {
        mediaUrl,
        title: 'KVideo',
        seekSeconds: Math.floor(videoRef.current?.currentTime ?? 0),
      });
      if (ok) {
        setLanDevice(device);
        onCastingChange(true);
        videoRef.current?.pause();
        setOpen(false);
      }
    },
    [control, mediaUrl, onCastingChange, videoRef],
  );

  /**
   * 切换兼容模式：持久化偏好并立即重新发现设备
   */
  const handleToggleCompatibility = React.useCallback(() => {
    const next = !compatibility;
    setCompatibility(next);
    try {
      localStorage.setItem('kvideo_cast_compat', next ? '1' : '0');
    } catch {
      // 忽略本地存储写入异常
    }
    setAirPlayHint(null);
    void discover({ compatibility: next });
  }, [compatibility, discover]);

  /**
   * 暂停 / 继续当前 DLNA 投屏
   */
  const handleToggleLanPause = React.useCallback(async () => {
    if (!lanDevice) return;
    const action = isCasting ? 'pause' : 'resume';
    const ok = await control(action, lanDevice.controlUrl);
    if (ok) onCastingChange(!isCasting);
  }, [lanDevice, control, isCasting, onCastingChange]);

  /**
   * 停止投屏
   */
  const handleStop = React.useCallback(async () => {
    if (lanDevice) {
      await control('stop', lanDevice.controlUrl);
      setLanDevice(null);
    }
    onCastingChange(false);
    setOpen(false);
  }, [lanDevice, control, onCastingChange]);

  const isLanCasting = lanDevice !== null;
  const showCastingState = isCasting || isLanCasting;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="btn-icon"
        aria-label="投屏"
        title="投屏"
      >
        <Icons.Cast
          size={20}
          className={showCastingState ? 'text-[var(--accent-color)]' : ''}
        />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-white/10 bg-[#1a1a1a] text-white shadow-2xl z-50 overflow-hidden">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-sm font-semibold">投屏到设备</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleCompatibility}
                className="flex items-center gap-1 text-xs rounded-full px-2 py-1 border border-white/10 hover:bg-white/10"
                title="兼容模式：更广的 DLNA 搜索并发现 AirPlay（苹果）设备"
              >
                <span
                  className={`w-2 h-2 rounded-full ${compatibility ? 'bg-[var(--accent-color)]' : 'bg-white/30'}`}
                />
                兼容模式
              </button>
              <button
                type="button"
                onClick={() => void discover({ compatibility })}
                className="text-xs text-white/60 hover:text-white flex items-center gap-1"
                disabled={isDiscovering}
              >
                <Icons.RefreshCw size={14} className={isDiscovering ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
          </div>

          {/* 正在投屏：停止 / 暂停控制 */}
          {showCastingState && (
            <div className="px-2 py-2 border-b border-white/10 space-y-1">
              <div className="px-1 text-xs text-white/50">
                正在投屏{isLanCasting ? `：${lanDevice?.name}` : '（Chromecast）'}
              </div>
              {isLanCasting && (
                <button
                  type="button"
                  onClick={() => void handleToggleLanPause()}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-sm"
                >
                  {isCasting ? '暂停投屏' : '继续投屏'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleStop()}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/10 text-sm text-red-400"
              >
                停止投屏
              </button>
            </div>
          )}

          {/* 局域网设备列表 */}
          <div className="max-h-64 overflow-y-auto py-1">
            <div className="px-3 pt-1 pb-1 text-xs text-white/40">局域网设备</div>
            {isDiscovering && (
              <div className="px-3 py-2 text-sm text-white/60">正在发现设备…</div>
            )}
            {!isDiscovering && devices.length === 0 && (
              <div className="px-3 py-2 text-sm text-white/60">
                未发现设备
                <div className="text-xs text-white/40 mt-1">
                  请确认设备已开启投屏且与本机在同一局域网
                </div>
              </div>
            )}
            {devices.map((device) => (
              <button
                key={device.id}
                type="button"
                onClick={() => void handleCastToDevice(device)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center gap-2 ${
                  isLanCasting && lanDevice?.id === device.id ? 'text-[var(--accent-color)]' : ''
                }`}
              >
                <Icons.Cast size={16} className="shrink-0" />
                <span className="truncate">{device.name}</span>
                {device.protocol === 'airplay' && (
                  <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                    AirPlay
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Chromecast 入口 */}
          {isCastAvailable && (
            <div className="border-t border-white/10 py-1">
              <button
                type="button"
                onClick={() => {
                  onShowChromecastMenu();
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center gap-2"
              >
                <Icons.Cast size={16} className="shrink-0" />
                <span>Google Cast（Chromecast）</span>
              </button>
            </div>
          )}

          {/* HLS 兼容提示 */}
          {isHls && (
            <div className="px-3 py-2 text-xs text-amber-400/80 border-t border-white/10">
              当前为 HLS 流，部分电视/盒子可能不支持，建议投屏 MP4 等格式。
            </div>
          )}

          {/* AirPlay 设备提示 */}
          {airPlayHint && (
            <div className="px-3 py-2 text-xs text-amber-400 border-t border-white/10">
              {airPlayHint}
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="px-3 py-2 text-xs text-red-400 border-t border-white/10">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
