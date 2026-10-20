/**
 * 事后评估：每条建议单独放进「它自己的未来」里打分。
 *
 * ── 为什么不能只评已采纳的建议 ────────────────────────────────────
 * 一天里三个模型对同一只基金常常给出不同建议，但人只挑一条执行。
 * 如果只给「被执行过的那一条」打分：
 *   1. 样本直接少掉三分之二（62 条里只有 18 条被采纳）；
 *   2. 剩下的样本还被人自己的偏好筛过一遍——比如人更敢采纳 high confidence 的，
 *      那分数里混着「模型准」和「人挑得准」两件事，等于两份功劳记在一个人头上。
 * 所以这里是**纸上交易**：每条建议都假设当天真的按它执行了，各自对着
 * 同一条 forward 净值曲线算收益。采纳与否只作为一列字段带出来供对照，
 * 不进打分公式。
 *
 * ── 三个层次 ──────────────────────────────────────────────────────
 *   ① 模型成绩单  —— 逐条建议的前瞻收益 / 方向胜率，按来源、基金、置信度拆分
 *   ② 模拟组合    —— 假设某段时间全听某一家，跑出一个组合收益（和真实对照）
 *   ③ 挑选增值    —— 同一天同一只基金，人挑的那条比没挑的那几条好多少
 *
 * ── 隔离红线 ──────────────────────────────────────────────────────
 * ① 是各家自己跟行情对答案，将来可以回传给模型当参考（目前按用户要求**不**回传）。
 * ②③ 里含横向比较和人自己的选择，**永远不许回传给任何模型**——
 * 一旦模型知道自己正在被人打分排行，它就会照着排行榜调答案，这份评估也就失效了。
 * 这两个结果只出现在登录后的页面上。
 */

import { getDb } from '../db/index.js';
import { normalizeSource, SOURCE_LABELS } from './fundSource.js';
import { getFundConfig } from './fundConfig.js';
import { parseFeeRules, feeRateFor } from './position.js';

/** 前瞻窗口（按交易日算，不是自然日） */
export const EVAL_WINDOWS = [
  { key: 't1', days: 1, label: '次日' },
  { key: 't3', days: 3, label: '3 个交易日后' },
  { key: 't5', days: 5, label: '5 个交易日后' },
  { key: 't10', days: 10, label: '10 个交易日后' },
  { key: 't20', days: 20, label: '20 个交易日后' },
];

/** 选主视窗时的偏好顺序：长窗口信息量大，但样本也少，够长就用长的 */
const PRIMARY_ORDER = ['t20', 't10', 't5', 't3', 't1'];

const WINDOW_BY_KEY = Object.fromEntries(EVAL_WINDOWS.map((w) => [w.key, w]));

/** 一个结论至少要有这么多条可评数据才敢下判断；不到就标 insufficient */
const MIN_SAMPLES = 5;

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

/** 方向：只有真的下了注（加减仓）才计入胜负率；hold 不下注，单列统计 */
function betOf(action) {
  if (action === 'buy' || action === 'add') return 'long';
  if (action === 'reduce' || action === 'sell') return 'short';
  return 'none';
}

const BET_SIGN = { long: 1, short: -1, none: 0 };

/* ------------------------------------------------------------------ */
/* 数据装载                                                            */
/* ------------------------------------------------------------------ */

function loadNavSeries() {
  const db = getDb();
  const series = new Map();
  const rows = db.prepare(`SELECT code, nav_date, nav FROM fund_nav ORDER BY code, nav_date ASC`).all();
  for (const r of rows) {
    if (!series.has(r.code)) series.set(r.code, []);
    series.get(r.code).push({ date: r.nav_date, nav: r.nav });
  }
  const index = new Map();
  for (const [code, arr] of series) index.set(code, new Map(arr.map((p, i) => [p.date, i])));
  return { series, index };
}

/**
 * 从「建议日」往前看 kay。
 *
 * 基准价用**建议当天**的收盘净值：国内基金当天 15:00 前下单就是按当天收盘价成交，
 * 所以这既是清算价，也是假设执行时的成交价。不要拿 advice 里模型自己带的 nav——
 * 那是估算值，各家口径不一，用它算收益等于给模型自带的工作量打分。
 */
function forwardReturn(series, index, code, baseDate) {
  const arr = series.get(code);
  if (!arr || arr.length === 0) return null;
  const i = index.get(code)?.get(baseDate);
  // 当天净值还没入库 → 这条建议暂时没法评（不是评不出来，是时候没到）
  if (i == null) return null;
  const base = arr[i].nav;
  if (!Number.isFinite(base) || base <= 0) return null;
  const windows = {};
  for (const w of EVAL_WINDOWS) {
    const j = i + w.days;
    if (j >= arr.length) {
      windows[w.key] = null;
      continue;
    }
    windows[w.key] = {
      date: arr[j].date,
      nav: arr[j].nav,
      pct: r2(((arr[j].nav - base) / base) * 100),
    };
  }
  return { baseNav: r4(base), windows };
}

/* ------------------------------------------------------------------ */
/* ① 模型成绩单                                                        */
/* ------------------------------------------------------------------ */

/**
 * 把一条建议行折算成「面向未来的一行评估结果」。
 *
 * 三个打分口径，各有各的用处：
 *
 *   fwd[w]    基金自己这段时间的涨跌（百分点）。与建议无关，纯粹是行情答案。
 *   score[w]  **方向口径**：long = +fwd，short = −fwd，hold = null（不下注就不算分）。
 *             用来看「它押方向押得准不准」，是最干净的一个，但天生缺了一半样本——
 *             这个账户里的建议一半以上是 hold。
 *   unit[w]   **机会成本口径**：hold = 0 而不是 null。账户还在建仓期，
 *             每天真正的问题其实是「这笔钱今天投不投」：add 是投，hold 是不投。
 *             不投入现金的收益就是 0，拿 0 当基准，add 的分数自然等于
 *             「投了比不投多赚多少」。这样每一条建议都能进账。
 *   profit[w] **金额口径**：amount × fwd / 100（元）。amount 带符号
 *             （买为正、卖为负），所以这一格自动把方向、金额合并了：
 *             买 500 涨 2% = +10 元；卖 500 涨 2% = −10 元（少赚的）；
 *             hold 金额为空 = 0 元（不赚不亏）。看「照它做会多赚多少钱」用它。
 *
 * 注意这三个口径的差值才是可比的：benchmark 从「持有现金」换成「全额投入」，
 * 每行都整体平移同一个常数，减法一减就消掉了。所以层 ③ 的挑选增值
 * 用哪个口径都一样，展示给用户看哪个顺眼就给哪个。
 */
function scoreRow(a, ctx) {
  const source = normalizeSource(a.source);
  const bet = betOf(a.action);
  const fwd = forwardReturn(ctx.series, ctx.index, a.code, a.trade_date);
  const amount = a.amount == null ? 0 : Number(a.amount) || 0;
  const base = {
    id: a.id,
    code: a.code,
    name: ctx.names.get(a.code) || a.code,
    tradeDate: a.trade_date,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    action: a.action,
    confidence: a.confidence || null,
    amount: Math.round(amount),
    adopted: Boolean(a.executed),
    settled: Boolean(a.settled),
    bet,
  };
  if (!fwd) {
    return {
      ...base,
      status: 'pending-nav',
      baseNav: null,
      fwd: {},
      score: {},
      unit: {},
      profit: {},
      hit: {},
    };
  }
  const sign = BET_SIGN[bet];
  const fwdPct = {};
  const score = {};
  const unit = {};
  const profit = {};
  const hit = {};
  for (const w of EVAL_WINDOWS) {
    const p = fwd.windows[w.key];
    if (!p) {
      fwdPct[w.key] = null;
      score[w.key] = null;
      unit[w.key] = null;
      profit[w.key] = null;
      hit[w.key] = null;
      continue;
    }
    fwdPct[w.key] = p.pct;
    // profit 用带符号金额：买正卖负，符号自动把方向带上
    profit[w.key] = r2((amount * p.pct) / 100);
    if (bet === 'none') {
      score[w.key] = null;
      unit[w.key] = 0;
      hit[w.key] = null;
    } else {
      score[w.key] = r2(sign * p.pct);
      unit[w.key] = r2(sign * p.pct);
      hit[w.key] = sign * p.pct > 0;
    }
  }
  const evaluable = EVAL_WINDOWS.some((w) => fwdPct[w.key] != null);
  return {
    ...base,
    status: evaluable ? 'ok' : 'awaiting',
    baseNav: fwd.baseNav,
    fwd: fwdPct,
    score,
    unit,
    profit,
    hit,
  };
}

/**
 * 一组行在某个窗口上的统计。
 *
 * 为什么必须同时给出两套口径：
 * 「方向口径」只统计真下注的建议（add/reduce），样本干净但会丢掉一大半行——
 * 这个账户一半以上的建议是 hold，只看押注的那天＝只见一半的模型。
 * 「机会成本口径」给 hold 记 0 分，全部行都能进账，能回答
 * 「把它的建议照单全收会怎样」，代价是把保守也折算成了收益。
 * 两个都给，谁看页面都不能只挑其中一个讲故事。
 */
function windowStats(rows, key) {
  const w = WINDOW_BY_KEY[key];
  const betRows = rows.filter((r) => r.score[key] != null);
  const allRows = rows.filter((r) => r.unit[key] != null);
  const holds = rows.filter((r) => r.bet === 'none' && r.fwd[key] != null);

  const holdValues = holds.map((r) => r.fwd[key]);
  return {
    key,
    label: w.label,
    days: w.days,
    /** 方向口径：只有押注的建议参与 */
    directional: statBlock(betRows, (r) => r.score[key], `${w.label}·方向`),
    /** 机会成本口径：所有能看后市的建议都参与，hold 记 0 */
    opportunity: statBlock(allRows, (r) => r.unit[key], `${w.label}·机会成本`),
    /** 金额口径：按各自的建议金额折算成元（只有具体金额的建议才有值） */
    money: moneyBlock(rows, key),
    hold: {
      count: holds.length,
      avgFwdPct: r2(mean(holdValues)),
      avoidedDrop: holdValues.filter((v) => v < 0).length,
      missedRise: holdValues.filter((v) => v > 0).length,
    },
  };
}

/** 百分点口径的统计块 */
function statBlock(list, valueOf, label) {
  const values = list.map(valueOf);
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v < 0);
  let best = null;
  let worst = null;
  for (const r of list) {
    const v = valueOf(r);
    if (!best || v > best.value) best = { row: r, value: v };
    if (!worst || v < worst.value) worst = { row: r, value: v };
  }
  return {
    label,
    count: list.length,
    insufficient: list.length < MIN_SAMPLES,
    avgScorePct: r2(mean(values)),
    medianScorePct: r2(median(values)),
    stdScorePct: r2(stdev(values)),
    // 胜率分母是全部参与行。机会成本口径下 hold 得 0 既不计胜也不计负，
    // 只在目视 even 里体现——「这家今天没干活」本身也是个信息
    winRate: values.length ? r2((wins.length / values.length) * 100) : null,
    wins: wins.length,
    losses: losses.length,
    even: values.length - wins.length - losses.length,
    bestScorePct: best?.value ?? null,
    best: best ? pickBrief(best.row, best.value) : null,
    worstScorePct: worst?.value ?? null,
    worst: worst ? pickBrief(worst.row, worst.value) : null,
  };
}

/** 元口径的统计块：把每条建议都当成一个只有建议金额那么大的小账户 */
function moneyBlock(rows, key) {
  const list = rows.filter((r) => r.profit[key] != null && r.amount !== 0);
  const values = list.map((r) => r.profit[key]);
  const invested = list.map((r) => Math.abs(r.amount));
  return {
    label: `${WINDOW_BY_KEY[key].label}·金额`,
    count: list.length,
    insufficient: list.length < MIN_SAMPLES,
    totalProfit: r2(values.reduce((a, b) => a + b, 0)),
    avgProfit: r2(mean(values)),
    // 单位是这个窗口内赚了多少个百分点：加起来/投进去 = 加权利率，不受金额大小干扰
    avgReturnPct: invested.length && mean(invested) > 0 ? r2((mean(values) / mean(invested)) * 100) : null,
    wins: values.filter((v) => v > 0).length,
    losses: values.filter((v) => v < 0).length,
  };
}

function pickBrief(r, value) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    tradeDate: r.tradeDate,
    action: r.action,
    source: r.source,
    amount: r.amount,
    value: r2(value),
  };
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 拆分到各个维度 */
function groupStats(rows, keyFn, key, extra = () => ({})) {
  const groups = new Map();
  for (const r of rows) {
    if (r.status !== 'ok') continue;
    const k = keyFn(r);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  // windowStats 自己也带 key/label（那是窗口的），不能让它把分组名盖掉——
  // 曾经直接展开，结果「按置信度」那张表的分组名全变成了 t3/t5 这样的窗口名
  return [...groups.entries()].map(([k, list]) => {
    const { key: windowKey, label: windowLabel, ...rest } = windowStats(list, key);
    return { key: k, windowKey, windowLabel, ...rest, ...extra(k, list) };
  }).sort((a, b) => (b.opportunity.avgScorePct ?? -1e9) - (a.opportunity.avgScorePct ?? -1e9));
}

/**
 * 层 ①：逐条建议的成绩单。
 * @param {{source?:string, code?:string, limit?:number}} options
 */
export function adviceScorecard(options = {}) {
  const db = getDb();
  const ctx = { ...loadNavSeries() };
  ctx.names = new Map(
    db.prepare(`SELECT code, name FROM fund_holdings`).all().map((h) => [h.code, h.name])
  );

  const where = [];
  const args = [];
  if (options.source) {
    where.push(`IFNULL(source,'workbuddy') = ?`);
    args.push(normalizeSource(options.source));
  }
  if (options.code) {
    where.push(`code = ?`);
    args.push(String(options.code));
  }
  const sql = `SELECT * FROM fund_advice ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY trade_date DESC, code, source`;
  const rows = db.prepare(sql).all(...args).map((a) => scoreRow(a, ctx));

  const limit = Number(options.limit) || 0;
  const truncated = limit > 0 && rows.length > limit;
  const view = truncated ? rows.slice(0, limit) : rows;

  // 主视窗：窗口越长越有信息量，但数据也越新越没有。挑「样本够的最长窗口」，
  // 一个都不够就退回 t1，并把 insufficient 标出来，让人知道现在看的是短期噪声。
  // 样本数以「机会成本口径」计（hold 也算），不然刚起步时永远凑不够数
  const counts = {};
  const betCounts = {};
  for (const w of EVAL_WINDOWS) {
    counts[w.key] = rows.filter((r) => r.unit[w.key] != null).length;
    betCounts[w.key] = rows.filter((r) => r.score[w.key] != null).length;
  }
  const primary = PRIMARY_ORDER.find((k) => counts[k] >= MIN_SAMPLES) || 't1';

  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const allWindows = Object.fromEntries(EVAL_WINDOWS.map((w) => [w.key, windowStats(rows, w.key)]));

  return {
    // rows 可能按 limit 截断（给页面表格用），allRows 始终是全量——
    // 层 ③ 挑选增值必须用全量，截断会把后半段的决策直接吞掉
    rows: view,
    allRows: rows,
    rowCount: rows.length,
    truncated,
    windows: allWindows,
    windowSampleCounts: counts,
    windowBetCounts: betCounts,
    primary,
    primaryInsufficient: counts[primary] < MIN_SAMPLES,
    minSamples: MIN_SAMPLES,
    span: rows.length
      ? {
          from: rows[rows.length - 1].tradeDate,
          to: rows[0].tradeDate,
          days: new Set(rows.map((r) => r.tradeDate)).size,
        }
      : null,
    bySource: groupStats(rows, (r) => r.source, primary, (k) => ({
      source: k,
      sourceLabel: SOURCE_LABELS[k] || k,
    })),
    byFund: groupStats(rows, (r) => r.code, primary, (k, list) => ({
      code: k,
      name: list[0].name,
    })),
    byConfidence: groupStats(rows, (r) => r.confidence || 'unset', primary),
    bySourceFund: groupStats(rows, (r) => `${r.source}|${r.code}`, primary, (k, list) => ({
      source: list[0].source,
      sourceLabel: list[0].sourceLabel,
      code: list[0].code,
      name: list[0].name,
    })),
    bySourceConfidence: groupStats(rows, (r) => `${r.source}|${r.confidence || 'unset'}`, primary, (k, list) => ({
      source: list[0].source,
      sourceLabel: list[0].sourceLabel,
      confidence: list[0].confidence || 'unset',
    })),
    sources,
  };
}

/* ------------------------------------------------------------------ */
/* ② 模拟组合                                                          */
/* ------------------------------------------------------------------ */

/**
 * 完全照某一家（或完全不操作）跑一遍，看结果会怎样。
 *
 * 起点刻意和真实组合对齐——每条曲线都从同一份「建议期之前就有的老仓位」出发，
 * 只在建议期之后按各自的剧本走。这样曲线之间的差异才纯粹是「听谁的」造成的，
 * 而不是谁的底仓更便宜。
 *
 * 额度也照真实约束来（总投资上限），否则一个天天喊满仓的来源会被算成收益冠军。
 *
 * @param {string|null} source  null = 无操作基准（只拿着老仓位不动）
 */
export function simulateSource(source, options = {}) {
  const db = getDb();
  const cfg = options.cfg || getFundConfig();
  const totalBudget = Number(cfg.totalBudget) || 0;
  const { series } = loadNavSeries();

  // 所有基金的所有交易日，汇成一条时间轴
  const dateSet = new Set();
  for (const arr of series.values()) for (const p of arr) dateSet.add(p.date);
  const dates = [...dateSet].sort();
  if (!dates.length) return null;

  const holdings = new Map(
    db.prepare(`SELECT code, name, purchase_fee, redemption_fee FROM fund_holdings`).all().map((h) => [h.code, h])
  );

  // 老仓位：把「采纳建议买出来的批次」排除掉——那正是我们要重跑的部分。
  // 重新 include 的话，第一行 becomes「既听了它的又听了人的」，两边都算一遍钱。
  const lots = db
    .prepare(
      `SELECT code, buy_date, nav, amount, shares, unit_cost, source
         FROM fund_lots
        WHERE IFNULL(source,'') <> 'advice'
        ORDER BY buy_date, id`
    )
    .all();

  const adviceRows = source
    ? db
        .prepare(
          `SELECT code, trade_date, action, amount FROM fund_advice
            WHERE IFNULL(source,'workbuddy') = ? ORDER BY trade_date, id`
        )
        .all(source)
    : [];
  const adviceByDate = new Map();
  for (const a of adviceRows) {
    if (!adviceByDate.has(a.trade_date)) adviceByDate.set(a.trade_date, []);
    adviceByDate.get(a.trade_date).push(a);
  }
  // 模拟的第一天：只要有建议就开始，之前的时间线三家完全一致
  const adviceDates = adviceRows.map((a) => a.trade_date).sort();
  const startDate = adviceDates[0] || null;

  const shares = new Map();
  const cost = new Map();
  const queues = new Map(); // FIFO 批次：只在模拟减仓时用来算赎回费
  const lastNav = new Map();
  let netInvested = 0;
  let realized = 0;
  let twr = 1;
  let prevMarket = 0;
  let trades = 0;
  let lotI = 0;

  const pushLot = (code, date, sh, unitCost) => {
    if (!queues.has(code)) queues.set(code, []);
    queues.get(code).push({ shares: sh, buyDate: date, unitCost });
  };

  const points = [];
  for (const date of dates) {
    for (const [code, arr] of series) {
      const p = arr.find((x) => x.date === date);
      if (p) lastNav.set(code, p.nav);
    }

    let flowValue = 0;
    while (lotI < lots.length && lots[lotI].buy_date <= date) {
      const l = lots[lotI];
      lotI += 1;
      const sh = Number(l.shares) || 0;
      const amt = Number(l.amount) || 0;
      const nav = lastNav.get(l.code);
      flowValue += nav != null ? sh * nav : amt;
      shares.set(l.code, (shares.get(l.code) || 0) + sh);
      cost.set(l.code, (cost.get(l.code) || 0) + amt);
      netInvested += amt;
      pushLot(l.code, l.buy_date, sh, Number(l.unit_cost) || nav || 0);
    }

    if (startDate && date >= startDate) {
      for (const a of adviceByDate.get(date) || []) {
        const code = a.code;
        const nav = lastNav.get(code);
        if (!nav || nav <= 0) continue;
        const h = holdings.get(code);
        const raw = Math.abs(Number(a.amount) || 0);
        const act = a.action;

        if (act === 'buy' || act === 'add') {
          let amt = raw;
          if (totalBudget > 0) amt = Math.min(amt, Math.max(0, totalBudget - netInvested));
          // 金额必须整百，和服务端下发规则保持一致
          amt = Math.floor(amt / 100) * 100;
          if (amt <= 0) continue;
          const rate = Math.max(0, Number(h?.purchase_fee) || 0) / 100;
          const sh = amt / (1 + rate) / nav;
          flowValue += sh * nav;
          shares.set(code, (shares.get(code) || 0) + sh);
          cost.set(code, (cost.get(code) || 0) + amt);
          netInvested += amt;
          pushLot(code, date, sh, amt / sh);
          trades += 1;
        } else if (act === 'reduce' || act === 'sell') {
          let target = Math.min(raw, (shares.get(code) || 0) * nav);
          if (target <= 0) continue;
          const needShares = target / nav;
          const rules = parseFeeRules(h?.redemption_fee);
          const q = queues.get(code) || [];
          let remainNeed = needShares;
          let usedShares = 0;
          let fee = 0;
          let rz = 0;
          for (const lot of q) {
            if (remainNeed <= 0.000001) break;
            const take = Math.min(lot.shares, remainNeed);
            const days = Math.round((Date.parse(date) - Date.parse(lot.buyDate)) / 86400000);
            const f = (take * nav * feeRateFor(rules, days)) / 100;
            fee += f;
            rz += take * (nav - lot.unitCost) - f;
            usedShares += take;
            remainNeed -= take;
            lot.shares -= take;
          }
          queues.set(code, q.filter((l) => l.shares > 0.000001));
          if (usedShares <= 0) continue;
          const proceeds = round(usedShares * nav - fee, 2);
          flowValue -= usedShares * nav;
          shares.set(code, Math.max(0, (shares.get(code) || 0) - usedShares));
          cost.set(code, Math.max(0, (cost.get(code) || 0) - (proceeds - rz)));
          netInvested -= proceeds;
          realized += rz;
          trades += 1;
        }
      }
    }

    let market = 0;
    let costTotal = 0;
    for (const code of shares.keys()) {
      const nav = lastNav.get(code);
      if (nav != null) market += (shares.get(code) || 0) * nav;
      costTotal += cost.get(code) || 0;
    }
    const base = prevMarket + flowValue;
    const dayReturn = base > 0 ? (market - prevMarket - flowValue) / base : 0;
    twr *= 1 + dayReturn;

    const profit = market - costTotal + realized;
    points.push({
      date,
      market: r2(market),
      cost: r2(costTotal),
      netInvested: r2(netInvested),
      realized: r2(realized),
      profit: r2(profit),
      returnPct: netInvested > 0 ? r2((profit / netInvested) * 10000) / 100 : 0,
      twrPct: r2((twr - 1) * 10000) / 100,
      dayPct: r2(dayReturn * 10000) / 100,
    });
    prevMarket = market;
  }

  const summary = summarize(points);
  return {
    source: source || '__hold__',
    sourceLabel: source ? SOURCE_LABELS[source] || source : '完全不操作',
    isBaseline: !source,
    points,
    trades,
    adviceDays: adviceDates.length,
    startDate,
    summary,
  };
}

function round(v, d = 2) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}

/** 曲线的区间统计，口径与 position.curveSummary 一致（回撤按 TWR 算） */
function summarize(points) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  let twrPeak = -Infinity;
  let maxDrawdown = 0;
  let drawdownAt = null;
  let upDays = 0;
  for (const p of points) {
    if (p.twrPct > twrPeak) twrPeak = p.twrPct;
    if (twrPeak > 0) {
      const dd = (twrPeak - p.twrPct) / (1 + twrPeak / 100);
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        drawdownAt = p.date;
      }
    }
    if (p.dayPct > 0) upDays += 1;
  }
  return {
    from: points[0].date,
    to: last.date,
    days: points.length,
    market: last.market,
    netInvested: last.netInvested,
    profit: last.profit,
    returnPct: last.returnPct,
    twrPct: last.twrPct,
    maxDrawdownPct: r2(maxDrawdown),
    maxDrawdownAt: drawdownAt,
    upDays,
    downDays: points.length - upDays,
  };
}

/* ------------------------------------------------------------------ */
/* ③ 挑选增值                                                          */
/* ------------------------------------------------------------------ */

/**
 * 同一天、同一只基金，几个来源结论不一致时——人挑的那条，比没挑的那几条好多少？
 *
 * 这是唯一能把「人的判断」单独剥离出来的指标：
 * 组合的收益差里混杂着「听的是谁」和「买的是哪只」，
 * 而同一天同一只基金，基金变量就被消掉了，剩下的纯粹是挑得好不好。
 *
 * 必须走机会成本口径（hold = 0）：两家都说 add 时它们的分数本来就一模一样
 * （同一条净值曲线），只有 add 对上 hold 才比得出差别——而这恰恰是这个账户里
 * 最常见的分歧形态（2026-10-14 的 020274：Trae 说加 100，WorkBuddy 说别动）。
 *
 * 两个并列的值：
 *   pickValuePct  每元口径：不管各自报了多少金额，纯粹比判断。看的是洞察力。
 *   pickValueYuan 金额口径：按各条建议自己报的金额折算成元。看的是真金白银。
 *     两家都说加、但一个报 500 一个报 1500 时，前者是 0 分而后者能拉开——
 *     因为下的注不是一个量级。这个数受预算约束影响，别拿来单独评模型。
 */
export function pickValueReport(rows, primary) {
  const groups = new Map();
  for (const r of rows) {
    if (r.status !== 'ok') continue;
    const k = `${r.code}|${r.tradeDate}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  // 每行取「自己还能看到的最长窗口」，不够长的自动退到更短的
  const windowFor = (list) =>
    [...PRIMARY_ORDER].reverse().find((k) => list.some((r) => r.unit[k] != null)) || primary;

  const decisions = [];
  const undecided = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue; // 只有一个来源发言，无从挑起
    const windowKey = windowFor(list);
    const chosen = list.find((r) => r.adopted);
    const snapshot = (r) => ({
      source: r.source,
      sourceLabel: r.sourceLabel,
      action: r.action,
      confidence: r.confidence,
      amount: r.amount,
      scorePct: r.unit[windowKey],
      profit: r.profit[windowKey],
    });

    if (!chosen || chosen.unit[windowKey] == null) {
      undecided.push({
        code: list[0].code,
        name: list[0].name,
        tradeDate: list[0].tradeDate,
        window: windowKey,
        windowLabel: WINDOW_BY_KEY[windowKey]?.label || windowKey,
        fundFwdPct: list[0].fwd[windowKey],
        candidates: list.map(snapshot).sort((a, b) => (b.scorePct ?? -1e9) - (a.scorePct ?? -1e9)),
      });
      continue;
    }

    const others = list.filter((r) => r !== chosen && r.unit[windowKey] != null);
    if (!others.length) continue;
    const unitMean = mean(others.map((r) => r.unit[windowKey]));
    const profitMean = mean(others.map((r) => r.profit[windowKey]));
    const all = list.filter((r) => r.unit[windowKey] != null).map((r) => r.unit[windowKey]);
    const best = Math.max(...all);
    const v = chosen.unit[windowKey];
    decisions.push({
      code: chosen.code,
      name: chosen.name,
      tradeDate: chosen.tradeDate,
      window: windowKey,
      windowLabel: WINDOW_BY_KEY[windowKey]?.label || windowKey,
      fundFwdPct: chosen.fwd[windowKey],
      chosen: snapshot(chosen),
      bestScorePct: r2(best),
      bestSources: list.filter((r) => r.unit[windowKey] === best).map((r) => r.source),
      otherMeanPct: r2(unitMean),
      pickValuePct: r2(v - unitMean),
      pickValueYuan: r2(chosen.profit[windowKey] - profitMean),
      rank: 1 + all.filter((x) => x > v).length,
      participants: list.filter((r) => r.unit[windowKey] != null).length,
      wasBest: v >= best - 1e-9,
      rejected: others.map(snapshot),
    });
  }

  decisions.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.code.localeCompare(b.code));

  const perSource = new Map();
  const touch = (s, label) => {
    if (!perSource.has(s))
      perSource.set(s, {
        source: s,
        sourceLabel: label,
        chosen: 0,
        best: 0,
        worst: 0,
        pct: [],
        yuan: [],
      });
    return perSource.get(s);
  };
  for (const d of decisions) {
    const s = touch(d.chosen.source, d.chosen.sourceLabel);
    s.chosen += 1;
    s.pct.push(d.pickValuePct);
    s.yuan.push(d.pickValueYuan);
    if (d.wasBest) s.best += 1;
    if (d.rank === d.participants) s.worst += 1;
  }

  const pcts = decisions.map((d) => d.pickValuePct);
  const yuans = decisions.map((d) => d.pickValueYuan);
  const ranking = [...perSource.values()];
  return {
    windowNote: '每条决策各自取「能算到的最长窗口」，样本越老窗口越长',
    primary,
    count: decisions.length,
    insufficient: decisions.length < MIN_SAMPLES,
    minSamples: MIN_SAMPLES,
    // 采纳了当天最优建议的比例
    bestRate: decisions.length ? r2((decisions.filter((d) => d.wasBest).length / decisions.length) * 100) : null,
    avgPickValuePct: r2(mean(pcts)),
    avgPickValueYuan: r2(mean(yuans)),
    totalPickValueYuan: r2(yuans.reduce((a, b) => a + b, 0)),
    positive: pcts.filter((v) => v > 0).length,
    negative: pcts.filter((v) => v < 0).length,
    decisions,
    undecided,
    // 按「被采纳的来源」分组：哪家的建议被采纳时，人的挑选增值最高
    bySource: ranking.map((s) => ({
      source: s.source,
      sourceLabel: s.sourceLabel,
      chosen: s.chosen,
      bestCount: s.best,
      worstCount: s.worst,
      bestRate: s.chosen ? r2((s.best / s.chosen) * 100) : null,
      avgPickValuePct: r2(mean(s.pct)),
      avgPickValueYuan: r2(mean(s.yuan)),
      totalPickValueYuan: r2(s.yuan.reduce((a, b) => a + b, 0)),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 汇总                                                               */
/* ------------------------------------------------------------------ */

/**
 * 三层评估的总出口。
 *
 * isolation 字段是给前端的硬提醒：②③ 的结果**不能**出现在任何下发给模型的上下文里。
 */
export function evaluationReport(options = {}) {
  const cfg = getFundConfig();
  const card = adviceScorecard(options);
  const simSources = options.simulate === false ? [] : [...card.sources, null];
  const simulations = simSources.map((s) => simulateSource(s, { cfg })).filter(Boolean);
  const picks = pickValueReport(card.allRows, card.primary);

  // 实际组合对照：层 ② 要跟真实结果比，就得用同一个 equityCurve 的口径
  const actualSummary = options.actualSummary || null;
  const notes = [];
  if (card.primaryInsufficient) {
    notes.push(
      `样本不足：主视窗「${WINDOW_BY_KEY[card.primary].label}」目前只有 ` +
        `${card.windowSampleCounts[card.primary]} 条可评建议（门槛 ${MIN_SAMPLES} 条）。` +
        '现在的名次基本是噪声，别拿去做结论。'
    );
  }
  const longest = EVAL_WINDOWS.filter((x) => x.key !== 't1').map((x) => ({
    key: x.key,
    label: x.label,
    count: card.windowSampleCounts[x.key],
  }));
  for (const l of longest) {
    if (l.count === 0) notes.push(`「${l.label}」暂时还没有任何一条走到期的建议，等数据攒够再看。`);
    else if (l.count < MIN_SAMPLES) {
      notes.push(
        `「${l.label}」只有 ${l.count} 条建议到期（门槛 ${MIN_SAMPLES} 条），` +
          '这一格的数字看着有据可循，实际经不起推敲。'
      );
    }
  }
  if (!longest.some((l) => l.count >= MIN_SAMPLES)) {
    notes.push('当前主视窗已被退回「次日」——单日涨跌随机性极大，只适合看是否明显跑偏。');
  }

  const base = simulations.find((s) => s.isBaseline)?.summary || {};

  return {
    generatedAt: Date.now(),
    primary: card.primary,
    minSamples: MIN_SAMPLES,
    windows: EVAL_WINDOWS,
    notes,
    /** 层 ① */
    scorecard: card,
    /** 层 ② */
    simulations,
    // 相对「完全不操作」的超额：正数是择时挣来的，负数是择时毁掉的
    vsBaseline: Object.fromEntries(
      simulations
        .filter((s) => !s.isBaseline)
        .map((s) => [
          s.source,
          {
            sourceLabel: s.sourceLabel,
            twrPct: s.summary?.twrPct ?? null,
            twrVsBaselinePct: r2((s.summary?.twrPct ?? 0) - (base.twrPct ?? 0)),
            returnVsBaselinePct: r2((s.summary?.returnPct ?? 0) - (base.returnPct ?? 0)),
            extraInvested: r2((s.summary?.netInvested ?? 0) - (base.netInvested ?? 0)),
            trades: s.trades,
          },
        ])
    ),
    syncNote: '几条曲线共用同一份老仓位与同一条净值时间轴，差异只来自「听谁的」',
    baselineKey: '__hold__',
    /** 层 ③ */
    picks,
    actualSummary,
    isolation: {
      feedbackAllowed: false,
      allowed: ['scorecard.bySource', 'scorecard.byFund', 'scorecard.bySourceFund'],
      forbidden: ['picks', 'simulations', 'actualSummary'],
      reason:
        '②③ 含跨来源横向比较与用户本人的取舍，一旦回流给模型就会让它照着排行榜改答案，' +
        '评估随之失效。目前整体也还没到回传的样本量。',
    },
  };
}
