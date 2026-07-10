/**
 * Auth Store - Simple module-level session management
 * NOT Zustand — needs to stay synchronous for profiled storage keys.
 */

import {
  hasResolvedPermission,
  hasRoleAtLeast,
  normalizePermissions,
  normalizeRole,
  type Permission,
  type Role,
} from '@/lib/auth/permissions';

export type { Permission, Role } from '@/lib/auth/permissions';

export interface AuthSession {
  accountId: string;
  profileId: string;
  username?: string;
  name: string;
  role: Role;
  customPermissions?: Permission[];
  mode?: 'managed' | 'legacy';
}

const SESSION_KEY = 'kvideo-session';

// 模块级内存缓存：setSession 时同步写入，getSession 时优先读取
// 解决 sessionStorage 时序问题（PasswordGate 设置 session 后子组件立即读取）
let cachedSession: AuthSession | null = null;

function isValidSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AuthSession>;
  return typeof session.accountId === 'string' &&
    typeof session.profileId === 'string' &&
    typeof session.name === 'string' &&
    typeof session.role === 'string';
}

function notifySessionChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('kvideo-session-changed'));
}

/**
 * 获取当前 session —— 优先读内存缓存，其次读 sessionStorage/localStorage
 */
export function getSession(): AuthSession | null {
  // 1. 先读内存缓存（PasswordGate setSession 后立即可用，无时序问题）
  if (cachedSession) {
    return cachedSession;
  }

  if (typeof window === 'undefined') return null;

  // 2. 回退到 storage（页面刷新后内存缓存丢失，从 storage 恢复）
  const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isValidSession(parsed)) {
      return null;
    }

    const session: AuthSession = {
      accountId: parsed.accountId,
      profileId: parsed.profileId,
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
      name: parsed.name,
      role: normalizeRole(parsed.role),
      customPermissions: normalizePermissions(parsed.customPermissions),
      mode: parsed.mode === 'managed' ? 'managed' : parsed.mode === 'legacy' ? 'legacy' : undefined,
    };

    // 恢复到内存缓存
    cachedSession = session;
    return session;
  } catch {
    return null;
  }
}

/**
 * 设置 session —— 同步写入内存缓存 + sessionStorage/localStorage
 */
export function setSession(session: AuthSession, persist: boolean): void {
  // 内存缓存：无论是否有 window 都写入（SSR 时也不影响，因为 getSession 会先检查 window）
  cachedSession = session;

  if (typeof window === 'undefined') {
    return;
  }

  const data = JSON.stringify({
    accountId: session.accountId,
    profileId: session.profileId,
    username: session.username,
    name: session.name,
    role: normalizeRole(session.role),
    customPermissions: normalizePermissions(session.customPermissions),
    mode: session.mode,
  });

  sessionStorage.setItem(SESSION_KEY, data);
  if (persist) {
    localStorage.setItem(SESSION_KEY, data);
  } else {
    localStorage.removeItem(SESSION_KEY);
  }

  notifySessionChange();
}

/**
 * 清除 session —— 清除内存缓存 + storage
 */
export function clearSession(): void {
  cachedSession = null;

  if (typeof window === 'undefined') return;

  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('kvideo_search_cache');
  sessionStorage.removeItem('kvideo-unlocked');
  localStorage.removeItem('kvideo-unlocked');
  notifySessionChange();
}

export function isAdmin(): boolean {
  const session = getSession();
  if (!session) return true;
  return session.role === 'admin' || session.role === 'super_admin';
}

export function hasPermission(permission: Permission): boolean {
  const session = getSession();
  if (!session) return true;
  return hasResolvedPermission(session.role, permission, session.customPermissions);
}

export function hasRole(minimumRole: Role): boolean {
  const session = getSession();
  if (!session) return true;
  return hasRoleAtLeast(session.role, minimumRole);
}

export function getProfileId(): string {
  return getSession()?.profileId || '';
}
