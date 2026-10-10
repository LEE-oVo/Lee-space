import express from 'express';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requirePermission } from '../middleware/auth.js';
import { statusCached } from '../services/dsh.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

function bytes(gbFree, total) {
  return { totalGb: +(total / 1024 ** 3).toFixed(1), freeGb: +(gbFree / 1024 ** 3).toFixed(1) };
}

router.get('/stats', requirePermission('system:view'), async (req, res) => {
  let disk = { totalGb: 0, freeGb: 0 };
  try {
    const { stdout } = await execFileAsync('df', ['-kP', '/']);
    const parts = String(stdout).trim().split('\n')[1]?.split(/\s+/) || [];
    if (parts.length >= 4) {
      disk = {
        totalGb: +(Number(parts[1]) * 1024 / 1024 ** 3).toFixed(1),
        freeGb: +(Number(parts[3]) * 1024 / 1024 ** 3).toFixed(1),
      };
    }
  } catch {
    // 忽略，返回 0
  }

  let swap = { totalMb: 0, freeMb: 0 };
  try {
    const { stdout } = await execFileAsync('free', ['-m']);
    const line = String(stdout).split('\n').find((l) => l.startsWith('Swap:'));
    if (line) {
      const p = line.split(/\s+/);
      swap = { totalMb: Number(p[1]) || 0, freeMb: Number(p[3]) || 0 };
    }
  } catch {
    // 忽略
  }

  const dsh = await statusCached(2000);

  res.json({
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg().map((n) => +n.toFixed(2)),
    mem: {
      totalMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMb: Math.round(os.freemem() / 1024 / 1024),
    },
    swap,
    disk,
    uptimeSeconds: Math.round(os.uptime()),
    dsh: { running: dsh.running, pid: dsh.pid, uptime: dsh.uptime },
  });
});

export default router;
