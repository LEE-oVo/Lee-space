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

/**
 * 结算某一天（幂等：只处理 settled=0 的记录）。
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

  // 同一基金同一天只入账一条：多来源并存时取优先级最高的那条，其余标记 deduped。
  // 少了这一步，两只工具各建议一次加仓就会各入账一次，份额直接翻倍——
  // 这是整个模块最容易出、也最难发现的一类事故
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
