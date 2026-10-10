import express from 'express';
import { requireAuth, requirePermission, clientIp, hasPermission, denyGuest } from '../middleware/auth.js';
import { statusCached, startDsh, stopDsh, tailLog } from '../services/dsh.js';
import { writeAudit, listDshRuns } from '../db/repo.js';
import { config } from '../config.js';

const router = express.Router();

function present(status, user) {
  const canAccess = hasPermission(user, 'dsh:access');
  return {
    running: status.running,
    pid: status.pid,
    startedAt: status.startedAt,
    uptime: status.uptime,
    port: status.port,
    path: config.publicPath,
    token: canAccess ? status.token : null,
    canStart: hasPermission(user, 'dsh:start'),
    canStop: hasPermission(user, 'dsh:stop'),
    canAccess,
  };
}

router.get('/status', requireAuth, async (req, res) => {
  const status = await statusCached();
  res.json(present(status, req.user));
});

router.post('/start', requirePermission('dsh:start'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const result = await startDsh(req.user);
    writeAudit({
      userId: req.user.id, username: req.user.username,
      action: 'dsh.start', ip, result: result.ok ? 'success' : 'failure',
      detail: result.error ? { error: result.error } : { pid: result.pid ?? null },
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ ok: true, ...present(await statusCached(0), req.user) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

router.post('/stop', requirePermission('dsh:stop'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const result = await stopDsh(req.user);
    writeAudit({
      userId: req.user.id, username: req.user.username,
      action: 'dsh.stop', ip, result: result.ok ? 'success' : 'failure',
      detail: result.error ? { error: result.error } : {},
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ ok: true, ...present(await statusCached(0), req.user) });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// 日志里含一次性 token，游客不给看（入口本身已通过 token 字段下发）
router.get('/log', requirePermission('dsh:access'), denyGuest, async (req, res) => {
  const lines = Math.min(Number(req.query.lines || 80), 400);
  res.json({ log: await tailLog(lines) });
});

router.get('/runs', requireAuth, denyGuest, (req, res) => {
  res.json({ runs: listDshRuns(30) });
});

export default router;
