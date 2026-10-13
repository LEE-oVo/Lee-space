import { Router } from 'express';
import { requirePermission, denyGuest, requireFundIngest, clientIp, hasPermission } from '../middleware/auth.js';
import { writeAudit } from '../db/repo.js';
import { config } from '../config.js';
import { holdingView, pendingSettlements, settleDay, updateFees } from '../services/position.js';
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
  navSeries,
  positionSummary,
  publicAdvice,
  publicHolding,
  setAdviceExecuted,
  todayAllocation,
  updateHolding,
  upsertManualRecord,
  holdingsForAutomation,
} from '../services/funds.js';

const router = Router();
const CODE_RE = /^[A-Za-z0-9]{4,12}$/;
// 金额规则随接口一起下发给定时任务，避免规则散落在 prompt 里漂移
const AMOUNT_RULES = {
  unit: 100,
  scope: 'daily-total',
  dailyTotal: config.fundDailyAddBudget,
  note: `买入/加仓金额必须是整百；所有基金当日加仓合计不超过 ${config.fundDailyAddBudget} 元`
    + '（是每日总预算，不是每只各这么多）。仅在明确判断为机会时才可突破，且需在 reason 说明理由',
};

/** 服务器按北京时间取当天日期，避免 UTC 跨日错位 */
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// 页面数据：有 fund:view 即可（游客也包含在内）。
// 但持仓金额与详细分析正文只在有 fund:detail 时才下发——裁剪必须在服务端做，
// 前端隐藏是没有用的，数据照样在响应里。
router.get('/', requirePermission('fund:view'), (req, res) => {
  // 持仓金额对游客是硬性不可见：即使有人在角色页误勾了 fund:detail 也不放行，
  // 这条不变量放在服务端，不依赖配置正确
  const detail = hasPermission(req.user, 'fund:detail') && !req.user.isGuest;
  const holdings = listHoldings();
  const advice = latestAdvice();
  res.json({
    daily: latestDaily(),
    holdings: detail ? holdings : holdings.map(publicHolding),
    advice: detail ? advice : advice.map(publicAdvice),
    // 结算后的真实持仓：份额 / 成本 / 市值 / 浮动盈亏 / 已实现盈亏（含金额，仅 detail）
    positions: detail
      ? Object.fromEntries(holdings.map((h) => [h.code, holdingView(h.code)]))
      : {},
    scope: detail ? 'full' : 'public',
  });
});

// 净值走势：只有净值数字，不涉及持仓金额，有 fund:view 即可
router.get('/series', requirePermission('fund:view'), (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  res.json({ code, series: navSeries(code, Number(req.query.limit) || 60) });
});

// 建议历史：含判断正文，需要 fund:detail
router.get('/history', requirePermission('fund:view'), (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  const detail = hasPermission(req.user, 'fund:detail') && !req.user.isGuest;
  if (!detail) {
    return res.status(403).json({ error: '当前角色不能查看详细分析' });
  }
  res.json({ history: adviceHistory(code, Number(req.query.limit) || 10) });
});

// 持仓列表：给定时任务读取用（用令牌而不是会话），这样新增基金不必改任务配置。
// 附带每只基金最近的加减仓记录，让模型能看到自己过去的判断与实际执行情况。
router.get('/holdings', requireFundIngest, (req, res) => {
  res.json({
    holdings: holdingsForAutomation(Number(req.query.limit) || 12),
    // 结算后的真实持仓，让模型知道当前份额与成本
    positions: Object.fromEntries(listHoldings().map((h) => [h.code, holdingView(h.code)])),
    amountRules: AMOUNT_RULES,
    // 当天已经分配出去的加仓额度，模型据此在预算内分配
    todayAllocation: todayAllocation(String(req.query.date || todayStr())),
  });
});

// 结算任务的第一步：看看有哪些已执行但还没入账的操作
router.get('/pending', requireFundIngest, (_req, res) => {
  const rows = pendingSettlements();
  res.json({
    pending: rows.map((r) => ({
      code: r.code,
      date: r.trade_date,
      action: r.action,
      amount: r.amount,
    })),
    count: rows.length,
  });
});

// 结算任务的第二步：带上真实净值回来入账（幂等，只处理 settled=0）
router.post('/settle', requireFundIngest, (req, res) => {
  const tradeDate = String(req.body?.tradeDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return res.status(400).json({ error: 'tradeDate 格式应为 YYYY-MM-DD' });
  }
  const navs = req.body?.navs && typeof req.body.navs === 'object' ? req.body.navs : {};
  for (const [code, nav] of Object.entries(navs)) {
    const n = Number(nav);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: `${code} 的净值不是正数` });
    }
  }
  // 可选：顺带回写抓取到的费率（定时任务首次跑时填充，之后以页面手改的为准）
  const fees = req.body?.fees && typeof req.body.fees === 'object' ? req.body.fees : null;
  if (fees) {
    for (const [code, fee] of Object.entries(fees)) {
      if (!CODE_RE.test(String(code))) continue;
      const list = Array.isArray(fee?.redemptionFee) ? fee.redemptionFee : null;
      updateFees(String(code), {
        purchaseFee: fee?.purchaseFee,
        redemptionFee: list,
        source: fee?.source || 'auto',
      });
    }
  }

  const result = settleDay(tradeDate, navs);
  return res.json({ ok: true, ...result });
});

// 费率由定时任务抓取后回写，也可在页面手改
router.patch('/fees', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  const ok = updateFees(code, {
    purchaseFee: req.body?.purchaseFee,
    redemptionFee: req.body?.redemptionFee,
    source: req.body?.source,
  });
  if (!ok) return res.status(404).json({ error: '持仓不存在或没有可更新字段' });
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action: 'fund.fees.update',
    target: code,
    detail: `申购费 ${req.body?.purchaseFee ?? '-'}%`,
    ip: clientIp(req),
  });
  return res.json({ ok: true, position: holdingView(code) });
});

// 手动补记一笔实际操作（例如建议持有、但我实际加了 300）。
// 覆盖当天该基金的记录并直接标记 executed=1，供模型回看真实仓位变化。
router.post('/records', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const result = upsertManualRecord({
    code: req.body?.code,
    tradeDate: req.body?.tradeDate,
    action: req.body?.action,
    amount: req.body?.amount,
    nav: req.body?.nav,
    note: req.body?.note,
  });
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: '数据校验失败', details: result.errors });
  }
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action: 'fund.record.manual',
    target: `${req.body?.code}@${req.body?.tradeDate}`,
    detail: `${req.body?.action} ${req.body?.amount ?? ''} ${req.body?.note || ''}`.trim(),
    ip: clientIp(req),
  });
  return res.json({
    ok: true,
    id: result.id,
    allocation: todayAllocation(String(req.body?.tradeDate)),
  });
});

// 标记某条建议是否已实际执行：模型回看时才知道真实仓位变化
router.patch('/executed', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const tradeDate = String(req.body?.tradeDate || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  if (!setAdviceExecuted(code, tradeDate, Boolean(req.body?.executed))) {
    return res.status(404).json({ error: '记录不存在' });
  }
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action: 'fund.record.executed',
    target: `${code}@${tradeDate}`,
    detail: req.body?.executed ? '已执行' : '取消执行',
    ip: clientIp(req),
  });
  return res.json({ ok: true, summary: positionSummary(code) });
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
    amountRules: AMOUNT_RULES,
  });
});

export default router;
