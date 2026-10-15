import { getDb } from '../db/index.js';
import { sourceRank } from './fundSource.js';

// 持仓结算：把「已执行的操作」用真实收盘净值换算成份额与费用。
// 管理费/托管费/销售服务费已经每日从净值里计提，这里不重复计算，
// 只算需要单独收的申购费与赎回费。

function now() {
  return Math.floor(Date.now() / 1000);
}

/** 默认赎回费分档（C 类常见）：不足 7 天 1.5%，30 天内 0.5%，之后免 */
export const DEFAULT_REDEEM_RULES = [
  { days: 7, fee: 1.5 },
  { days: 30, fee: 0.5 },
  { days: null, fee: 0 },
];

export function parseFeeRules(text) {
  if (!text) return DEFAULT_REDEEM_RULES;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_REDEEM_RULES;
    const rules = parsed
      .map((r) => ({ days: r?.days === null || r?.days === undefined ? null : Number(r.days), fee: Number(r.fee) }))
      .filter((r) => Number.isFinite(r.fee));
    return rules.length > 0 ? rules : DEFAULT_REDEEM_RULES;
  } catch {
    return DEFAULT_REDEEM_RULES;
  }
}

/** 按持有天数取费率：命中第一条「持有天数 < days」的规则，days 为 null 表示兜底 */
export function feeRateFor(rules, holdingDays) {
  for (const r of rules) {
    if (r.days === null || holdingDays < r.days) return r.fee;
  }
  return 0;
}

function dayDiff(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function navOn(code, date) {
  const row = getDb()
    .prepare(`SELECT nav FROM fund_nav WHERE code = ? AND nav_date = ?`)
    .get(code, date);
  return row ? row.nav : null;
}

/** 结算用过的净值落库（幂等 upsert）：持仓市值、走势图、后续 navOn 兜底都靠它 */
function recordNav(code, date, nav) {
  getDb()
    .prepare(
      `INSERT INTO fund_nav (code, nav_date, nav, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(code, nav_date) DO UPDATE SET nav = excluded.nav`
    )
    .run(code, date, nav, now());
}

export function lotsOf(code) {
  return getDb()
    .prepare(`SELECT * FROM fund_lots WHERE code = ? ORDER BY buy_date, id`)
    .all(code);
}

/** 由批次汇总出的真实持仓（不依赖 fund_holdings 里的缓存值） */
export function aggregate(code) {
  const lots = lotsOf(code);
  let shares = 0;
  let costAmount = 0;
  let invested = 0;
  for (const l of lots) {
    shares += l.remain;
    costAmount += l.remain * l.unit_cost;
    invested += l.amount;
  }
  return {
    shares: round2(shares),
    costAmount: round2(costAmount),
    invested: round2(invested),
    cost: shares > 0 ? round2(costAmount / shares * 10000) / 10000 : null,
    lots: lots.length,
  };
}

/**
 * 老持仓补一个初始批次：这个功能上线前的份额没有批次记录，
 * 不补的话减仓时无从 FIFO，页面也会显示成 0 份。
 * 建仓日优先用用户填的 first_buy_date，否则取净值序列起点（只是估算，赎回费档位可能偏高）。
 */
export function ensureInitialLot(holding) {
  const db = getDb();
  const exist = db.prepare(`SELECT COUNT(*) c FROM fund_lots WHERE code = ?`).get(holding.code);
  if (exist.c > 0) return false;
  const shares = Number(holding.shares);
  const cost = Number(holding.cost);
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) return false;

  let buyDate = String(holding.first_buy_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) {
    const first = db
      .prepare(`SELECT MIN(nav_date) d FROM fund_nav WHERE code = ?`)
      .get(holding.code);
    buyDate = first?.d || new Date().toISOString().slice(0, 10);
  }
  db.prepare(
    `INSERT INTO fund_lots (code, buy_date, nav, amount, shares, unit_cost, fee, remain, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'import', ?)`
  ).run(holding.code, buyDate, cost, round2(shares * cost), shares, cost, shares, now());
  return true;
}

/** 用汇总结果刷新 fund_holdings 的缓存字段 */
function syncHolding(code) {
  const agg = aggregate(code);
  getDb()
    .prepare(
      `UPDATE fund_holdings
          SET shares = ?, cost = ?, amount = ?, updated_at = ?
        WHERE code = ?`
    )
    .run(agg.shares, agg.cost, agg.costAmount, now(), code);
  return agg;
}

function getHolding(code) {
  return getDb().prepare(`SELECT * FROM fund_holdings WHERE code = ?`).get(code);
}

/** 买入结算：内扣法 */
function settleBuy({ code, date, nav, amount, feePct, source }) {
  const rate = Math.max(0, Number(feePct) || 0) / 100;
  const net = amount / (1 + rate);
  const fee = amount - net;
  const shares = round2(net / nav);
  const unitCost = shares > 0 ? amount / shares : nav;

  getDb()
    .prepare(
      `INSERT INTO fund_lots (code, buy_date, nav, amount, shares, unit_cost, fee, remain, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(code, date, nav, round2(amount), shares, unitCost, round2(fee), shares, source || 'advice', now());

  return { shares, fee: round2(fee), net: round2(net), unitCost };
}

/** 卖出结算：按批次 FIFO，逐笔算持有天数、赎回费与已实现盈亏 */
function settleSell({ code, date, nav, amount, feeRules }) {
  const db = getDb();
  const needShares = amount / nav;
  const lots = db
    .prepare(`SELECT * FROM fund_lots WHERE code = ? AND remain > 0 ORDER BY buy_date, id`)
    .all(code);

  let remaining = needShares;
  let totalFee = 0;
  let realized = 0;
  let usedShares = 0;
  const breakdown = [];
  const updateRemain = db.prepare(`UPDATE fund_lots SET remain = ? WHERE id = ?`);

  for (const lot of lots) {
    if (remaining <= 0.000001) break;
    const take = Math.min(lot.remain, remaining);
    const days = dayDiff(lot.buy_date, date);
    const ratePct = feeRateFor(feeRules, days);
    const gross = take * nav;
    const fee = (gross * ratePct) / 100;
    const lotRealized = take * (nav - lot.unit_cost) - fee;

    totalFee += fee;
    realized += lotRealized;
    usedShares += take;
    remaining -= take;
    breakdown.push({
      buyDate: lot.buy_date,
      shares: round2(take),
      days,
      feePct: ratePct,
      fee: round2(fee),
      realized: round2(lotRealized),
    });
    updateRemain.run(round2(lot.remain - take), lot.id);
  }

  return {
    shares: round2(usedShares),
    fee: round2(totalFee),
    net: round2(amount - totalFee),
    realized: round2(realized),
    breakdown,
    // 份额不够卖时如实告知，不静默截断
    shortfall: remaining > 0.000001 ? round2(remaining) : 0,
  };
}

/** 待结算：已执行但还没用真实净值入账 */
export function pendingSettlements() {
  return getDb()
    .prepare(
      `SELECT * FROM fund_advice
        WHERE executed = 1 AND settled = 0
        ORDER BY trade_date, id`
    )
    .all()
    .map((r) => ({
      code: r.code,
      date: r.trade_date,
      action: r.action,
      amount: r.amount,
      source: r.source || 'workbuddy',
    }));
}

/** 日期加减天数（UTC 基准，避免时区把日期挪偏） */
function shiftDate(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return date;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * 结算前的核对报告。定时任务先读它，再决定「直接结算」还是「只补齐」——
 * 手动触发（WorkBuddy 手动执行 / Trae 兜底）和定时触发走的是同一套幂等逻辑：
 * 入过账的记录不会再动，谁先跑谁结算，后跑的自动转成核对与补齐，
 * 所以手动触发多少次都不会影响定时任务每日照常执行。
 */
export function settlementAudit(date, options = {}) {
  const db = getDb();
  const lookback = Math.min(Math.max(Number(options.lookbackDays) || 10, 1), 60);
  const from = shiftDate(date, -lookback);

  const pending = db
    .prepare(
      `SELECT * FROM fund_advice
        WHERE executed = 1 AND settled = 0 AND trade_date <= ?
        ORDER BY trade_date, id`
    )
    .all(date)
    .map((r) => ({
      code: r.code,
      date: r.trade_date,
      action: r.action,
      amount: r.amount,
      source: r.source || 'workbuddy',
    }));

  // 交易日不排假日历，而是用「当天有没有任何数据」反推：
  // 任一基金有净值、或任一建议记录存在，就认为是交易日。
  // 节假日自然一条数据都没有，不会被误报成缺失
  const navDays = db
    .prepare(`SELECT DISTINCT nav_date d FROM fund_nav WHERE nav_date BETWEEN ? AND ?`)
    .all(from, date)
    .map((r) => r.d);
  const adviceDays = db
    .prepare(`SELECT DISTINCT trade_date d FROM fund_advice WHERE trade_date BETWEEN ? AND ?`)
    .all(from, date)
    .map((r) => r.d);
  const tradeDays = [...new Set([...navDays, ...adviceDays])].sort();

  const codes = db
    .prepare(`SELECT code FROM fund_holdings WHERE status = 'active' ORDER BY sort_order, id`)
    .all()
    .map((r) => r.code);
  const have = new Set(
    db
      .prepare(`SELECT code c, nav_date d FROM fund_nav WHERE nav_date BETWEEN ? AND ?`)
      .all(from, date)
      .map((r) => `${r.c}|${r.d}`)
  );

  // 走势图与结算都依赖 fund_nav：缺一天，市值曲线就断一截，
  // 挂起的记录也会因为查不到净值而一直结不掉
  const navGaps = [];
  for (const code of codes) {
    const missing = tradeDays.filter((d) => !have.has(`${code}|${d}`));
    if (missing.length > 0) navGaps.push({ code, dates: missing });
  }

  // 待结算却还查不到当日净值的——这就是结算卡住的直接原因，优先补这些
  const missingNav = pending
    .filter((p) => navOn(p.code, p.date) === null)
    .map((p) => ({ code: p.code, date: p.date, action: p.action }));

  const settled = db
    .prepare(
      `SELECT code, trade_date, action, amount, settled_nav, settled_shares,
              settled_fee, settled_amount, settled_realized, settled_source, updated_at
         FROM fund_advice
        WHERE settled = 1 AND trade_date BETWEEN ? AND ?
        ORDER BY trade_date DESC, id DESC`
    )
    .all(from, date)
    .map((r) => ({
      code: r.code,
      date: r.trade_date,
      action: r.action,
      amount: r.amount,
      nav: r.settled_nav ?? null,
      shares: r.settled_shares ?? null,
      fee: r.settled_fee ?? null,
      settledAmount: r.settled_amount ?? null,
      realized: r.settled_realized ?? null,
      settledBy: r.settled_source || null,
      at: r.updated_at || null,
    }));

  // 净值跳变异常：场外基金单日涨跌 20% 以上极罕见，多半是抓错了日期或脏数据。
  // 只提示不自动改，改账本这件事必须留给人工确认
  const anomalies = [];
  for (const code of codes) {
    const series = db
      .prepare(`SELECT nav_date, nav FROM fund_nav WHERE code = ? AND nav_date BETWEEN ? AND ? ORDER BY nav_date`)
      .all(code, from, date);
    for (let i = 1; i < series.length; i += 1) {
      const prev = Number(series[i - 1].nav);
      const cur = Number(series[i].nav);
      if (!prev || !cur) continue;
      const pct = ((cur - prev) / prev) * 100;
      if (Math.abs(pct) >= 20) {
        anomalies.push({ code, date: series[i].nav_date, prevDate: series[i - 1].nav_date, pct: Math.round(pct * 100) / 100 });
      }
    }
  }

  const last = db.prepare(`SELECT MAX(updated_at) t FROM fund_advice WHERE settled = 1`).get();

  return {
    date,
    from,
    lookbackDays: lookback,
    tradeDays,
    // 给任务看的两个开关：needSettle 决定要不要结算，clean 表示今天没活儿干
    needSettle: pending.length > 0,
    clean: pending.length === 0 && navGaps.length === 0 && anomalies.length === 0,
    pendingCount: pending.length,
    pending,
    missingNav,
    navGaps,
    settled,
    anomalies,
    lastSettledAt: last?.t || null,
  };
}

/**
 * 结算某一天（幂等：只处理 settled=0 的记录）。
 * 只认 executed=1 的那条——它就是我当天真实做的操作，一天只会有一条。
 * 没被采纳的建议只是候选，不进账本。
 * navMap 由定时任务提供 {code: nav}；拿不到净值的记录保持待结算，等次日补。
 *
 * settledBy 记录「是谁调用结算的」，用于角色分离后的审计；去重只认 settledBy 之外
 * 的优先级，保证两只工具不会各写一遍账本。
 */
export function settleDay(tradeDate, navMap = {}, settledBy = null) {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM fund_advice WHERE executed = 1 AND settled = 0 AND trade_date <= ? ORDER BY trade_date, id`)
    .all(tradeDate);

  // 同一基金同一天只入账一条。正常情况 executed=1 本来就只有一条——
  // 「执行」是单条互斥的（部分唯一索引强制），用户采纳哪条账本就认哪条。
  // 这里仍按入账优先级兜底，是为了老库万一还留着同日多条时不至于各写一遍：
  // 少了这层，份额就会翻倍，是整个模块最难发现的一类事故
  const winnerByKey = new Map();
  for (const row of rows) {
    const key = `${row.code}|${row.trade_date}`;
    const cur = winnerByKey.get(key);
    if (!cur || sourceRank(row.source) < sourceRank(cur.source)) winnerByKey.set(key, row);
  }
  const winnerIds = new Set([...winnerByKey.values()].map((r) => r.id));

  const done = [];
  const pending = [];
  const skipped = [];
  const mark = db.prepare(
    `UPDATE fund_advice
        SET settled = 1, settled_nav = ?, settled_shares = ?, settled_fee = ?,
            settled_amount = ?, settled_realized = ?, settled_source = ?, updated_at = ?
      WHERE id = ?`
  );
  // 落选的记录也要置 settled=1，否则明天会被再挑一次、又入账一遍
  const markDeduped = db.prepare(
    `UPDATE fund_advice SET settled = 1, settled_source = 'deduped', updated_at = ? WHERE id = ?`
  );

  const run = db.transaction(() => {
    for (const row of rows) {
      const key = `${row.code}|${row.trade_date}`;
      if (!winnerIds.has(row.id)) {
        const winner = winnerByKey.get(key);
        skipped.push({
          code: row.code,
          date: row.trade_date,
          action: row.action,
          source: row.source || 'workbuddy',
          reason: `同一天已有更高优先级的建议（${winner.source || 'workbuddy'}）入账，本条只保留为参考`,
        });
        markDeduped.run(now(), row.id);
        continue;
      }

      // 老持仓先补 initial lot，才能 FIFO
      const holding = getHolding(row.code);
      if (holding) ensureInitialLot(holding);

      // navMap 只对「当天」的记录生效。settleDay 会顺手处理 trade_date <= tradeDate 的
      // 挂起记录，若把今天的净值套到昨天的操作上，份额与成本都会算错——那种情况宁可
      // 继续挂起，等任务按各自日期补到正确净值
      const nav = (row.trade_date === tradeDate ? navMap[row.code] : undefined)
        ?? navOn(row.code, row.trade_date);
      if (!nav || nav <= 0) {
        pending.push({ code: row.code, date: row.trade_date, action: row.action, reason: '当日净值尚未公布' });
        continue;
      }
      recordNav(row.code, row.trade_date, nav);

      if (row.action === 'hold' || !row.amount) {
        mark.run(nav, null, null, null, null, settledBy, now(), row.id);
        done.push({ code: row.code, date: row.trade_date, action: row.action, settled: 'no-op' });
        continue;
      }

      if (row.action === 'buy' || row.action === 'add') {
        const r = settleBuy({
          code: row.code,
          date: row.trade_date,
          nav,
          amount: row.amount,
          feePct: holding?.purchase_fee || 0,
          source: row.source === 'manual' ? 'manual' : 'advice',
        });
        mark.run(nav, r.shares, r.fee, row.amount, null, settledBy, now(), row.id);
        syncHolding(row.code);
        done.push({
          code: row.code, date: row.trade_date, action: row.action, nav,
          amount: row.amount, shares: r.shares, fee: r.fee, avgCost: syncCost(row.code),
        });
        continue;
      }

      // reduce / sell
      const rules = parseFeeRules(holding?.redemption_fee);
      const r = settleSell({ code: row.code, date: row.trade_date, nav, amount: row.amount, feeRules: rules });
      db.prepare(`UPDATE fund_holdings SET realized = COALESCE(realized, 0) + ? WHERE code = ?`)
        .run(r.realized, row.code);
      mark.run(nav, r.shares, r.fee, row.amount, r.realized, settledBy, now(), row.id);
      syncHolding(row.code);
      done.push({
        code: row.code, date: row.trade_date, action: row.action, nav,
        amount: row.amount, shares: r.shares, fee: r.fee, realized: r.realized,
        breakdown: r.breakdown, shortfall: r.shortfall, avgCost: syncCost(row.code),
      });
    }
  });
  run();

  return { tradeDate, settledBy: settledBy || null, settled: done, pending, skipped };
}

function syncCost(code) {
  return aggregate(code).cost;
}

/**
 * 投资总览：额度模型的依据是「净投入」而不是当前市值。
 *
 * 净投入 = 累计买入金额 − 累计赎回金额 + 已承诺但还没入账的加仓。
 * 用现金流而不是市值，是因为市值会随行情波动——涨了就把额度算多、
 * 跌了又把额度算没，都会让模型的加仓节奏跟着行情抖。
 * 用户设的总额是「我最多拿多少钱出来投」，那就是现金流口径。
 */
export function investmentSummary(cfg, today = null) {
  const db = getDb();
  const totalBudget = Number(cfg?.totalBudget) || 0;
  const targetReturnPct = Number(cfg?.targetReturnPct) || 0;

  const cashIn = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM fund_lots`).get().v || 0;
  const cashOut =
    db
      .prepare(
        `SELECT COALESCE(SUM(settled_amount), 0) AS v FROM fund_advice
          WHERE settled = 1 AND action IN ('reduce','sell') AND settled_amount IS NOT NULL`
      )
      .get().v || 0;
  const pendingAdds =
    db
      .prepare(
        `SELECT COALESCE(SUM(mx), 0) AS v FROM (
           SELECT MAX(amount) AS mx FROM fund_advice
            WHERE executed = 1 AND settled = 0 AND action IN ('buy','add') AND amount IS NOT NULL
            GROUP BY code
         )`
      )
      .get().v || 0;

  // 当天已排但还没执行的加仓：按每只基金取各来源最大值（同一天同一只只会成交一笔）。
  // 不计入 used（那不是真金白银），但要让额度校验看得见，否则两个工具
  // 同一天各排一笔就把总额排穿了
  let todayPlanned = 0;
  if (today) {
    todayPlanned =
      db
        .prepare(
          `SELECT COALESCE(SUM(mx), 0) AS v FROM (
             SELECT MAX(amount) AS mx FROM fund_advice
              WHERE trade_date = ? AND settled = 0 AND executed = 0
                AND action IN ('buy','add') AND amount IS NOT NULL
              GROUP BY code
           )`
        )
        .get(today).v || 0;
  }

  const netInvested = round2(cashIn - cashOut);
  const used = round2(netInvested + pendingAdds);
  const remaining = totalBudget > 0 ? Math.max(0, round2(totalBudget - used)) : Number.POSITIVE_INFINITY;

  // 市值与盈亏：逐只持仓汇总
  let market = 0;
  let costAmount = 0;
  let realized = 0;
  for (const h of db.prepare(`SELECT * FROM fund_holdings WHERE status = 'active'`).all()) {
    ensureInitialLot(h);
    const agg = aggregate(h.code);
    const navRow = db
      .prepare(`SELECT nav FROM fund_nav WHERE code = ? ORDER BY nav_date DESC LIMIT 1`)
      .get(h.code);
    if (navRow?.nav) market += agg.shares * navRow.nav;
    costAmount += agg.costAmount;
    realized += Number(h.realized) || 0;
  }
  market = round2(market);
  costAmount = round2(costAmount);
  const unrealized = round2(market - costAmount);
  const totalProfit = round2(unrealized + realized);
  const base = netInvested > 0 ? netInvested : 0;
  const returnPct = base > 0 ? round2((totalProfit / base) * 10000) / 100 : null;
  const targetAmount = base > 0 ? round2(base * (1 + targetReturnPct / 100)) : null;

  return {
    totalBudget,
    targetReturnPct,
    dailyAddBudget: Number(cfg?.dailyAddBudget) || 0,
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    netInvested,
    pendingAdds: round2(pendingAdds),
    todayPlanned: round2(todayPlanned),
    used,
    remaining: Number.isFinite(remaining) ? remaining : null,
    // 校验口径：已确认占用 + 当天已排计划，两个工具同一天各排一笔也不会排穿
    available: Number.isFinite(remaining)
      ? Math.max(0, round2(remaining - todayPlanned))
      : null,
    market,
    costAmount,
    unrealized,
    realized: round2(realized),
    totalProfit,
    returnPct,
    targetAmount,
    progressPct: totalBudget > 0 ? round2((used / totalBudget) * 10000) / 100 : null,
  };
}

/** 持仓视图：批次汇总 + 市值/盈亏，供页面与定时任务使用 */
export function holdingView(code) {
  const holding = getHolding(code);
  if (!holding) return null;
  // 从没结算过的持仓还没有批次，先补一个初始批次，否则页面会显示成 0 份
  ensureInitialLot(holding);
  const agg = aggregate(code);
  const latest = getDb()
    .prepare(`SELECT nav, nav_date FROM fund_nav WHERE code = ? ORDER BY nav_date DESC LIMIT 1`)
    .get(code);
  const nav = latest?.nav || null;
  const market = nav && agg.shares ? round2(agg.shares * nav) : null;
  const unrealized = market !== null ? round2(market - agg.costAmount) : null;
  return {
    code,
    name: holding.name,
    shares: agg.shares,
    cost: agg.cost,
    costAmount: agg.costAmount,
    invested: agg.invested,
    realized: round2(holding.realized || 0),
    nav,
    navDate: latest?.nav_date || null,
    market,
    unrealized,
    unrealizedPct: unrealized !== null && agg.costAmount > 0 ? round2((unrealized / agg.costAmount) * 10000) / 100 : null,
    totalProfit: unrealized === null ? null : round2(unrealized + (holding.realized || 0)),
    purchaseFee: holding.purchase_fee || 0,
    redemptionFee: parseFeeRules(holding.redemption_fee),
    feeSource: holding.fee_source || '',
    lots: agg.lots,
  };
}

/** 更新费率（定时任务抓取后回写，或用户在页面手填） */
export function updateFees(code, { purchaseFee, redemptionFee, source }) {
  const db = getDb();
  const sets = [];
  const params = { code, now: now() };
  if (purchaseFee !== undefined && purchaseFee !== null) {
    sets.push('purchase_fee = @purchaseFee');
    params.purchaseFee = Number(purchaseFee) || 0;
  }
  if (redemptionFee !== undefined && redemptionFee !== null) {
    sets.push('redemption_fee = @redemptionFee');
    params.redemptionFee = JSON.stringify(redemptionFee);
  }
  if (source !== undefined) {
    sets.push('fee_source = @source');
    params.source = String(source).slice(0, 60);
  }
  if (sets.length === 0) return false;
  sets.push('fee_updated_at = @now');
  return db.prepare(`UPDATE fund_holdings SET ${sets.join(', ')} WHERE code = @code`).run(params).changes > 0;
}
