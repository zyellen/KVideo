import React from 'react';
import { Icons } from '@/components/ui/Icon';
import { CastMenu } from './CastMenu';



interface DesktopRightControlsProps {
    isNativeFullscreen: boolean;
    isWebFullscreen: boolean;
    isPiPSupported: boolean;
    isAirPlaySupported: boolean;
    isCastAvailable: boolean;
    /** 当前播放地址，用于投屏到局域网设备 */
    src: string;
    /** 视频元素引用，用于读取投屏起始进度 */
    videoRef: React.RefObject<HTMLVideoElement | null>;
    /** 是否正在投屏（含 Chromecast） */
    isCasting: boolean;
    /** 通知播放器更新投屏状态 */
    onCastingChange: (casting: boolean) => void;
    onToggleNativeFullscreen: () => void;
    onToggleWebFullscreen: () => void;
    onTogglePictureInPicture: () => void;
    onShowAirPlayMenu: () => void;
    onShowCastMenu: () => void;
}

export function DesktopRightControls({
    isNativeFullscreen,
    isWebFullscreen,
    isPiPSupported,
    isAirPlaySupported,
    isCastAvailable,
    src,
    videoRef,
    isCasting,
    onCastingChange,
    onToggleNativeFullscreen,
    onToggleWebFullscreen,
    onTogglePictureInPicture,
    onShowAirPlayMenu,
    onShowCastMenu
}: DesktopRightControlsProps) {
    return (
        <div className="relative z-50 flex items-center gap-3">
            {/* Picture-in-Picture */}
            {
                isPiPSupported && (
                    <button
                        onClick={onTogglePictureInPicture}
                        className="btn-icon"
                        aria-label="画中画"
                        title="画中画"
                    >
                        <Icons.PictureInPicture size={20} />
                    </button>
                )
            }

            {/* AirPlay */}
            {
                isAirPlaySupported && (
                    <button
                        onClick={onShowAirPlayMenu}
                        className="btn-icon"
                        aria-label="隔空播放"
                        title="隔空播放"
                    >
                        <Icons.Airplay size={20} />
                    </button>
                )
            }

            {/* 投屏（局域网设备 / Chromecast） */}
            <CastMenu
                src={src}
                videoRef={videoRef}
                isCastAvailable={isCastAvailable}
                isCasting={isCasting}
                onCastingChange={onCastingChange}
                onShowChromecastMenu={onShowCastMenu}
            />

            {/* Web Fullscreen */}
            <button
                onClick={onToggleWebFullscreen}
                className="btn-icon"
                aria-label={isWebFullscreen ? '退出网页全屏' : '网页全屏'}
                title={isWebFullscreen ? '退出网页全屏 (W)' : '网页全屏 (W)'}
            >
                <Icons.Target size={20} className={isWebFullscreen ? 'text-[var(--accent-color)]' : ''} />
            </button>

            {/* Native Fullscreen */}
            <button
                onClick={onToggleNativeFullscreen}
                className="btn-icon"
                aria-label={isNativeFullscreen ? '退出系统全屏' : '系统全屏'}
                title={isNativeFullscreen ? '退出系统全屏 (F)' : '系统全屏 (F)'}
            >
                {isNativeFullscreen ? <Icons.Minimize size={20} /> : <Icons.Maximize size={20} />}
            </button>
        </div >
    );
}
