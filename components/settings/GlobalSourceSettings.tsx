'use client';

import { useState, useEffect } from 'react';
import { SettingsSection } from './SettingsSection';
import { Icons } from '@/components/ui/Icon';
import { hasPermission } from '@/lib/store/auth-store';
import type { VideoSource } from '@/lib/types';

export function GlobalSourceSettings() {
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const canManage = hasPermission('source_management');

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/global-sources');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.success) {
            setSources(data.sources ?? []);
          }
        }
      } catch {
        if (!cancelled) setError('加载失败，请稍后重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const saveSources = async (next: VideoSource[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/global-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: next }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? '没有权限修改全局视频源' : '保存失败，请稍后重试');
        return false;
      }
      setSources(next);
      setError('');
      return true;
    } catch {
      setError('网络错误，保存失败');
      return false;
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) {
      setError('名称和接口地址不能为空');
      return;
    }
    try {
      new URL(baseUrl);
    } catch {
      setError('请输入有效的 URL');
      return;
    }

    const id = `global-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
    const source: VideoSource = {
      id,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      searchPath: '/provide/vod',
      detailPath: '/provide/vod',
      enabled: true,
    };
    const ok = await saveSources([...sources, source]);
    if (ok) {
      setName('');
      setBaseUrl('');
    }
  };

  const handleToggle = async (id: string) => {
    const next = sources.map(s =>
      s.id === id ? { ...s, enabled: s.enabled !== false ? false : true } : s
    );
    await saveSources(next);
  };

  const handleDelete = async (id: string) => {
    await saveSources(sources.filter(s => s.id !== id));
  };

  if (!canManage) return null;

  return (
    <SettingsSection title="全局视频源" description="管理员统一维护，对所有账户生效。">
      <div className="space-y-4">
        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              placeholder="源名称"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              className="flex-1 px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-2xl)] text-sm text-[var(--text-color)] placeholder:text-[var(--text-color-secondary)]/50 focus:outline-none focus:border-[var(--accent-color)]"
            />
            <input
              type="text"
              placeholder="接口地址 (https://...)"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setError(''); }}
              className="flex-[2] px-3 py-2 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-2xl)] text-sm text-[var(--text-color)] placeholder:text-[var(--text-color-secondary)]/50 focus:outline-none focus:border-[var(--accent-color)]"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--accent-color)] text-white rounded-[var(--radius-2xl)] text-sm font-medium hover:brightness-110 transition-all cursor-pointer flex items-center gap-1"
            >
              <Icons.Plus size={14} />
              添加
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </form>

        {/* Source list */}
        {loading ? (
          <p className="text-xs text-[var(--text-color-secondary)] text-center py-4">
            加载中...
          </p>
        ) : (
          <>
            {sources.length > 0 && (
              <div className="space-y-2">
                {sources.map(source => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between px-4 py-2.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-[var(--radius-2xl)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => handleToggle(source.id)}
                        className={`w-8 h-5 rounded-full transition-colors cursor-pointer relative flex-shrink-0 ${source.enabled !== false ? 'bg-[var(--accent-color)]' : 'bg-[var(--glass-border)]'
                          }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${source.enabled !== false ? 'left-3.5' : 'left-0.5'
                          }`} />
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-color)] truncate">{source.name}</p>
                        <p className="text-[10px] text-[var(--text-color-secondary)] truncate">{source.baseUrl}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(source.id)}
                      className="p-1 text-[var(--text-color-secondary)] hover:text-red-500 transition-colors cursor-pointer flex-shrink-0"
                    >
                      <Icons.Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sources.length === 0 && (
              <p className="text-xs text-[var(--text-color-secondary)] text-center py-4">
                还没有全局视频源，添加一个试试吧。
              </p>
            )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}
