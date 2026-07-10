#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
const forwardedArgs = process.argv.slice(3);
const validModes = new Set(['dev', 'start']);

if (!validModes.has(mode)) {
  console.error('Usage: node scripts/next-with-lan-access.mjs <dev|start> [next args...]');
  process.exit(1);
}

/**
 * 从 .env.local 文件中加载环境变量到 process.env
 * Next.js 的 .env.local 只在 server 启动后才加载，
 * 但本脚本在 spawn 之前就需要读取 ALLOW_LAN_ACCESS，
 * 所以需要手动预加载
 */
const loadEnvLocal = () => {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      // 不覆盖已有的系统环境变量
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
};

loadEnvLocal();

function isTruthyEnv(value) {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable'].includes(
    value.trim().toLowerCase()
  );
}

const lanAccessEnabled = isTruthyEnv(
  process.env.ALLOW_LAN_ACCESS ?? process.env.NEXT_PUBLIC_ALLOW_LAN_ACCESS
);
const hostname = process.env.HOSTNAME || process.env.NEXT_HOSTNAME || (lanAccessEnabled ? '0.0.0.0' : 'localhost');
const args = [mode, '--port', process.env.PORT || '3001'];

if (hostname) {
  args.push('--hostname', hostname);
}

args.push(...forwardedArgs);

const child = spawn('next', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
