import { Router } from 'express';
import { requirePermission, denyGuest, requireFundIngest, clientIp } from '../middleware/auth.js';
import { writeAudit } from '../db/repo.js';
import {
  FUND_ACTIONS,
  FUND_CONFIDENCE,
  adviceHistory,
  createHolding,
  deleteHolding,
  ingestAdvice,
  latestAdvice,
  latestDaily,
  listHoldings,
  updateHolding,
} from '../services/funds.js';

const router = Router();
const CODE_RE = /^[A-Za-z0-9]{4,12}$/;

// 页面数据：登录用户凭 fund:view 查看，游客一律不含此权限（这里再加护栏，防止被误授权）
router.get('/', requirePermission('fund:view'), denyGuest, (_req, res) => {
  res.json({
    daily: latestDaily(),
    holdings: listHoldings(),
    advice: latestAdvice(),
  });
});

router.get('/history', requirePermission('fund:view'), denyGuest, (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  res.json({ history: adviceHistory(code, Number(req.query.limit) || 10) });
});

// 持仓列表：给定时任务读取用（用令牌而不是会话），这样新增基金不必改任务配置
router.get('/holdings', requireFundIngest, (_req, res) => {
  res.json({ holdings: listHoldings() });
});

function audit(req, action, target, detail) {
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action,
    target,
    detail,
    ip: clientIp(req),
  });
}

router.post('/holdings', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法（4-12 位字母数字）' });
  if (!name) return res.status(400).json({ error: '请填写基金名称' });

  try {
    const row = createHolding(req.body);
    audit(req, 'fund.holding.create', code, name);
    return res.json({ ok: true, holding: row });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: `基金 ${code} 已存在` });
    }
    return res.status(500).json({ error: '创建失败' });
  }
});

router.patch('/holdings/:id', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '参数错误' });
  const row = updateHolding(id, req.body || {});
  if (!row) return res.status(404).json({ error: '记录不存在' });
  audit(req, 'fund.holding.update', row.code, row.name);
  return res.json({ ok: true, holding: row });
});

router.delete('/holdings/:id', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: '参数错误' });
  if (!deleteHolding(id)) return res.status(404).json({ error: '记录不存在' });
  audit(req, 'fund.holding.delete', String(id), '');
  return res.json({ ok: true });
});

// 定时任务写入：强校验，任何一条不合法整批拒绝
router.post('/ingest', requireFundIngest, (req, res) => {
  const result = ingestAdvice(req.body);
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: '数据校验失败', details: result.errors });
  }
  return res.json({
    ok: true,
    accepted: result.accepted,
    tradeDate: result.tradeDate,
    actions: FUND_ACTIONS,
    confidence: FUND_CONFIDENCE,
  });
});

export default router;
