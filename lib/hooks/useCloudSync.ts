import { useState, useCallback } from 'react';
import { useHistoryStore, usePremiumHistoryStore } from '@/lib/store/history-store';
import { useFavoritesStore, usePremiumFavoritesStore } from '@/lib/store/favorites-store';
import { getProfileId } from '@/lib/store/auth-store';
import type { FavoriteItem, VideoHistoryItem } from '@/lib/types';

/**
 * 合并历史记录：按 showIdentifier 去重，保留更新的时间戳
 */
function mergeHistory(local: VideoHistoryItem[], cloud: VideoHistoryItem[]): VideoHistoryItem[] {
  const merged = new Map<string, VideoHistoryItem>();

  // 先放入本地数据
  for (const item of local) {
    const key = item.showIdentifier || `title:${item.title.toLowerCase().trim()}`;
    merged.set(key, item);
  }

  // 用云端数据覆盖/补充（云端时间戳更新时覆盖）
  for (const item of cloud) {
    const key = item.showIdentifier || `title:${item.title.toLowerCase().trim()}`;
    const existing = merged.get(key);
    if (!existing || item.timestamp > existing.timestamp) {
      merged.set(key, item);
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 合并收藏：按 source:videoId 去重
 */
function mergeFavorites(local: FavoriteItem[], cloud: FavoriteItem[]): FavoriteItem[] {
  const seen = new Set<string>();
  const merged: FavoriteItem[] = [];

  for (const item of [...cloud, ...local]) {
    const id = `${item.source}:${item.videoId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }

  return merged;
}

export function useCloudSync(isPremium = false) {
  const [isSyncing, setIsSyncing] = useState(false);

  const historyStore = isPremium ? usePremiumHistoryStore : useHistoryStore;
  const favoritesStore = isPremium ? usePremiumFavoritesStore : useFavoritesStore;

  const pullFromCloud = useCallback(async () => {
    const profileId = getProfileId();
    if (!profileId) return;

    setIsSyncing(true);
    try {
      const response = await fetch('/api/user/sync');
      const result = await response.json();

      if (result.success && result.data) {
        // 合并云端数据到本地，而非直接覆盖
        if (result.data.history?.length > 0) {
          const localHistory = historyStore.getState().viewingHistory;
          const merged = mergeHistory(localHistory, result.data.history);
          historyStore.getState().importHistory(merged);
        }
        if (result.data.favorites?.length > 0) {
          const localFavorites = favoritesStore.getState().favorites;
          const merged = mergeFavorites(localFavorites, result.data.favorites);
          favoritesStore.getState().importFavorites(merged);
        }
      }
    } catch (error) {
      console.error('Failed to pull from cloud:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [historyStore, favoritesStore]);

  const pushToCloud = useCallback(async () => {
    const profileId = getProfileId();
    if (!profileId) return;

    setIsSyncing(true);
    try {
      const currentHistory = historyStore.getState().viewingHistory;
      const currentFavorites = favoritesStore.getState().favorites;

      await fetch('/api/user/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          history: currentHistory,
          favorites: currentFavorites
        })
      });
    } catch (error) {
      console.error('Failed to push to cloud:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [historyStore, favoritesStore]);

  return { pushToCloud, pullFromCloud, isSyncing };
}
