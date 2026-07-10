'use client';

import { useEffect, useRef } from 'react';
import { useHistoryStore } from '@/lib/store/history-store';
import { useFavoritesStore } from '@/lib/store/favorites-store';
import { useCloudSync } from '@/lib/hooks/useCloudSync';
import { useConfigSync } from '@/lib/hooks/useConfigSync';
import { getSession } from '@/lib/store/auth-store';

// 防抖函数，防止频繁请求
function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function AutoSync() {
  const { pushToCloud, pullFromCloud } = useCloudSync();
  // 标记是否正在从云端拉取数据，避免拉取后立即触发推送
  const isPullingRef = useRef(false);

  // Config sync (sources, settings) — works without Redis, file-based
  useConfigSync();

  useEffect(() => {
    const session = getSession();
    if (!session) return; // 未登录不进行同步

    // 1. 刚打开网页时，主动从云端拉取一次最新数据
    isPullingRef.current = true;
    pullFromCloud().finally(() => {
      isPullingRef.current = false;
    });

    // 2. 监听本地数据的变化，如果数据变了，延迟 5 秒后推送到云端
    const debouncedPush = debounce(() => {
      // 拉取过程中不推送，避免覆盖刚拉取的云端数据
      if (isPullingRef.current) return;
      pushToCloud();
    }, 5000);

    // Zustand v4/v5 默认 subscribe 只接受一个参数
    const unsubHistory = useHistoryStore.subscribe(() => {
      debouncedPush();
    });

    const unsubFavorites = useFavoritesStore.subscribe(() => {
      debouncedPush();
    });

    return () => {
      unsubHistory();
      unsubFavorites();
    };
  }, [pushToCloud, pullFromCloud]);

  return null; // 这是一个静默组件，不需要渲染任何UI
}
