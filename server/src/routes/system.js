import express from 'express';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requirePermission } from '../middleware/auth.js';
import { statusCached } from '../services/dsh.js';
import { metrics } from '../services/metrics.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

async function readDisk() {
  const fallback = { totalGb: 0, freeGb: 0, usedGb: 0 };
  try {
    const { stdout } = await execFileAsync('df', ['-kP', '/']);
    const parts = String(stdout).trim().split('\n')[1]?.split(/\s+/) || [];
    if (parts.length < 4) return fallback;
    const totalGb = +(Number(parts[1]) * 1024 / 1024 ** 3).toFixed(1);
    const freeGb = +(Number(parts[3]) * 1024 / 1024 ** 3).toFixed(1);
    return { totalGb, freeGb, usedGb: +(totalGb - freeGb).toFixed(1) };
  } catch {
    return fallback;
  }
}

async function readMemory() {
  const totalMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  const base = {
    totalMb,
    freeMb,
    usedMb: Math.max(0, totalMb - freeMb),
    cachedMb: 0,
    availableMb: freeMb,
    swap: { totalMb: 0, freeMb: 0, usedMb: 0 },
  };
  try {
    const { stdout } = await execFileAsync('free', ['-m']);
    const memLine = String(stdout).split('\n').find((l) => l.startsWith('Mem:'));
    if (memLine) {
      const p = memLine.split(/\s+/);
      base.totalMb = Number(p[1]) || base.totalMb;
      base.usedMb = Number(p[2]) || base.usedMb;
      base.freeMb = Number(p[3]) || base.freeMb;
      base.cachedMb = Number(p[5]) || 0;
      base.availableMb = Number(p[6]) || base.freeMb;
    }
    const swapLine = String(stdout).split('\n').find((l) => l.startsWith('Swap:'));
    if (swapLine) {
      const s = swapLine.split(/\s+/);
      const swapTotal = Number(s[1]) || 0;
      const swapFree = Number(s[3]) || 0;
      base.swap = { totalMb: swapTotal, freeMb: swapFree, usedMb: Math.max(0, swapTotal - swapFree) };
    }
  } catch {
    // 忽略，使用 os 模块的结果
  }
  return base;
}

router.get('/stats', requirePermission('system:view'), async (_req, res) => {
  const [disk, mem, dsh] = await Promise.all([readDisk(), readMemory(), statusCached(2000)]);
  const m = metrics();

  res.json({
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg().map((n) => +n.toFixed(2)),
    // 新增：真实 CPU 使用率（后台 2 秒采样）、网络速率、进程数
    cpu: m.cpu,
    net: m.net,
    procs: m.procs,
    mem: {
      totalMb: mem.totalMb,
      freeMb: mem.freeMb,
      usedMb: mem.usedMb,
      cachedMb: mem.cachedMb,
      availableMb: mem.availableMb,
    },
    swap: mem.swap,
    disk,
    uptimeSeconds: Math.round(os.uptime()),
    dsh: { running: dsh.running, pid: dsh.pid, uptime: dsh.uptime },
    ts: Date.now(),
  });
});

export default router;
