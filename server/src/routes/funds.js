import { Router } from 'express';
import { requirePermission, denyGuest, requireFundIngest, requireFundSettle, clientIp, hasPermission } from '../middleware/auth.js';
import { writeAudit } from '../db/repo.js';
import { config } from '../config.js';
import { holdingView, pendingSettlements, settleDay, updateFees, investmentSummary } from '../services/position.js';
import { getFundConfig, updateFundConfig } from '../services/fundConfig.js';
import {
  FUND_ACTIONS,
  FUND_CONFIDENCE,
  SOURCE_LABELS,
  adviceHistory,
  adviceSources,
  createHolding,
  deleteHolding,
  ingestAdvice,
  latestAdvice,
  latestDaily,
  latestDailyList,
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
/**
 * 下发给定时任务的金额规则。每次读库，页面改完立刻生效——
 * 写死在模块加载时的话，改了配置要重启服务才有用。
 */
function amountRules(cfg = getFundConfig(), invest = null) {
  const total = Number(cfg.totalBudget) || 0;
  const daily = Number(cfg.dailyAddBudget) || 0;
  const parts = ['买入/加仓金额必须是整百的整数（100、200、300…）；'];
  if (total > 0) {
    parts.push(`所有基金**累计投入合计不得超过 ${total} 元**（含已经投进去的，`
      + '这是唯一硬约束，不是每日限额）；');
  }
  parts.push(daily > 0
    ? `每日加仓上限 ${daily} 元，两个工具共用；`
    : '不设每日加仓上限——钱要留到确定性高的机会上，不要被日限额摊平成定投；');
  parts.push('超过剩余额度时服务端会自动削减或改成持有，请自己先看余额再报。');
  return {
    unit: 100,
    scope: total > 0 ? 'total-investment' : 'none',
    totalBudget: total,
    dailyAddBudget: daily,
    minAddAmount: cfg.minAddAmount,
    targetReturnPct: cfg.targetReturnPct,
    remaining: invest ? invest.remaining : null,
    note: parts.join(''),
  };
}

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
  // 不传 source：返回「每只基金 × 每个来源」各自的最新一条，页面自己做切换与冲突对比
  const advice = latestAdvice();
  const cfg = getFundConfig();
  res.json({
    daily: latestDaily(),
    // 每个来源各自的整体结论，页面切到哪个来源就显示哪份
    dailyBySource: latestDailyList(),
    holdings: detail ? holdings : holdings.map(publicHolding),
    advice: detail ? advice : advice.map(publicAdvice),
    // 结算后的真实持仓：份额 / 成本 / 市值 / 浮动盈亏 / 已实现盈亏（含金额，仅 detail）
    positions: detail
      ? Object.fromEntries(holdings.map((h) => [h.code, holdingView(h.code)]))
      : {},
    // 总额度与目标收益：含金额，仅 detail
    investment: detail ? investmentSummary(cfg, todayStr()) : null,
    config: detail ? cfg : null,
    // 库里实际有哪些来源：只有一个来源时页面不显示切换器
    sources: adviceSources(),
    sourceLabels: SOURCE_LABELS,
    settleSources: config.fundSettleSources,
    scope: detail ? 'full' : 'public',
  });
});

// 投资配置：总投资额 / 目标收益率 / 每日加仓上限。读写都要 fund:manage
router.get('/config', requirePermission('fund:manage'), denyGuest, (_req, res) => {
  const cfg = getFundConfig();
  res.json({ config: cfg, investment: investmentSummary(cfg, todayStr()) });
});

router.patch('/config', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const result = updateFundConfig(
    {
      totalBudget: req.body?.totalBudget,
      targetReturnPct: req.body?.targetReturnPct,
      dailyAddBudget: req.body?.dailyAddBudget,
      minAddAmount: req.body?.minAddAmount,
    },
    req.user?.id ?? null
  );
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: '参数不合法', details: result.errors });
  }
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action: 'fund.config.update',
    target: 'fund',
    detail: `总额 ${result.config.totalBudget} / 目标 ${result.config.targetReturnPct}% / 日限 ${result.config.dailyAddBudget || '不限'}`,
    ip: clientIp(req),
  });
  return res.json({ ok: true, config: result.config, investment: investmentSummary(result.config, todayStr()) });
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
  const source = String(req.query.source || '').trim() || null;
  res.json({ history: adviceHistory(code, Number(req.query.limit) || 10, source) });
});

// 持仓列表：给定时任务读取用（用令牌而不是会话），这样新增基金不必改任务配置。
// 附带每只基金最近的加减仓记录，让模型能看到自己过去的判断与实际执行情况。
router.get('/holdings', requireFundIngest, (req, res) => {
  const date = String(req.query.date || todayStr());
  const cfg = getFundConfig();
  const invest = investmentSummary(cfg, date);
  res.json({
    // 告诉任务服务端把它判成了哪个来源：任务侧不用再自己声明，也不该自己声明
    source: req.fundSource,
    holdings: holdingsForAutomation(Number(req.query.limit) || 12),
    // 结算后的真实持仓，让模型知道当前份额与成本
    positions: Object.fromEntries(listHoldings().map((h) => [h.code, holdingView(h.code)])),
    amountRules: amountRules(cfg, invest),
    // 总投资额与剩余：模型分配加仓金额的主要依据（不是每日限额）
    investment: invest,
    // 当天共享额度池的占用情况（没设日限时 remain 为 null）
    todayAllocation: todayAllocation(date, cfg),
    // 本来源能不能写账本（Trae 兜底时两边都可写）
    canSettle: config.fundSettleSources.length === 0 || config.fundSettleSources.includes(req.fundSource),
  });
});

// 结算任务的第一步：看看有哪些已执行但还没入账的操作
router.get('/pending', requireFundIngest, (_req, res) => {
  const rows = pendingSettlements();
  res.json({
    pending: rows.map((r) => ({
      code: r.code,
      date: r.date,
      action: r.action,
      amount: r.amount,
      source: r.source,
    })),
    count: rows.length,
  });
});

// 结算任务的第二步：带上真实净值回来入账（幂等，只处理 settled=0）
// 比写建议多一层来源白名单：FUND_SETTLE_SOURCES=trae 时 WorkBuddy 的令牌只能投建议
router.post('/settle', requireFundIngest, requireFundSettle, (req, res) => {
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

  // 同一基金同一天多来源并存时只入账优先级最高的那条，其余标记为 deduped
  const result = settleDay(tradeDate, navs, req.fundSource);
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
  const cfg = getFundConfig();
  return res.json({
    ok: true,
    id: result.id,
    allocation: todayAllocation(String(req.body?.tradeDate), cfg),
    investment: investmentSummary(cfg, String(req.body?.tradeDate) || todayStr()),
  });
});

// 标记某条建议是否已实际执行：模型回看时才知道真实仓位变化
router.patch('/executed', requirePermission('fund:manage'), denyGuest, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const tradeDate = String(req.body?.tradeDate || '').trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: '基金代码非法' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  // 可选：只切换某个来源的记录；不给就按整天的执行状态一起改
  const source = String(req.body?.source || '').trim() || null;
  if (!setAdviceExecuted(code, tradeDate, Boolean(req.body?.executed), source)) {
    return res.status(404).json({ error: '记录不存在' });
  }
  writeAudit({
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    action: 'fund.record.executed',
    target: `${code}@${tradeDate}`,
    // executed 是账本语义，同一天所有来源会一起改，日志里注明是哪条触发的
    detail: `${req.body?.executed ? '已执行' : '取消执行'}${source ? `（${SOURCE_LABELS[source] || source}）` : ''}`,
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

// 定时任务写入：强校验，任何一条不合法整批拒绝。
// 来源只认令牌——body 里就算带了 source 也一律忽略，避免提示词被改坏后串格子
router.post('/ingest', requireFundIngest, (req, res) => {
  const result = ingestAdvice(req.body, { source: req.fundSource });
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: '数据校验失败', details: result.errors });
  }
  return res.json({
    ok: true,
    accepted: result.accepted,
    tradeDate: result.tradeDate,
    source: result.source,
    // 被额度拦截而削减/改持有的条目：非空的 adjusted 说明模型报超了
    budget: result.budget,
    actions: FUND_ACTIONS,
    confidence: FUND_CONFIDENCE,
    amountRules: amountRules(),
  });
});

export default router;
