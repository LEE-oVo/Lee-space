import { getDb } from '../db/index.js';
import { sourceRank } from './fundSource.js';
import { getCurveStartDate, getFundConfig } from './fundConfig.js';

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

/** 净值/成本价要 4 位，2 位会把 1.4451 和 1.4452 抹成同一个数 */
function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/** 服务端统一按北京时间取当天日期，别用 UTC，跨日会差一天 */
function todayInShanghai() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
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
 * 组合层面的每日收益曲线（所有基金合起来看）。
 *
 * 口径刻意与 investmentSummary 完全对齐：最后一天的数字必须等于页面卡片上的数字，
 * 否则曲线末端和卡片对不上，看着像算错了。
 *   market      = Σ 当日份额 × 当日净值（当天缺净值就沿用上一交易日的）
 *   cost        = Σ 批次金额 − Σ 已卖出份额对应的成本
 *   realized    = Σ 已实现盈亏
 *   netInvested = Σ 批次金额 − Σ 赎回到账（现金流口径，也是额度的依据）
 *   profit      = market − cost + realized
 *   returnPct   = profit / netInvested
 *
 * 另外算一条 TWR（时间加权收益率）：剔除加仓/减仓的现金流影响，只看
 * 「钱放着不动能涨多少」。加仓越密，简单收益率被摊薄得越厉害——
 * 例如一路加仓会让「累计收益率」显得很小，那不是亏了，只是分母变大了。
 * 最大回撤按 TWR 算才有意义，否则一次加仓就能把回撤抹平。
 */
export function equityCurve(opts = {}) {
  const db = getDb();
  // 起点之前的净值只属于基金自己，不属于这个组合——
  // 底仓的 buy_date 是 MIN(nav_date) 兜底出来的假日期，从那里画起会把
  // 建仓前就存在的浮亏记成「这段行情跌的」。截断到真正开始记录的那天。
  const from = opts.from === undefined ? getCurveStartDate() : opts.from;
  const lots = db
    .prepare(`SELECT code, buy_date, amount, shares, source FROM fund_lots ORDER BY buy_date, id`)
    .all();
  const sells = db
    .prepare(
      `SELECT code, trade_date, action, amount, settled_amount, settled_shares, settled_realized
         FROM fund_advice
        WHERE settled = 1 AND action IN ('reduce','sell') AND settled_shares IS NOT NULL
        ORDER BY trade_date, id`
    )
    .all();

  // 净值一次性读成 code -> Map(date -> nav)：93 天 × 4 只也就几百行
  const navMap = new Map();
  const dateSet = new Set();
  for (const r of db.prepare(`SELECT code, nav_date, nav FROM fund_nav ORDER BY nav_date`).all()) {
    if (!navMap.has(r.code)) navMap.set(r.code, new Map());
    navMap.get(r.code).set(r.nav_date, r.nav);
    dateSet.add(r.nav_date);
  }
  const allDates = [...dateSet].sort();
  if (allDates.length === 0) return { points: [], events: [], summary: null, from: null };
  // 第一个纳入的日期上，底仓会一次性灌进来，flowValue 与 market 相等 → 当日涨跌为 0，
  // 所以 TWR 从 0% 起算，而「累计收益率」照样是真实的 -12.9%。
  const dates = from ? allDates.filter((d) => d >= from) : allDates;
  if (dates.length === 0) return { points: [], events: [], summary: null, from: from || null };

  const shares = new Map();
  const cost = new Map();
  const lastNav = new Map();
  let realized = 0;
  let netInvested = 0;
  let prevMarket = 0;
  let twr = 1;
  let lotI = 0;
  let sellI = 0;
  const points = [];

  for (const date of dates) {
    // 先把当天的净值取出来，后面算「买入带来的市值增量」要用
    for (const code of navMap.keys()) {
      const series = navMap.get(code);
      if (series.has(date)) lastNav.set(code, series.get(date));
    }

    // 现金流要按**市值口径**折算，不能直接拿金额：
    // 老持仓的初始批次金额是用户填的成本价，可能和净值序列起点的净值不一样
    // （他是更早买的），差额是建仓前就存在的浮亏，不是这一天的行情变化。
    // 用金额会把这笔算进「当日盈亏」，第一天就凭空亏一大截，还污染 TWR
    let flowValue = 0;
    while (lotI < lots.length && lots[lotI].buy_date <= date) {
      const l = lots[lotI];
      lotI += 1;
      const nav = lastNav.get(l.code);
      const sh = Number(l.shares || 0);
      flowValue += nav != null ? sh * nav : Number(l.amount || 0);
      shares.set(l.code, (shares.get(l.code) || 0) + sh);
      cost.set(l.code, (cost.get(l.code) || 0) + Number(l.amount || 0));
      netInvested += Number(l.amount || 0);
    }
    while (sellI < sells.length && sells[sellI].trade_date <= date) {
      const s = sells[sellI];
      sellI += 1;
      const amt = Number(s.settled_amount) || 0;
      const sh = Number(s.settled_shares) || 0;
      const rz = Number(s.settled_realized) || 0;
      const nav = lastNav.get(s.code);
      flowValue -= nav != null ? sh * nav : amt;
      shares.set(s.code, Math.max(0, (shares.get(s.code) || 0) - sh));
      // 赎回带走的成本 = 到账金额 − 这笔的已实现盈亏
      cost.set(s.code, Math.max(0, (cost.get(s.code) || 0) - (amt - rz)));
      netInvested -= amt;
      realized += rz;
    }

    let market = 0;
    let costTotal = 0;
    for (const code of shares.keys()) {
      const navOfCode = navMap.get(code);
      if (navOfCode && navOfCode.has(date)) lastNav.set(code, navOfCode.get(date));
      const nav = lastNav.get(code);
      if (nav != null) market += (shares.get(code) || 0) * nav;
      costTotal += cost.get(code) || 0;
    }

    // 当日盈亏与 TWR 都把现金流剥掉，剩下的才是纯粹的行情涨跌
    const base = prevMarket + flowValue;
    const dayReturn = base > 0 ? (market - prevMarket - flowValue) / base : 0;
    twr *= 1 + dayReturn;

    const profit = market - costTotal + realized;
    points.push({
      date,
      market: round2(market),
      cost: round2(costTotal),
      netInvested: round2(netInvested),
      realized: round2(realized),
      profit: round2(profit),
      returnPct: netInvested > 0 ? round2((profit / netInvested) * 10000) / 100 : 0,
      twrPct: round2((twr - 1) * 10000) / 100,
      // 当日盈亏：市值变化剔除掉现金流，剩下的就是行情带来的。
      // 建仓当天买入即持有，没有「前一天」可比，所以恒为 0
      dailyProfit: round2(market - prevMarket - flowValue),
      // 当日涨跌百分比（百分点）：与 dailyProfit 同源，只是换成相对量，
      // 给模型看组合走势时用它，避免把金额透出去
      dayPct: round2(dayReturn * 10000) / 100,
    });
    prevMarket = market;
  }

  /* ---- 事件：建仓 / 加仓 / 减仓，图上打标记用 ---- */
  const eventMap = new Map();
  const push = (date, key, amount, code) => {
    if (!eventMap.has(date)) eventMap.set(date, { date, add: 0, reduce: 0, init: 0, codes: new Set() });
    const e = eventMap.get(date);
    e[key] = round2(e[key] + amount);
    e.codes.add(code);
  };
  for (const l of lots) {
    if (l.source === 'import') push(l.buy_date, 'init', Number(l.amount || 0), l.code);
    else push(l.buy_date, 'add', Number(l.amount || 0), l.code);
  }
  for (const s of sells) push(s.trade_date, 'reduce', Number(s.settled_amount) || 0, s.code);
  const events = [...eventMap.values()]
    .map((e) => ({ ...e, codes: [...e.codes] }))
    // 起点之前的「建仓」标记没有意义：那段不在图里，标上去只会挂在最左边误导人
    .filter((e) => !from || e.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { points, events, summary: curveSummary(points), from: from || null };
}

/** 曲线的区间统计：最值、回撤、最好/最差的一天 */
function curveSummary(points) {
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];
  let peak = -Infinity;
  let trough = Infinity;
  let maxDrawdown = 0;
  let drawdownAt = null;
  let twrPeak = -Infinity;
  let best = null;
  let worst = null;
  for (const p of points) {
    if (p.returnPct > peak) peak = p.returnPct;
    if (p.returnPct < trough) trough = p.returnPct;
    // 回撤按 TWR 算：简单收益率会被加仓摊薄，用它算回撤会得到假的「没跌过」
    if (p.twrPct > twrPeak) twrPeak = p.twrPct;
    if (twrPeak > 0) {
      // twrPeak / p.twrPct 都是百分点。除以峰值的倍数（1 + peak/100）换成百分点回撤，
      // 分子本身已经是百分数，不要再乘 100
      const dd = (twrPeak - p.twrPct) / (1 + twrPeak / 100);
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        drawdownAt = p.date;
      }
    }
    if (!best || p.dailyProfit > best.dailyProfit) best = p;
    if (!worst || p.dailyProfit < worst.dailyProfit) worst = p;
  }
  // 盈利天数占比：看这段时间是单边涨还是震荡
  const upDays = points.filter((p) => p.dailyProfit > 0).length;
  return {
    from: first.date,
    to: last.date,
    days: points.length,
    market: last.market,
    netInvested: last.netInvested,
    profit: last.profit,
    returnPct: last.returnPct,
    twrPct: last.twrPct,
    peakPct: round2(peak),
    troughPct: round2(trough),
    maxDrawdownPct: round2(maxDrawdown),
    maxDrawdownAt: drawdownAt,
    upDays,
    downDays: points.filter((p) => p.dailyProfit < 0).length,
    bestDay: best ? { date: best.date, profit: best.dailyProfit } : null,
    worstDay: worst ? { date: worst.date, profit: worst.dailyProfit } : null,
  };
}

/**
 * 投资总览：额度模型的依据是「净投入」而不是当前市值。
 *
 * 净投入 = 累计买入金额 − 累计赎回金额 + 已承诺但还没入账的加仓。
 * 用现金流而不是市值，是因为市值会随行情波动——涨了就把额度算多、
 * 跌了又把额度算没，都会让模型的加仓节奏跟着行情抖。
 * 用户设的总额是「我最多拿多少钱出来投」，那就是现金流口径。
 */
export function investmentSummary(cfg, today = null, opts = {}) {
  const db = getDb();
  const totalBudget = Number(cfg?.totalBudget) || 0;
  const targetReturnPct = Number(cfg?.targetReturnPct) || 0;
  // 模型中立：给定时任务算额度时只统计它自己那一格。
  // 一天里同一个基金只能采纳一条建议，让 A 看见 B 报了多少只会互相锚定，
  // 那这份建议就不再独立了。跨来源的超额由我（人）在采纳时自己把关。
  const scopeSource = opts.source || null;

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

  // 当天已排但还没执行的加仓：按每只基金取最大值（同一天同一只只会成交一笔）。
  // 不计入 used（那不是真金白银），但要体现在 available 上。
  // 传了 opts.source 时只算该来源的计划——给模型看的额度不能带上别人的判断，
  // 否则「A 报了 500」这一条信息就会锚住 B 的报价。
  let todayPlanned = 0;
  if (today) {
    // 带了 source 就只统计这个来源自己排的计划（模型中立）；没带就把所有来源合并，
    // 那是页面/核对视角，需要看到「今天一共排出去多少」
    const sql = `SELECT COALESCE(SUM(mx), 0) AS v FROM (
       SELECT MAX(amount) AS mx FROM fund_advice
        WHERE trade_date = ${scopeSource ? '@date' : '?'}
          AND settled = 0 AND executed = 0
          AND action IN ('buy','add') AND amount IS NOT NULL
          ${scopeSource ? `AND IFNULL(source,'workbuddy') = @source` : ''}
        GROUP BY code
     )`;
    const row = scopeSource
      ? db.prepare(sql).get({ date: today, source: scopeSource })
      : db.prepare(sql).get(today);
    todayPlanned = row?.v || 0;
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

/**
 * 持仓视图：批次汇总 + 市值/盈亏，供页面与定时任务使用。
 *
 * @param code 基金代码
 * @param quote 可选，服务端统一抓的盘中估值。传了就优先用它算「波段可卖多少」，
 *              页面和模型才会看到同一个数；市值与浮动盈亏仍按**已公布净值**算，
 *              因为那是真金白银的账，不能被估算值污染。
 */
export function holdingView(code, quote = null) {
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
  const today = todayInShanghai();
  // 波段判断用哪个价：有新鲜盘中估值就用它（模型和页面统一），否则退回最近净值
  const livePx = quote?.fresh && Number(quote.estimate) > 0 ? Number(quote.estimate) : null;
  const px = livePx ?? nav;
  // 先算额度：波段的可卖金额要跟它取小，两个字段必须用同一个价算出来
  const plan = sellPlan(code, px, today, holding);
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
    // lots 是批次数（老字段，页面早就在用），lotList 才是明细
    lots: agg.lots,
    lotList: lotDetail(code, today, holding),
    // 能 0 费卖多少：波段交易的金额上限就靠它，别再让模型拿总成本瞎猜
    sellPlan: plan,
    // 今天能卖哪一部分：逐个加仓批次判断浮盈，达标的合计，再和 0 费额度取小
    swingBasis: swingBasis(code, px, holding, plan ? plan.feeFreeAmount : null, livePx ? 'estimate' : 'nav'),
  };
}

/**
 * 给模型看的组合曲线：只给形状与相对量，不给金额。
 *
 * 它需要知道「整体是在稳步修复，还是刚从深坑里往上爬」——这直接决定该进攻还是守成，
 * 而单看一个 returnPct 快照看不出这两者的区别。
 * 金额一律不下发：模型要的是走势形态，不是我的市值数字。
 */
export function curveForAutomation(limit = 20) {
  const curve = equityCurve();
  if (!curve.points.length) return null;
  const n = Math.min(Math.max(Number(limit) || 20, 5), 200);
  const tail = curve.points.slice(-n);
  const s = curve.summary || {};
  return {
    from: tail[0].date,
    to: tail[tail.length - 1].date,
    // 这里的天数必须是**这条切片**的长度。曾经取 summary 的全量天数，
    // 于是模型看到「days: 98，但只有 20 个点、日期从 9-17 起」，自相矛盾
    days: tail.length,
    points: tail.map((p) => ({
      date: p.date,
      returnPct: p.returnPct,
      twrPct: p.twrPct,
      dayPct: p.dayPct ?? null,
    })),
    // 区间统计：回撤按 TWR 算，涨跌天数看这段时间是单边还是震荡
    maxDrawdownPct: s.maxDrawdownPct ?? null,
    maxDrawdownAt: s.maxDrawdownAt ?? null,
    peakPct: s.peakPct ?? null,
    troughPct: s.troughPct ?? null,
    upDays: s.upDays ?? null,
    downDays: s.downDays ?? null,
  };
}

/**
 * 减仓成本提示：最早那批还要多久降档、现在卖要扣多少。
 *
 * 卖出是按批次 FIFO 的，最先卖掉的一定是最早买入的那批，所以持有天数取
 * 「仍有剩余份额的最早批次」。模型不知道这个数就会在 7 天内建议减仓——
 * 1.5% 的赎回费足以把一笔聪明的高抛变成亏钱操作。
 */
export function holdingAgeInfo(code, today, holding = null) {
  const h = holding || getHolding(code);
  if (!h) return null;
  const rules = parseFeeRules(h.redemption_fee);
  const lots = lotsOf(code).filter((l) => Number(l.remain) > 0);
  if (!lots.length) return null;
  const earliest = lots.reduce((m, l) => (l.buy_date < m.buy_date ? l : m));
  const minHoldDays = dayDiff(earliest.buy_date, today);

  // 下一个会降档的天数边界：所有大于当前持有天数的 days 里最小的那个
  let next = null;
  for (const r of rules) {
    if (r.days === null) continue;
    if (r.days > minHoldDays && (next === null || r.days < next)) next = r.days;
  }

  return {
    earliestBuyDate: earliest.buy_date,
    minHoldDays,
    currentFeePct: feeRateFor(rules, minHoldDays),
    daysToNextTier: next === null ? null : next - minHoldDays,
    nextTierFeePct: next === null ? null : feeRateFor(rules, next),
  };
}

/**
 * 批次明细，按 FIFO 顺序返回——卖出就是这个顺序。
 *
 * 两类批次必须区别对待：
 *
 *   base（source='import'）——**原始底仓**
 *     它是用户前半年反复投入累积的结果，根本不存在「某一天一次性买入」。
 *     所以没有可信的买入日，也没有单一单位净值，只有两个真实信息：
 *     总成本（amount）与总份额（shares），相除得到的成本价是加权平均。
 *
 *     按用户约定，这部分卖出**一律不扣赎回费**：持有期远超所有档位。
 *     这里直接给 feePct=0，而不是拿一个兜底出来的假日期去套费率表——
 *     假日期（净值序列起点）一旦因为补数据变到近期，整批底仓就会被
 *     误判成 1.5%，那笔「手续费吃掉收益」就是这么来的。
 *
 *   buy（按建议买入的批次）
 *     日期与成交净值都是真实的，照常按持有天数套档位。
 *
 * 注意：底仓在 FIFO 队列里永远排最前（它的 buy_date 是最早的），
 * 所以卖出时它是最先被消耗的那一批，也是「0 费额度」的主体。
 */
export function lotDetail(code, today = null, holding = null) {
  const h = holding || getHolding(code);
  if (!h) return [];
  const t = today || todayInShanghai();
  const rules = parseFeeRules(h.redemption_fee);
  const firstBuy = String(h.first_buy_date || '').trim();
  return lotsOf(code)
    .filter((l) => Number(l.remain) > 0.000001)
    .map((l) => {
      const isBase = String(l.source || '') === 'import';
      // 用户若明确填了 first_buy_date，说明他知道真实建仓日，那就照实算；
      // 没填就按底仓豁免处理（半年累积，不可能还在收费档）
      const exempt = isBase && !firstBuy;
      const days = dayDiff(l.buy_date, t);
      return {
        kind: isBase ? 'base' : 'buy',
        // 底仓没有可信买入日，宁可不给，也不给一个看起来像真的假日期
        buyDate: isBase ? null : l.buy_date,
        dateKnown: !isBase,
        unitCost: round4(l.unit_cost),
        shares: round2(l.remain),
        costAmount: round2(Number(l.remain) * Number(l.unit_cost)),
        daysHeld: isBase ? null : days,
        feePct: exempt ? 0 : feeRateFor(rules, days),
        feeExempt: exempt,
        source: l.source || null,
      };
    });
}

/**
 * 0 费卖出额度：这次能卖多少钱不花手续费。
 *
 * 卖出按 FIFO 从队首消耗，所以「能 0 费卖多少」= 队首连续 0 费批次之和。
 * 队首一旦是收费档，这个数就是 0——那就别建议卖，或者明说要付多少。
 *
 * segments 把 FIFO 队列按费率切成段，让模型看到
 * 「卖到 X 元为止还免费，再多就要扣 Y%」，而不是只知道一个总数。
 */
export function sellPlan(code, nav, today = null, holding = null) {
  const h = holding || getHolding(code);
  if (!h) return null;
  const t = today || todayInShanghai();
  const lots = lotDetail(code, t, h);
  if (!lots.length) return null;
  const px = Number(nav);
  if (!Number.isFinite(px) || px <= 0) return null;

  let freeShares = 0;
  for (const l of lots) {
    if (l.feePct > 0) break;
    freeShares += l.shares;
  }

  const segments = [];
  for (const l of lots) {
    const last = segments[segments.length - 1];
    if (last && last.feePct === l.feePct) last.shares = round2(last.shares + l.shares);
    else segments.push({ feePct: l.feePct, shares: l.shares });
  }
  let run = 0;
  for (const s of segments) {
    run = round2(run + s.shares);
    s.uptoShares = run;
    s.uptoAmount = round2(run * px);
  }

  const baseLots = lots.filter((l) => l.kind === 'base');
  const baseShares = round2(baseLots.reduce((s, l) => s + l.shares, 0));
  const baseCost = round2(baseLots.reduce((s, l) => s + l.costAmount, 0));

  let note;
  if (!freeShares) {
    note = '队首批次仍在收费档，当前卖出任何金额都要扣赎回费';
  } else if (baseShares && freeShares <= baseShares + 0.005) {
    note = `原始底仓 ${baseShares} 份（成本价 ${round4(baseCost / baseShares)}）卖出 0 费，`
      + `可卖 ¥${round2(freeShares * px)}；再往后进入下一档费率`;
  } else if (baseShares) {
    // 0 费区间超过底仓，说明中间还有几个已经熬过 7 天的加仓批次，一并算进来
    note = `原始底仓 ${baseShares} 份，加已过费档的加仓批次，合计可 0 费卖 `
      + `¥${round2(freeShares * px)}；再往后进入下一档费率`;
  } else {
    note = `前 ¥${round2(freeShares * px)} 卖出 0 费，再往后进入下一档费率`;
  }

  return {
    nav: round4(px),
    totalShares: round2(lots.reduce((s, l) => s + l.shares, 0)),
    feeFreeShares: round2(freeShares),
    feeFreeAmount: round2(freeShares * px),
    // 底仓单独给一份：页面要把它当作「历史累积仓位」展示，不是一次买入
    base: baseShares > 0
      ? {
          shares: baseShares,
          costAmount: baseCost,
          unitCost: round4(baseCost / baseShares),
          feeExempt: baseLots.every((l) => l.feeExempt),
        }
      : null,
    segments,
    note,
  };
}

/** 止盈线兜底值：库里没配时用它。真正的值由 settings 的 `fund.swingTargetPct` 决定 */
const SWING_TARGET_DEFAULT_PCT = 3;
/**
 * 估值噪声余量：实测平均绝对误差 0.27%，留 0.3pp。
 * 触发线 = 止盈线 − 余量，避免模型在 2.9%/3.1% 之间反复改口。
 */
const SWING_NOISE_BUFFER_PCT = 0.3;

/** 止盈线与触发线都由配置算出，页面改完立刻生效（不做缓存） */
function swingThresholds() {
  const raw = Number(getFundConfig().swingTargetPct);
  const target = Number.isFinite(raw) && raw > 0 ? raw : SWING_TARGET_DEFAULT_PCT;
  // 触发线不能是负数，也不能高于目标线
  const trigger = Math.max(0, Math.round((target - SWING_NOISE_BUFFER_PCT) * 100) / 100);
  return { target, trigger };
}

/**
 * 波段参考 —— 判断「今天能卖哪一部分」，**和算费用的是两回事**。
 *
 * 踩过两次坑，都记在这里：
 *
 * ① 一开始让模型拿 `lotList[0].unitCost` 算浮盈。但 FIFO 队首**永远是原始底仓**，
 *    底仓是半年前高点建的，成本远高于现价（实测 -10% ~ -22%），
 *    「浮盈 ≥3%」从设计上就永远不成立，波段一次也触发不了。
 *
 * ② 改成「只看最近一次加仓」也还是不对。波段是**逐批独立**的：
 *    每一次加仓都是一个独立的小仓位，各自赚没赚到 3% 要分开算。
 *    今天可能只有 10-15 那批到了 3%，10-21 那批还没到 —— 那就只卖达标的那部分。
 *
 * 所以现在的口径：
 *   逐个加仓批次算 gainPct → 挑出 `qualifies` 的 → 金额合计 `candidateAmount`
 *   → 和 0 费额度取小 → `sellableAmount`（就是今天该报的卖出金额）
 *
 * 而 `lotList[0]` 只负责回答另一个问题：这笔卖出去扣几成费。
 *
 * ③ 第三个坑（2026-11-06 修）：**卖过的批次会被再算一遍**。
 *    卖出结算按 FIFO 从最老批次扣 `remain`，队首几乎永远是 import 底仓，
 *    所以「11-02 加仓那批已经止盈卖掉」在账本上没有任何痕迹 ——
 *    它的 remain 还是满的，第二天 swingBasis 又把它算进 candidateAmount。
 *    实测 11-04 卖 020274 165.96 份，底仓 484.48→318.52，六笔加仓批次一分未动。
 *
 * 因此两套口径刻意分开，谁也不改谁：
 *    fund_lots.remain  → 真实份额 / 赎回费 / 已实现盈亏（FIFO，结算用，不动）
 *    下面的 closed     → 哪几次加仓的波段机会已经用掉（只用于出建议）
 *
 * 冲抵规则：每笔已执行的 reduce/sell，只冲抵「卖出日之前买入」的加仓批次，
 * 由近到远（LIFO，符合「卖的是最近那次加仓」的心智）。用卖出日作上界，
 * 是为了不误伤之后按 buyBackPrice 买回来的新批次。
 */

/** 已执行过的减仓，折算成份额；按交易日升序返回，供 swingBasis 逐笔冲抵 */
function closedSwingSells(code) {
  const rows = getDb()
    .prepare(
      `SELECT trade_date, amount, nav, settled_nav, settled_shares
         FROM fund_advice
        WHERE code = ? AND executed = 1
          AND action IN ('reduce', 'sell') AND amount > 0
        ORDER BY trade_date, id`
    )
    .all(code);

  return rows
    .map((r) => {
      let shares = Number(r.settled_shares);
      if (!Number.isFinite(shares) || shares <= 0) {
        // 还没结算也要算进去：否则当天点完「已执行」，模型重跑时又会重复建议
        const px = Number(r.settled_nav) || Number(r.nav);
        shares = px > 0 ? Number(r.amount) / px : 0;
      }
      return { date: r.trade_date, shares };
    })
    .filter((s) => s.shares > 0);
}

export function swingBasis(code, price, holding = null, feeFreeAmount = null, priceSource = 'nav') {
  const h = holding || getHolding(code);
  if (!h) return null;
  const px = Number(price);
  if (!Number.isFinite(px) || px <= 0) return null;
  const { target, trigger } = swingThresholds();

  // 只看系统上线后的加仓批次；底仓不参与波段判断（它是历史沉积，不是波段仓位）
  const buyLots = lotsOf(code)
    .filter((l) => Number(l.remain) > 0.000001 && String(l.source || '') !== 'import')
    .map((l) => ({ ...l, closed: 0 }));

  // 把已经执行过的减仓冲抵到加仓批次上：由近到远，只冲抵卖出日之前买入的。
  // 这里改的是建议层的「还有没有波段机会」，账本 remain 一分不动。
  const sells = closedSwingSells(code);
  let closedShares = 0;
  for (const sell of sells) {
    let left = sell.shares;
    const pool = buyLots
      .filter((b) => b.buy_date < sell.date)
      .sort((a, b) => (a.buy_date < b.buy_date ? 1 : a.buy_date > b.buy_date ? -1 : b.id - a.id));
    for (const b of pool) {
      if (left <= 0.000001) break;
      const take = Math.min(Math.max(0, Number(b.remain) - b.closed), left);
      if (take <= 0.000001) continue;
      b.closed += take;
      left -= take;
      closedShares += take;
    }
  }

  const lots = buyLots
    .map((l) => {
      const cost = Number(l.unit_cost);
      const shares = round2(Math.max(0, Number(l.remain) - l.closed));
      const gainPct = cost > 0 ? round2((px / cost - 1) * 100) : null;
      return {
        buyDate: l.buy_date,
        unitCost: round4(cost),
        shares,
        /** 这一批里已经做过波段、不再重复计入的份额 */
        closedShares: round2(l.closed),
        gainPct,
        // 这一批按现价还能卖多少钱
        marketValue: round2(shares * px),
        qualifies: shares > 0.000001 && gainPct != null && gainPct >= trigger,
      };
    })
    .filter((l) => l.shares > 0.000001);

  const qualified = lots.filter((l) => l.qualifies);
  const candidateAmount = round2(qualified.reduce((s, l) => s + l.marketValue, 0));
  const candidateShares = round2(qualified.reduce((s, l) => s + l.shares, 0));

  const free = feeFreeAmount == null ? null : round2(feeFreeAmount);
  let sellableAmount = candidateAmount;
  let cappedBy = qualified.length ? 'candidates' : null;
  if (qualified.length && free != null && free < candidateAmount) {
    sellableAmount = free;
    cappedBy = 'feeFree';
  }
  // 金额必须整百，服务端直接砍好，省得模型再算一遍又算错
  const suggestedAmount = Math.floor(sellableAmount / 100) * 100;
  // 已平掉大半后可能只剩几块钱：这时 qualifiedCount 仍 > 0，但报出去会让
  // /ingest 因 amount=0 拒绝。明确标出来，别让 note 说「可以全卖」误导模型。
  const belowMinLot = qualified.length > 0 && suggestedAmount < 100;

  const closedNote = closedShares > 0.000001
    ? `已扣除 ${round2(closedShares)} 份此前减仓过的加仓批次（不再重复建议）；`
    : '';
  let note;
  if (belowMinLot) {
    note = `${closedNote}达标批次只剩 ¥${candidateAmount}，砍成整百后不足一手，今天不做波段`;
  } else if (!lots.length) {
    note = closedNote
      ? `${closedNote}已没有剩余可做波段的加仓仓位，今天不做波段`
      : '还没有系统上线后的加仓批次，没有可做波段的仓位；底仓成本只影响卖出记账';
  } else if (!qualified.length) {
    const best = lots.reduce((m, l) => ((l.gainPct ?? -999) > (m.gainPct ?? -999) ? l : m));
    note = `${closedNote}${lots.length} 个加仓批次都没到 ${target}%（最好的是 ${best.buyDate} @${best.unitCost}，`
      + `现价 ${best.gainPct}%），今天不做波段`;
  } else if (cappedBy === 'feeFree') {
    note = `${closedNote}${qualified.length} 个批次达标，合计 ¥${candidateAmount}，`
      + `但 0 费额度只有 ¥${free}，只能卖 ¥${sellableAmount}；剩下的等额度恢复（或下个交易日）再卖`;
  } else {
    note = `${closedNote}${qualified.length} 个批次达标，合计 ¥${candidateAmount}，0 费额度够，可以全卖`;
  }

  return {
    price: round4(px),
    /** 这个价是哪来的：estimate=盘中实时估值，nav=最近一期已公布净值 */
    priceSource,
    targetPct: target,
    triggerPct: trigger,
    /** 逐个加仓批次，FIFO 之外的另一个维度：谁赚到了 3%（已平完的批次不再列出） */
    lots,
    /** 已经减仓过、不再重复计入的份额 / 按现价折算的金额；只影响建议层 */
    closedShares: round2(closedShares),
    closedAmount: round2(closedShares * px),
    /** 参与冲抵的已执行减仓笔数，排查口径时用 */
    closedSellCount: sells.length,
    qualifiedCount: qualified.length,
    qualifiedShares: candidateShares,
    /** 达标批次按现价合计能卖多少钱 */
    candidateAmount,
    /** 实际可卖金额（已和 0 费额度取小） */
    sellableAmount,
    /** 再砍成整百，模型直接用这个数报 amount */
    suggestedAmount,
    /** true = 还剩一点达标份额但不足一手，今天应给 hold，不要报 amount=0 的卖出 */
    belowMinLot,
    /** candidates=受限于达标金额；feeFree=受限于 0 费额度；null=没有达标批次 */
    cappedBy,
    feeFreeAmount: free,
    note,
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
