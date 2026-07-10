import { useRef } from 'react';

interface DoubleTapHandler {
    /** 双击左侧区域回调（快退） */
    onDoubleTapLeft: () => void;
    /** 双击右侧区域回调（快进） */
    onDoubleTapRight: () => void;
    /** 双击中间区域回调（暂停/播放） */
    onDoubleTapCenter?: () => void;
    /** 单击回调（切换控件显示） */
    onSingleTap: () => void;
    /** 连续点击左侧时继续快退 */
    onSkipContinueLeft: () => void;
    /** 连续点击右侧时继续快进 */
    onSkipContinueRight: () => void;
    /** 快进/快退指示器是否正在显示 */
    isSkipModeActive: boolean;
}

/** 左右区域划分的边界比例，左侧占 30%，右侧占 30%，中间占 40% */
const LEFT_ZONE_RATIO = 0.3;
const RIGHT_ZONE_RATIO = 0.7;

/**
 * 处理双击手势的 Hook
 * 将视频区域划分为左（快退）、中（暂停/播放）、右（快进）三个区域
 * 支持双击和连续快速点击（跳过模式）
 */
export const useDoubleTap = ({
    onDoubleTapLeft,
    onDoubleTapRight,
    onDoubleTapCenter,
    onSingleTap,
    onSkipContinueLeft,
    onSkipContinueRight,
    isSkipModeActive,
}: DoubleTapHandler) => {
    const lastTapRef = useRef<{ time: number; zone: 'left' | 'right' | 'center' | null }>({
        time: 0,
        zone: null,
    });
    const singleTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    /**
     * 根据触摸位置判断所属区域
     * @param x - 触摸点在视频元素内的水平偏移
     * @param width - 视频元素宽度
     * @returns 'left' | 'right' | 'center'
     */
    const getZone = (x: number, width: number): 'left' | 'right' | 'center' => {
        const ratio = x / width;
        if (ratio < LEFT_ZONE_RATIO) return 'left';
        if (ratio > RIGHT_ZONE_RATIO) return 'right';
        return 'center';
    };

    /**
     * 处理触摸事件
     * 支持单击、双击左/右/中、连续快速点击
     */
    const handleTap = (e: React.TouchEvent<HTMLVideoElement | HTMLDivElement>) => {
        const currentTime = Date.now();
        const targetElement = e.currentTarget;
        const touch = e.touches[0] || e.changedTouches[0];

        if (!touch || !targetElement) return;

        // 计算触摸位置和所属区域
        const rect = targetElement.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const width = rect.width;
        const zone = getZone(x, width);

        const timeDiff = currentTime - lastTapRef.current.time;
        const sameZone = lastTapRef.current.zone === zone;

        // 清除待执行的单击定时器
        if (singleTapTimeoutRef.current) {
            clearTimeout(singleTapTimeoutRef.current);
            singleTapTimeoutRef.current = null;
        }

        // 如果跳过模式正在激活，单击继续快进/快退
        if (isSkipModeActive) {
            if (zone === 'left') {
                onSkipContinueLeft();
            } else if (zone === 'right') {
                onSkipContinueRight();
            } else {
                // 中间区域在跳过模式下执行暂停/播放
                onDoubleTapCenter?.();
            }
            lastTapRef.current = { time: currentTime, zone };
            return;
        }

        // 双击检测（300ms 内同一区域的第二次点击）
        if (timeDiff < 300 && sameZone) {
            e.preventDefault();

            if (zone === 'left') {
                onDoubleTapLeft();
            } else if (zone === 'right') {
                onDoubleTapRight();
            } else {
                onDoubleTapCenter?.();
            }

            // 重置以防止三击误触
            lastTapRef.current = { time: 0, zone: null };
        } else {
            // 可能是单击，等待判断是否有第二次点击
            lastTapRef.current = { time: currentTime, zone };

            singleTapTimeoutRef.current = setTimeout(() => {
                // 300ms 内没有第二次点击，执行单击操作
                onSingleTap();
                singleTapTimeoutRef.current = null;
            }, 300);
        }
    };

    return { handleTap };
};
