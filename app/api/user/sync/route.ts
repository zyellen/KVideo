import { Redis } from '@upstash/redis/cloudflare';
import { NextRequest, NextResponse } from 'next/server';
import { authenticationRequiredResponse } from '@/lib/server/api-responses';
import { getServerSession } from '@/lib/server/auth';

export const runtime = 'edge';

// 缓存 Redis 客户端实例，避免重复创建
let cachedRedis: Redis | null | undefined;

/**
 * 安全获取 Redis 客户端，未配置时返回 null 而非抛出异常
 */
function getRedisClient(): Redis | null {
  if (cachedRedis !== undefined) {
    return cachedRedis;
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    cachedRedis = null;
    return cachedRedis;
  }

  cachedRedis = Redis.fromEnv();
  return cachedRedis;
}

/**
 * 获取用户同步数据 —— 跨设备收藏/历史记录的基础
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(request);
  const profileId = session?.profileId;

  if (!profileId) {
    return authenticationRequiredResponse();
  }

  const redis = getRedisClient();
  if (!redis) {
    // Redis 未配置，返回空数据而非报错，让客户端继续使用本地存储
    return NextResponse.json({
      success: true,
      data: { history: [], favorites: [] },
      syncEnabled: false,
    });
  }

  try {
    const data = await redis.get(`user:sync:${profileId}`);
    return NextResponse.json({
      success: true,
      data: data || { history: [], favorites: [] },
      syncEnabled: true,
    });
  } catch (error) {
    console.error('Redis Get Error:', error);
    return NextResponse.json({
      success: true,
      data: { history: [], favorites: [] },
      syncEnabled: false,
    });
  }
}

/**
 * 保存用户同步数据 —— 推送本地收藏/历史到云端
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(request);
  const profileId = session?.profileId;

  if (!profileId) {
    return authenticationRequiredResponse();
  }

  const redis = getRedisClient();
  if (!redis) {
    // Redis 未配置，静默返回成功，客户端不会反复重试
    return NextResponse.json({ success: true, syncEnabled: false });
  }

  try {
    const body = await request.json();
    const { history, favorites } = body;

    await redis.set(`user:sync:${profileId}`, { history, favorites });

    return NextResponse.json({ success: true, syncEnabled: true });
  } catch (error) {
    console.error('Redis Set Error:', error);
    return NextResponse.json({ success: true, syncEnabled: false });
  }
}
