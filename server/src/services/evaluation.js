/**
 * 决策复盘：把「AI 判断得准不准」和「我做得比它好还是差」分开算。
 *
 * 2026-11-06 起只保留一个分析模型（默认智谱 GLM）。以前三家并存时，
 * 这里还要回答「谁说得更准」；现在那个问题已经没了，只剩下两个：
 *   ① AI 的每条建议，放到它自己的未来里，到底押对没有？
 *   ② 同一天同一只基金，我实际做的操作，比 AI 的建议好多少？
 *
 * ── 为什么要逐条纸上交易 ──────────────────────────────────────────
 * 每条建议都假设当天真的按它执行了，各自对着同一条 forward 净值曲线算收益。
 * 不能只评「我采纳过的那几条」：样本会被我的偏好筛过一遍，
 * 最后得分里混着「模型准」和「我挑得准」两件事，等于两份功劳记给一个人。
 * 采纳与否在层 ① 只是展示字段，不进公式。
 *
 * ── 层 ③ 的口径 ──────────────────────────────────────────────────
 * 「我的操作」= 那天真正 executed=1 的那条（可能是采纳的 AI 建议，也可能是手动补记）；
 * 没动就是 hold（机会成本记 0 分）。所以差额 = 我的得分 − AI 得分：
 * 正数说明我改得更好，负数说明我改了反而少赚。AI 说持有、我也没动，记作「照做」。
 *
 * ── 隔离红线 ──────────────────────────────────────────────────────
 * ②③ 里含我本人的取舍，**永远不许回传给任何模型**——一旦模型知道自己在被对照，
 * 它就会照着我的偏好调答案，这份复盘也就失效了。结果只出现在登录后的页面上。
 */

import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { normalizeSource, SOURCE_LABELS, FUND_MODEL } from './fundSource.js';
import { getFundConfig, getCurveStartDate } from './fundConfig.js';
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
  // 入库校验（resolveAmount）强制 amount 为正数，方向只写在 action 里。
  // 金额口径问的是「照它做会多赚/少赚多少」，所以这里要再按方向取一次符号：
  // 卖出遇上下跌是赚的，直接拿正数乘会算成亏，整个 ① 金额口径和 ③ pickValueYuan 都会反号。
  const signedAmount = bet === 'short' ? -amount : amount;
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
    // 金额口径用带符号金额：买正卖负，方向自动带上。hold 金额为空 → 0 元
    profit[w.key] = r2((signedAmount * p.pct) / 100);
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
 *
 * 单一模型模式下默认只评那一个模型；没配 FUND_MODEL 时保持旧行为（评全部来源）。
 * @param {{source?:string, code?:string, limit?:number}} options
 */
export function adviceScorecard(options = {}) {
  const db = getDb();
  const ctx = { ...loadNavSeries() };
  ctx.names = new Map(
    db.prepare(`SELECT code, name FROM fund_holdings`).all().map((h) => [h.code, h.name])
  );

  const model = options.source ? normalizeSource(options.source) : (config.fundModel || FUND_MODEL || null);
  const where = [];
  const args = [];
  if (model) {
    where.push(`IFNULL(source,'workbuddy') = ?`);
    args.push(model);
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
    // 层 ③ 的逐日对照必须用全量，截断会把后半段的决策直接吞掉
    rows: view,
    allRows: rows,
    rowCount: rows.length,
    truncated,
    /** 当前评的是哪个模型（null = 多来源并存，旧行为） */
    model,
    modelLabel: model ? (SOURCE_LABELS[model] || model) : null,
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

  // 所有基金的所有交易日，汇成一条时间轴。
  // 口径必须和 equityCurve 一致：都从「开始记录」那天起，否则②的曲线会和
  // 真实曲线错开一截，对照就没意义了。
  const curveFrom = getCurveStartDate();
  const dateSet = new Set();
  for (const arr of series.values()) for (const p of arr) dateSet.add(p.date);
  const dates = [...dateSet].sort().filter((d) => !curveFrom || d >= curveFrom);
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
/* ③ 我的操作 vs AI 建议                                               */
/* ------------------------------------------------------------------ */

function snapShot(r, windowKey) {
  return {
    source: r.source,
    sourceLabel: r.sourceLabel,
    action: r.action,
    confidence: r.confidence,
    amount: r.amount,
    scorePct: windowKey ? (r.unit[windowKey] ?? null) : null,
    profit: windowKey ? (r.profit[windowKey] ?? null) : null,
  };
}

/** 没动就是持有：机会成本口径下 0 分、0 元 */
function holdSnapshot(windowKey, available) {
  return {
    source: 'none',
    sourceLabel: '未操作',
    action: 'hold',
    confidence: null,
    amount: 0,
    scorePct: available ? 0 : null,
    profit: available ? 0 : null,
  };
}

/** 优先跟主视窗对齐；主视窗还没到期（多半是最近几天）才退到能算的更短窗口 */
function alignWindow(modelRow, mineRow, primary) {
  const ok = (k) => modelRow.unit[k] != null && (!mineRow || mineRow.unit[k] != null);
  if (ok(primary)) return primary;
  for (const k of [...PRIMARY_ORDER].reverse()) if (ok(k)) return k;
  // 一个窗口都还没走到期（最近两三天）：明确返回 null，别拿主视窗的名字冒充
  return null;
}

/**
 * 层 ③：同一天、同一只基金，AI 怎么建议 vs 我实际做了什么。
 *
 * 三种状态：
 *   same    照做（含「AI 说持有、我也没动」——不操作本身就是执行了持有）
 *   changed 我改主意了（手动补记，或采纳的是另一条）
 *   none    该动没动（AI 说买卖，我当天没有任何 executed 记录）
 *
 * 差额 = 我的机会成本得分 − AI 的机会成本得分：
 *   正数是我改得更好，负数是我改坏了。两边都按同一个主视窗算，
 *   基金本身的涨跌被约掉，剩下的纯粹是「我的取舍值不值」。
 */
export function myVsModelReport(model, primary) {
  const db = getDb();
  const ctx = { ...loadNavSeries() };
  ctx.names = new Map(
    db.prepare(`SELECT code, name FROM fund_holdings`).all().map((h) => [h.code, h.name])
  );

  const modelRows = db
    .prepare(
      `SELECT * FROM fund_advice
        WHERE IFNULL(source,'workbuddy') = ?
        ORDER BY trade_date DESC, code`
    )
    .all(model)
    .map((a) => scoreRow(a, ctx));

  // 我的操作＝当天 executed=1 的那一条。一天只有一条，由部分唯一索引保证。
  const mineRows = db
    .prepare(
      `SELECT * FROM fund_advice
        WHERE executed = 1
          AND (IFNULL(source,'workbuddy') = ? OR IFNULL(source,'workbuddy') = 'manual')
        ORDER BY trade_date DESC, code`
    )
    .all(model)
    .map((a) => scoreRow(a, ctx));
  const mineByKey = new Map(mineRows.map((r) => [`${r.code}|${r.tradeDate}`, r]));

  const decisions = [];
  for (const m of modelRows) {
    const mineRow = mineByKey.get(`${m.code}|${m.tradeDate}`) || null;
    const windowKey = alignWindow(m, mineRow, primary);
    const modelSnap = snapShot(m, windowKey);
    const mineSnap = mineRow ? snapShot(mineRow, windowKey) : holdSnapshot(windowKey, m.unit[windowKey] != null);
    const same = mineRow ? mineRow.id === m.id : m.action === 'hold';
    const status = same ? 'same' : mineRow ? 'changed' : 'none';
    const canCompare = windowKey != null && modelSnap.scorePct != null && mineSnap.scorePct != null;
    const deltaPct = canCompare ? (same ? 0 : r2(mineSnap.scorePct - modelSnap.scorePct)) : null;
    const deltaYuan = canCompare
      ? (same ? 0 : r2((mineSnap.profit ?? 0) - (modelSnap.profit ?? 0)))
      : null;

    decisions.push({
      code: m.code,
      name: m.name,
      tradeDate: m.tradeDate,
      window: windowKey,
      windowLabel: windowKey ? (WINDOW_BY_KEY[windowKey]?.label || windowKey) : '未到期',
      fundFwdPct: windowKey ? m.fwd[windowKey] : null,
      status,
      model: modelSnap,
      mine: mineSnap,
      deltaPct,
      deltaYuan,
    });
  }

  decisions.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || a.code.localeCompare(b.code));

  const evaluated = decisions.filter((d) => d.deltaPct != null);
  const sameRows = evaluated.filter((d) => d.status === 'same');
  const changedRows = evaluated.filter((d) => d.status === 'changed');
  const noneRows = evaluated.filter((d) => d.status === 'none');
  const deviations = evaluated.filter((d) => d.status !== 'same');
  const deltas = deviations.map((d) => d.deltaPct);
  const yuans = deviations.map((d) => d.deltaYuan).filter((v) => v != null);

  const sideStats = (pick) => {
    const vals = evaluated.map((d) => pick(d).scorePct).filter((v) => v != null);
    const profits = evaluated.map((d) => pick(d).profit).filter((v) => v != null);
    return {
      count: vals.length,
      avgScorePct: r2(mean(vals)),
      winRate: vals.length ? r2((vals.filter((v) => v > 0).length / vals.length) * 100) : null,
      totalProfit: r2(profits.reduce((a, b) => a + b, 0)),
    };
  };

  return {
    model,
    modelLabel: SOURCE_LABELS[model] || model,
    windowNote: '优先对齐主视窗；最近几天还没到期的，自动退到能算的最短窗口',
    primary,
    /** 有 AI 建议的「基金 × 日期」决策总数 */
    count: decisions.length,
    evaluated: evaluated.length,
    same: sameRows.length,
    changed: changedRows.length,
    noAction: noneRows.length,
    deviations: deviations.length,
    insufficient: evaluated.length < MIN_SAMPLES,
    minSamples: MIN_SAMPLES,
    agreeRate: decisions.length ? r2((sameRows.length / decisions.length) * 100) : null,
    avgDeltaPct: r2(mean(deltas)),
    totalDeltaYuan: r2(yuans.reduce((a, b) => a + b, 0)),
    better: deltas.filter((v) => v > 0).length,
    worse: deltas.filter((v) => v < 0).length,
    modelStats: sideStats((d) => d.model),
    mineStats: sideStats((d) => d.mine),
    decisions,
  };
}

/* ------------------------------------------------------------------ */
/* 汇总                                                               */
/* ------------------------------------------------------------------ */

/**
 * 两层复盘的总出口。
 *
 * isolation 字段是给前端的硬提醒：②③ 的结果**不能**出现在任何下发给模型的上下文里。
 */
export function evaluationReport(options = {}) {
  const cfg = getFundConfig();
  const card = adviceScorecard(options);
  // 单一模型模式下只有「全听它 + 完全不操作」两条剧本；没配模型时保持旧行为
  const simSources = options.simulate === false
    ? []
    : card.model
      ? [card.model, null]
      : [...card.sources, null];
  const simulations = simSources.map((s) => simulateSource(s, { cfg })).filter(Boolean);
  const myVsModel = card.model ? myVsModelReport(card.model, card.primary) : null;

  // 实际组合对照：层 ② 要跟真实结果比，就得用同一个 equityCurve 的口径
  const actualSummary = options.actualSummary || null;
  const notes = [];
  if (card.primaryInsufficient) {
    notes.push(
      `样本不足：主视窗「${WINDOW_BY_KEY[card.primary].label}」目前只有 ` +
        `${card.windowSampleCounts[card.primary]} 条可评建议（门槛 ${MIN_SAMPLES} 条）。` +
        '现在的胜率基本是噪声，别拿去做结论。'
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
    /** 当前唯一的分析模型（null = 旧的多来源模式） */
    model: card.model,
    modelLabel: card.modelLabel,
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
    syncNote: '三条曲线共用同一份老仓位与同一条净值时间轴，差异只来自「听 AI 的」还是「按我自己的」',
    baselineKey: '__hold__',
    /** 层 ③：我的操作 vs AI 建议 */
    myVsModel,
    actualSummary,
    /** 真实组合的曲线点位：与 simulations 共用同一条时间轴 */
    actualPoints: options.actualPoints || [],
    isolation: {
      feedbackAllowed: false,
      allowed: ['scorecard.byFund', 'scorecard.byConfidence'],
      forbidden: ['myVsModel', 'simulations', 'actualSummary'],
      reason:
        '②③ 含我本人的取舍与真实收益，一旦回流给模型，它就会照着我的偏好调答案，' +
        '复盘随之失效。目前整体也还没到回传的样本量。',
    },
  };
}
