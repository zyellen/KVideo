import { useRef, useCallback, useState } from 'react';

interface SwipeGestureHandlers {
    /** 滑动快进回调，参数为滑动的秒数 */
    onSeekForward: (seconds: number) => void;
    /** 滑动快退回调，参数为滑动的秒数 */
    onSeekBackward: (seconds) => void;
    /** 滑动开始回调 */
    onSwipeStart?: () => void;
    /** 滑动结束回调 */
    onSwipeEnd?: () => void;
    /** 视频总时长，用于计算滑动比例对应的秒数 */
    duration: number;
}

/** 最小滑动距离阈值（像素），低于此值不触发快进/快退 */
const MIN_SWIPE_DISTANCE = 30;

/** 滑动距离与时间换算比例：每像素对应的秒数 */
const PIXELS_TO_SECONDS_RATIO = 0.08;

/**
 * 处理水平滑动手势的 Hook
 * 支持触摸滑动快进/快退，滑动距离越大跳转秒数越多
 */
export const useSwipeGesture = ({
    onSeekForward,
    onSeekBackward,
    onSwipeStart,
    onSwipeEnd,
    duration,
}: SwipeGestureHandlers) => {
    /** 滑动起始点坐标 */
    const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
    /** 是否正在水平滑动中 */
    const isSwipingRef = useRef(false);
    /** 当前滑动累计偏移量（秒数），用于实时显示指示器 */
    const [swipeSeekOffset, setSwipeSeekOffset] = useState(0);
    /** 滑动方向 */
    const [swipeDirection, setSwipeDirection] = useState<'forward' | 'backward' | null>(null);

    /**
     * 处理触摸开始事件
     * 记录起始坐标，用于后续计算滑动距离
     */
    const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement | HTMLVideoElement>) => {
        const touch = e.touches[0];
        if (!touch) return;

        swipeStartRef.current = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
        };
        isSwipingRef.current = false;
        setSwipeSeekOffset(0);
        setSwipeDirection(null);
    }, []);

    /**
     * 处理触摸移动事件
     * 当水平滑动超过阈值时，实时计算偏移秒数并更新指示器
     */
    const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement | HTMLVideoElement>) => {
        if (!swipeStartRef.current) return;

        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - swipeStartRef.current.x;
        const deltaY = touch.clientY - swipeStartRef.current.y;

        // 判断是否为水平滑动（水平位移大于垂直位移且超过阈值）
        if (!isSwipingRef.current) {
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > MIN_SWIPE_DISTANCE) {
                isSwipingRef.current = true;
                onSwipeStart?.();
            } else {
                return;
            }
        }

        // 阻止页面滚动
        e.preventDefault();

        // 根据滑动像素距离计算偏移秒数
        const seconds = Math.abs(deltaX) * PIXELS_TO_SECONDS_RATIO;
        // 限制最大偏移不超过视频总时长的一半
        const clampedSeconds = Math.min(seconds, duration * 0.5);

        const direction = deltaX > 0 ? 'forward' : 'backward';
        setSwipeSeekOffset(clampedSeconds);
        setSwipeDirection(direction);
    }, [duration, onSwipeStart]);

    /**
     * 处理触摸结束事件
     * 当水平滑动结束时，执行最终的快进/快退跳转
     */
    const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement | HTMLVideoElement>) => {
        if (!swipeStartRef.current) {
            swipeStartRef.current = null;
            isSwipingRef.current = false;
            setSwipeSeekOffset(0);
            setSwipeDirection(null);
            return;
        }

        const touch = e.changedTouches[0];
        if (!touch) {
            swipeStartRef.current = null;
            isSwipingRef.current = false;
            setSwipeSeekOffset(0);
            setSwipeDirection(null);
            return;
        }

        const deltaX = touch.clientX - swipeStartRef.current.x;

        // 只有确认是水平滑动且超过阈值才执行跳转
        if (isSwipingRef.current && Math.abs(deltaX) > MIN_SWIPE_DISTANCE) {
            const seconds = Math.abs(deltaX) * PIXELS_TO_SECONDS_RATIO;
            const clampedSeconds = Math.min(seconds, duration * 0.5);

            if (deltaX > 0) {
                onSeekForward(clampedSeconds);
            } else {
                onSeekBackward(clampedSeconds);
            }
        }

        onSwipeEnd?.();

        // 重置状态
        swipeStartRef.current = null;
        isSwipingRef.current = false;
        setSwipeSeekOffset(0);
        setSwipeDirection(null);
    }, [duration, onSeekForward, onSeekBackward, onSwipeEnd]);

    /** 是否正在滑动中（用于外部判断是否需要抑制其他手势） */
    const isSwiping = isSwipingRef.current;

    return {
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        swipeSeekOffset,
        swipeDirection,
        isSwiping,
    };
};
