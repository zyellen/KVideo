#!/usr/bin/env node
/**
 * 批量探测所有视频源的可用性。
 *
 * 复刻服务端 lib/api/search-api.ts 的请求逻辑：
 *   GET {baseUrl}{searchPath}?ac=detail&wd=<query>&pg=1
 *   Header: User-Agent: Mozilla/5.0
 *
 * 用法:
 *   node scripts/probe-sources.mjs [query]
 * 默认 query 为「花开锦绣」，可自定义，例如:
 *   node scripts/probe-sources.mjs 测试
 *
 * 输出:
 *   - 控制台打印每个源的探测结果（状态、耗时、命中数）
 *   - 生成 scripts/available-sources.json（仅含可用源，可直接用于前端/设置导入）
 */

const QUERY = process.argv[2] || '花开锦绣';
const TIMEOUT_MS = 15000;
const CONCURRENCY = 8;

// 与默认 56 个源保持一致（来自前端设置 / 用户订阅）
const SOURCES = [
  { id: 'feifan', name: '非凡资源', baseUrl: 'http://ffzy5.tv/api.php/provide/vod' },
  { id: 'wolong', name: '卧龙资源', baseUrl: 'https://wolongzyw.com/api.php/provide/vod' },
  { id: 'zuida', name: '最大资源', baseUrl: 'https://api.zuidapi.com/api.php/provide/vod' },
  { id: 'baiduyun', name: '百度云资源', baseUrl: 'https://api.apibdzy.com/api.php/provide/vod' },
  { id: 'baofeng', name: '暴风资源', baseUrl: 'https://bfzyapi.com/api.php/provide/vod' },
  { id: 'jisu', name: '极速资源', baseUrl: 'https://jszyapi.com/api.php/provide/vod' },
  { id: 'tianya', name: '天涯资源', baseUrl: 'https://tyyszy.com/api.php/provide/vod' },
  { id: 'wujin', name: '无尽资源', baseUrl: 'https://api.wujinapi.com/api.php/provide/vod' },
  { id: 'modu', name: '魔都资源', baseUrl: 'https://www.mdzyapi.com/api.php/provide/vod' },
  { id: 'sanliuling', name: '360资源', baseUrl: 'https://360zy.com/api.php/provide/vod' },
  { id: 'dytt', name: '电影天堂', baseUrl: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
  { id: 'ruyi', name: '如意资源', baseUrl: 'https://cj.rycjapi.com/api.php/provide/vod' },
  { id: 'wangwang', name: '旺旺资源', baseUrl: 'https://wwzy.tv/api.php/provide/vod' },
  { id: 'hongniu', name: '红牛资源', baseUrl: 'https://www.hongniuzy2.com/api.php/provide/vod' },
  { id: 'guangsu', name: '光速资源', baseUrl: 'https://api.guangsuapi.com/api.php/provide/vod' },
  { id: 'ikun', name: 'iKun资源', baseUrl: 'https://ikunzyapi.com/api.php/provide/vod' },
  { id: 'youku', name: '优酷资源', baseUrl: 'https://api.ukuapi.com/api.php/provide/vod' },
  { id: 'huya', name: '虎牙资源', baseUrl: 'https://www.huyaapi.com/api.php/provide/vod' },
  { id: 'xinlang', name: '新浪资源', baseUrl: 'http://api.xinlangapi.com/xinlangapi.php/provide/vod' },
  { id: 'lezi', name: '乐子资源', baseUrl: 'https://cj.lziapi.com/api.php/provide/vod' },
  { id: 'haihua', name: '海豚资源', baseUrl: 'https://hhzyapi.com/api.php/provide/vod' },
  { id: 'jiangyu', name: '鲸鱼资源', baseUrl: 'https://jyzyapi.com/provide/vod' },
  { id: 'aidan', name: '爱蛋资源', baseUrl: 'https://lovedan.net/api.php/provide/vod' },
  { id: 'moduzy', name: '魔都影视', baseUrl: 'https://www.moduzy.com/api.php/provide/vod' },
  { id: 'feifanapi', name: '非凡API', baseUrl: 'https://api.ffzyapi.com/api.php/provide/vod' },
  { id: 'feifancj', name: '非凡采集', baseUrl: 'http://cj.ffzyapi.com/api.php/provide/vod' },
  { id: 'feifancj2', name: '非凡采集HTTPS', baseUrl: 'https://cj.ffzyapi.com/api.php/provide/vod' },
  { id: 'feifan1', name: '非凡线路1', baseUrl: 'http://ffzy1.tv/api.php/provide/vod' },
  { id: 'wolong2', name: '卧龙采集', baseUrl: 'https://collect.wolongzyw.com/api.php/provide/vod' },
  { id: 'baofeng2', name: '暴风APP', baseUrl: 'https://app.bfzyapi.com/api.php/provide/vod' },
  { id: 'wujin2', name: '无尽ME', baseUrl: 'https://api.wujinapi.me/api.php/provide/vod' },
  { id: 'tianyazy', name: '天涯海角', baseUrl: 'https://tyyszyapi.com/api.php/provide/vod' },
  { id: 'guangsu2', name: '光速HTTP', baseUrl: 'http://api.guangsuapi.com/api.php/provide/vod' },
  { id: 'xinlang2', name: '新浪HTTPS', baseUrl: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod' },
  { id: 'yilingba2', name: '1080JSON', baseUrl: 'https://api.1080zyku.com/inc/apijson.php' },
  { id: 'lezi2', name: '乐子HTTP', baseUrl: 'http://cj.lziapi.com/api.php/provide/vod' },
  { id: 'uku88', name: 'U酷资源88', baseUrl: 'https://api.ukuapi88.com/api.php/provide/vod' },
  { id: 'wujincc', name: '无尽CC', baseUrl: 'https://api.wujinapi.cc/api.php/provide/vod' },
  { id: 'yaya', name: '丫丫点播', baseUrl: 'https://cj.yayazy.net/api.php/provide/vod' },
  { id: 'wolongcc', name: '卧龙CC', baseUrl: 'https://collect.wolongzy.cc/api.php/provide/vod' },
  { id: 'wujinnet', name: '无尽NET', baseUrl: 'https://api.wujinapi.net/api.php/provide/vod' },
  { id: 'wangwangapi', name: '旺旺API', baseUrl: 'https://api.wwzy.tv/api.php/provide/vod' },
  { id: 'zuidame', name: '最大点播', baseUrl: 'http://zuidazy.me/api.php/provide/vod' },
  { id: 'yinghua', name: '樱花资源', baseUrl: 'https://m3u8.apiyhzy.com/api.php/provide/vod' },
  { id: 'bubugao', name: '步步高资源', baseUrl: 'https://api.yparse.com/api/json' },
  { id: 'niuniu', name: '牛牛点播', baseUrl: 'https://api.niuniuzy.me/api.php/provide/vod' },
  { id: 'suoni', name: '索尼资源', baseUrl: 'https://suoniapi.com/api.php/provide/vod' },
  { id: 'maotai', name: '茅台资源', baseUrl: 'https://caiji.maotaizy.cc/api.php/provide/vod' },
  { id: 'dbzy', name: '豆瓣资源', baseUrl: 'https://dbzy.tv/api.php/provide/vod' },
  { id: 'subo', name: '速博资源', baseUrl: 'https://subocaiji.com/api.php/provide/vod' },
  { id: 'jinying', name: '金鹰点播', baseUrl: 'https://jinyingzy.com/api.php/provide/vod' },
  { id: 'shandian', name: '閃電资源', baseUrl: 'https://sdzyapi.com/api.php/provide/vod' },
  { id: 'piaoling', name: '飘零资源', baseUrl: 'https://p2100.net/api.php/provide/vod' },
  { id: 'modudongman', name: '魔都动漫', baseUrl: 'https://caiji.moduapi.cc/api.php/provide/vod' },
  { id: 'hongniu3', name: '红牛资源3', baseUrl: 'https://www.hongniuzy3.com/api.php/provide/vod' },
  { id: 'suonisd', name: '索尼-闪电', baseUrl: 'https://xsd.sdzyapi.com/api.php/provide/vod' },
];

/**
 * 探测单个源：复刻服务端请求逻辑
 * @param {object} source 源配置
 * @returns {Promise<object>} 探测结果
 */
const probeSource = async (source) => {
  const startTime = Date.now();
  const url = new URL(`${source.baseUrl}`);
  url.searchParams.set('ac', 'detail');
  url.searchParams.set('wd', QUERY);
  url.searchParams.set('pg', '1');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ...source,
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}: ${res.statusText}`,
        cost: Date.now() - startTime,
        hits: 0,
      };
    }

    const data = await res.json();
    const hits = Array.isArray(data.list) ? data.list.length : 0;
    // 兼容部分接口返回 code 表示失败的情况
    const apiOk = data.code === 1 || data.code === 0 || data.code === undefined;

    return {
      ...source,
      ok: apiOk,
      status: res.status,
      cost: Date.now() - startTime,
      hits,
      pagecount: data.pagecount ?? 1,
      error: apiOk ? null : (data.msg || 'Invalid API response'),
    };
  } catch (err) {
    return {
      ...source,
      ok: false,
      status: 0,
      error: err.name === 'AbortError' ? `Timeout > ${TIMEOUT_MS}ms` : err.message,
      cost: Date.now() - startTime,
      hits: 0,
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 并发控制执行探测
 * @param {Array} items 待探测源
 * @param {number} limit 并发数
 * @param {Function} worker 单任务处理函数
 * @returns {Promise<Array>} 结果数组
 */
const runWithConcurrency = async (items, limit, worker) => {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => worker(item));
    results.push(p);
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
};

const main = async () => {
  console.log(`开始探测 ${SOURCES.length} 个源, query="${QUERY}", 并发=${CONCURRENCY}, 超时=${TIMEOUT_MS}ms\n`);

  const results = await runWithConcurrency(SOURCES, CONCURRENCY, probeSource);

  const available = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log('========== 可用源 ==========');
  available.forEach((r) =>
    console.log(`✅ ${r.name.padEnd(12)} ${r.id.padEnd(14)} hits=${r.hits} ${r.cost}ms ${r.baseUrl}`)
  );

  console.log('\n========== 不可用源 ==========');
  failed.forEach((r) =>
    console.log(`❌ ${r.name.padEnd(12)} ${r.id.padEnd(14)} [${r.error}] ${r.baseUrl}`)
  );

  console.log(`\n汇总: 可用 ${available.length} / ${results.length}, 失败 ${failed.length}`);

  // 生成可直接导入的可用源清单（保留 id/name/baseUrl）
  const exportList = available.map(({ id, name, baseUrl }) => ({ id, name, baseUrl }));
  const fs = await import('node:fs');
  const outPath = new URL('./available-sources.json', import.meta.url);
  fs.writeFileSync(outPath, JSON.stringify(exportList, null, 2), 'utf-8');
  console.log(`\n已生成可用源清单: ${outPath.pathname}`);
};

main().catch((err) => {
  console.error('探测脚本执行失败:', err);
  process.exit(1);
});
