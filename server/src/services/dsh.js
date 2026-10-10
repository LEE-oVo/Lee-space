import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import net from 'node:net';
import { config } from '../config.js';
import { recordDshRun } from '../db/repo.js';

const execFileAsync = promisify(execFile);

async function systemctl(args) {
  try {
    const { stdout } = await execFileAsync('sudo', ['systemctl', ...args], { timeout: 40000 });
    return { ok: true, out: String(stdout || '').trim() };
  } catch (err) {
    return { ok: false, out: String(err?.stdout || err?.message || '').trim() };
  }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function isRunning() {
  const res = await systemctl(['is-active', config.dshService]);
  return res.out === 'active';
}

export async function readLog() {
  try {
    return await fs.readFile(config.dshLog, 'utf8');
  } catch {
    // 日志文件通常属于 dsh 用户，退回到 sudo 读取
    const res = await systemctl(['/bin/cat', config.dshLog]);
    return res.ok ? res.out : '';
  }
}

export function extractToken(logText) {
  const matches = [...String(logText).matchAll(/token=([A-Za-z0-9_\-]+)/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

export async function startDsh(actor) {
  const already = await isRunning();
  if (already) {
    recordDshRun({ userId: actor?.id, username: actor?.username, action: 'start', note: 'already-running' });
    return { ok: true, alreadyRunning: true, ...(await status()) };
  }

  const res = await systemctl(['start', config.dshService]);
  recordDshRun({ userId: actor?.id, username: actor?.username, action: 'start', note: res.ok ? 'ok' : res.out.slice(0, 200) });
  if (!res.ok) return { ok: false, error: res.out || 'systemctl start 失败' };

  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    if (await portOpen(config.dshPort)) { ready = true; break; }
  }
  if (!ready) return { ok: false, error: `DSH 启动后 ${config.dshPort} 端口未就绪` };

  let token = null;
  for (let i = 0; i < 15 && !token; i += 1) {
    token = extractToken(await readLog());
    if (!token) await sleep(1000);
  }

  invalidateStatusCache();
  await sleep(500);
  invalidateStatusCache();

  return { ok: true, ...(await status()), token };
}

export async function stopDsh(actor) {
  const res = await systemctl(['stop', config.dshService]);
  recordDshRun({ userId: actor?.id, username: actor?.username, action: 'stop', note: res.ok ? 'ok' : res.out.slice(0, 200) });
  if (!res.ok) return { ok: false, error: res.out || 'systemctl stop 失败' };
  invalidateStatusCache();
  return { ok: true, running: false };
}

export async function status() {
  const active = await isRunning();
  let pid = null;
  let startedAt = null;
  let uptime = null;

  if (active) {
    const show = await systemctl(['show', config.dshService, '--property=MainPID', '--value']);
    const raw = show.out.trim();
    if (/^\d+$/.test(raw) && Number(raw) > 0) {
      pid = Number(raw);
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'etimes=', '-p', String(pid)], { timeout: 5000 });
        const seconds = Number.parseInt(String(stdout).trim(), 10);
        if (!Number.isNaN(seconds)) {
          uptime = seconds;
          startedAt = Math.floor(Date.now() / 1000) - seconds;
        }
      } catch {
        // 进程刚退出时忽略
      }
    }
  }

  const token = active ? extractToken(await readLog()) : null;

  return {
    running: active,
    pid,
    startedAt,
    uptime,
    port: config.dshPort,
    path: config.publicPath,
    token,
  };
}

export async function tailLog(lines = 60) {
  const text = await readLog();
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}

// auth_request 会对 /dsh/ 下的每个请求（含静态资源）触发，
// 直接 systemctl 查询太慢，这里做短时效缓存。
let cache = { at: 0, value: null };

export function invalidateStatusCache() {
  cache = { at: 0, value: null };
}

export async function statusCached(maxAgeMs = 3000) {
  if (cache.value && Date.now() - cache.at < maxAgeMs) return cache.value;
  const value = await status();
  cache = { at: Date.now(), value };
  return value;
}
