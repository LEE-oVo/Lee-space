import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { parseFeeRules, investmentSummary } from './position.js';
import { getFundConfig } from './fundConfig.js';
import { FUND_SOURCES, SOURCE_LABELS, normalizeSource, sourceRank } from './fundSource.js';

// 本模块只负责存取与校验：行情抓取和买卖判断由定时任务里的大模型完成，
// 工作台从不自行推断任何投资结论。

export const FUND_ACTIONS = ['buy', 'add', 'hold', 'reduce', 'sell'];
export const FUND_CONFIDENCE = ['low', 'medium', 'high'];

// 建议层可以多来源并存：两个工具各写各的判断，互不影响。
// 账本层（份额 / 成本 / 盈亏 / 已实现）只有一份，靠 sourceRank 去重后入账。
export { FUND_SOURCES, SOURCE_LABELS, sourceRank };

const HOLDING_FIELDS = [
  ['code', 'code'],
  ['name', 'name'],
  ['category', 'category'],
  ['note', 'note'],
  ['status', 'status'],
  ['sortOrder', 'sort_order'],
  ['purchaseFee', 'purchase_fee'],
  ['redemptionFee', 'redemption_fee'],
  ['firstBuyDate', 'first_buy_date'],
  ['cost', 'cost'],
  ['shares', 'shares'],
  ['amount', 'amount'],
];

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 金额校验（定时任务与手动补记共用）：
 * 金额非负，方向由 action 决定；买入/加减仓必须给正数，持有必须不给。
 * 不合法时把原因推进 errors 并返回 { ok: false }。
 */
function resolveAmount(action, rawAmount, at, errors) {
  let amount = null;
  if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
    const n = Number(rawAmount);
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      errors.push(`${at}.amount 非法：${rawAmount}（应为 0-100000 之间的数字）`);
      return { ok: false };
    }
    amount = Math.round(n);
  }
  if (['buy', 'add', 'reduce', 'sell'].includes(action) && (amount === null || amount <= 0)) {
    errors.push(`${at} 的 action 为 ${action}，必须给出正数金额 amount`);
    return { ok: false };
  }
  if (action === 'hold' && amount) {
    errors.push(`${at} 的 action 为 hold，不应给出金额（给了 ${amount}）`);
    return { ok: false };
  }
  return { ok: true, amount };
}

function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapAdvice(row) {
  return {
    code: row.code,
    tradeDate: row.trade_date,
    action: row.action,
    confidence: row.confidence || null,
    // 金额一律为非负数，方向由 action 决定（正=买/加，减仓卖出也记正数）
    amount: row.amount === null || row.amount === undefined ? null : row.amount,
    executed: Boolean(row.executed),
    settled: Boolean(row.settled),
    settledNav: row.settled_nav ?? null,
    settledShares: row.settled_shares ?? null,
    settledFee: row.settled_fee ?? null,
    settledRealized: row.settled_realized ?? null,
    nav: row.nav,
    navDate: row.nav_date || null,
    estimate: row.estimate,
    estimatePct: row.estimate_pct,
    navPct: row.nav_pct,
    summary: row.summary || '',
    reason: row.reason || '',
    risks: parseJsonArray(row.risks),
    sources: parseJsonArray(row.sources),
    stale: Boolean(row.stale),
    model: row.model || null,
    source: row.source || 'workbuddy',
    settledSource: row.settled_source || null,
    updatedAt: row.updated_at,
  };
}

function mapHolding(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category || '',
    cost: row.cost,
    shares: row.shares,
    amount: row.amount,
    realized: row.realized ?? 0,
    purchaseFee: row.purchase_fee ?? 0,
    redemptionFee: parseFeeRules(row.redemption_fee),
    feeSource: row.fee_source || '',
    firstBuyDate: row.first_buy_date || '',
    note: row.note || '',
    status: row.status,
    sortOrder: row.sort_order || 0,
    updatedAt: row.updated_at,
  };
}

/* ---------------- 持仓 ---------------- */

export function listHoldings(includeArchived = false) {
  const db = getDb();
  const sql = includeArchived
    ? `SELECT * FROM fund_holdings ORDER BY sort_order, id`
    : `SELECT * FROM fund_holdings WHERE status = 'active' ORDER BY sort_order, id`;
  return db.prepare(sql).all().map(mapHolding);
}

export function createHolding(payload) {
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO fund_holdings (code, name, category, cost, shares, amount, note, status, sort_order, created_at, updated_at)
     VALUES (@code, @name, @category, @cost, @shares, @amount, @note, @status, @sortOrder, @now, @now)`
  ).run({
    code: payload.code,
    name: payload.name,
    category: payload.category || null,
    cost: parseNum(payload.cost),
    shares: parseNum(payload.shares),
    amount: parseNum(payload.amount),
    note: payload.note || null,
    status: payload.status || 'active',
    sortOrder: Number(payload.sortOrder) || 0,
    now: now(),
  });
  return db.prepare(`SELECT * FROM fund_holdings WHERE id = ?`).get(info.lastInsertRowid);
}

export function updateHolding(id, patch) {
  const db = getDb();
  const sets = [];
  const params = { id, now: now() };
  for (const [field, column] of HOLDING_FIELDS) {
    if (!(field in patch)) continue;
    sets.push(`${column} = @${field}`);
    if (field === 'sortOrder' || field === 'purchaseFee') {
      params[field] = Number(patch[field]) || 0;
    } else if (field === 'redemptionFee') {
      // 存 JSON 分档：[{"days":7,"fee":1.5},{"days":null,"fee":0}]
      params[field] = JSON.stringify(patch[field] || []);
    } else if (['cost', 'shares', 'amount'].includes(field)) {
      params[field] = parseNum(patch[field]);
    } else {
      params[field] = patch[field] ?? null;
    }
  }
  if (sets.length === 0) return null;
  sets.push('updated_at = @now');
  db.prepare(`UPDATE fund_holdings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return db.prepare(`SELECT * FROM fund_holdings WHERE id = ?`).get(id);
}

export function deleteHolding(id) {
  const db = getDb();
  return db.prepare(`DELETE FROM fund_holdings WHERE id = ?`).run(id).changes > 0;
}

/* ---------------- 净值序列 ---------------- */

/** 写入净值点（覆盖式），用于走势图 */
export function saveNavPoints(code, points) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO fund_nav (code, nav_date, nav, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(code, nav_date) DO UPDATE SET nav = excluded.nav`
  );
  const run = db.transaction((rows) => {
    for (const p of rows) stmt.run(code, p.date, p.nav, now());
  });
  run(points);
  return points.length;
}

export function navSeries(code, limit = 60) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT nav_date, nav FROM fund_nav WHERE code = ? ORDER BY nav_date DESC LIMIT ?`
  ).all(code, Math.min(Math.max(Number(limit) || 60, 5), 2000));
  return rows.reverse().map((r) => ({ date: r.nav_date, nav: r.nav }));
}

/* ---------------- 对外输出的裁剪 ---------------- */

// 没有 fund:detail 时（游客等）：不给持仓成本/份额/金额，也不给详细分析正文
export function publicHolding(h) {
  return {
    id: h.id,
    code: h.code,
    name: h.name,
    category: h.category || '',
    sortOrder: h.sort_order || 0,
  };
}

export function publicAdvice(a) {
  return {
    code: a.code,
    tradeDate: a.trade_date,
    action: a.action,
    confidence: a.confidence || null,
    nav: a.nav,
    navDate: a.nav_date || null,
    estimate: a.estimate,
    estimatePct: a.estimate_pct,
    navPct: a.nav_pct,
    summary: a.summary || '',
    stale: Boolean(a.stale),
    model: a.model || null,
    source: a.source || 'workbuddy',
    updatedAt: a.updated_at,
  };
}

/**
 * 当日加仓占用（共享池）。
 *
 * 关键：两个来源可能对「同一只基金同一天」都给了加仓建议，但真正会成交的只有一笔。
 * 所以占用按「每只基金当天取最大金额」累加，而不是把所有来源的金额直接相加——
 * 否则两只工具各建议 500，占用会算成 1000，第二只工具就被凭空卡死。
 */
export function todayAllocation(tradeDate, cfg) {
  const db = getDb();
  const used = effectiveUsed(db, tradeDate);
  const budget = Number((cfg ?? getFundConfig())?.dailyAddBudget) || 0;
  const bySource = {};
  for (const r of db
    .prepare(
      `SELECT IFNULL(source,'workbuddy') AS source, COALESCE(SUM(amount), 0) AS used
         FROM fund_advice
        WHERE trade_date = ? AND action IN ('buy', 'add') AND amount IS NOT NULL
        GROUP BY source`
    )
    .all(tradeDate)) {
    bySource[r.source] = r.used || 0;
  }
  return {
    date: tradeDate,
    used,
    budget,
    // 0 = 不限；这时 remain 给 null，避免前端拿 Infinity 去算
    remain: budget > 0 ? Math.max(0, budget - used) : null,
    unlimited: budget <= 0,
    // 各来源自己报的金额合计，仅用于展示「谁说了什么」，不代表真实占用
    bySource,
    scope: 'daily-total',
  };
}

/** 按「每只基金当天取最大金额」累加的已占用额度，excludeCodes 里的基金不计入 */
function effectiveUsed(db, tradeDate, excludeCodes) {
  const rows = db
    .prepare(
      `SELECT code, MAX(amount) AS mx FROM fund_advice
        WHERE trade_date = ? AND action IN ('buy','add') AND amount IS NOT NULL
        GROUP BY code`
    )
    .all(tradeDate);
  let used = 0;
  for (const r of rows) {
    if (excludeCodes && excludeCodes.has(r.code)) continue;
    used += Number(r.mx) || 0;
  }
  return Math.round(used * 100) / 100;
}

/** 给定时任务的持仓清单：附带每只基金最近的加减仓记录，供模型回看决策 */
export function holdingsForAutomation(limit = 12) {
  const holdings = listHoldings();
  const db = getDb();
  const stmt = db.prepare(
    `SELECT * FROM fund_advice WHERE code = ? ORDER BY trade_date DESC LIMIT ?`
  );
  return holdings.map((h) => ({
    ...h,
    // 只下发我真实做过的操作（天然一天一条）。**不带 source**：
    // 模型只需要知道「哪天对哪只基金做了什么、多少钱」，
    // 至于是哪个工具建议的与它的判断无关，给了反而会让它去纠结来源
    recent: effectiveHistory(h.code, Math.min(Math.max(Number(limit) || 12, 1), 60)).map((r) => ({
      date: r.tradeDate,
      action: r.action,
      amount: r.amount,
      nav: r.settledNav ?? r.nav ?? null,
    })),
  }));
}

/**
 * 我真实的加减仓历史：只取 executed=1 的记录，天然「一天一条」。
 * 多工具并存时没被采纳的那些只是候选建议，不是我做过的操作——
 * 混进来会让人以为当天操作了两笔，模型回看也会被带偏。
 */
export function effectiveHistory(code, limit = 60) {
  return adviceHistory(code, 200)
    .filter((r) => r.executed)
    .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
    .slice(0, Math.min(Math.max(Number(limit) || 60, 1), 200));
}

/**
 * 标记某条建议是否被采纳执行（前端由用户点一下）。
 *
 * 「执行」是单条互斥的：同一只基金同一天最多一条 executed=1。
 * 那条就是我当天真实做的操作——加减仓记录只显示它，账本也只结算它。
 * 多个工具/模型同一天各给一条建议是常态，但采纳只能选其中一个，
 * 选了新的旧的自动落选（数据库的部分唯一索引兜底，应用层绕不过去）。
 */
export function setAdviceExecuted(code, tradeDate, executed, source) {
  const db = getDb();
  const s = source ? String(source) : null;
  const rows = db
    .prepare(`SELECT id, source FROM fund_advice WHERE code = ? AND trade_date = ?`)
    .all(code, tradeDate);
  if (!rows.length) return false;
  const norm = (r) => (r.source || 'workbuddy');
  // 没指定来源时按展示序挑主建议（手动补记 > 主工具 > 对照工具）
  const target = s
    ? rows.find((r) => norm(r) === s)
    : rows.reduce((m, r) => ((DISPLAY_ORDER[norm(r)] ?? 9) < (DISPLAY_ORDER[norm(m)] ?? 9) ? r : m));
  if (!target) return false;

  const value = executed ? 1 : 0;
  const t = now();
  db.transaction(() => {
    // 采纳新的之前先把同一天其他建议落选，保证「一天只执行一个建议」
    if (value === 1) {
      db.prepare(
        `UPDATE fund_advice SET executed = 0, updated_at = ?
          WHERE code = ? AND trade_date = ? AND id <> ? AND executed = 1`
      ).run(t, code, tradeDate, target.id);
    }
    db.prepare(`UPDATE fund_advice SET executed = ?, updated_at = ? WHERE id = ?`).run(value, t, target.id);
  })();
  return true;
}

// 展示序：手动补记 > 主工具 > 定期跑的对照模型 > 手动兜底。
// 只影响「没指定来源时页面挑哪条」，与账本入账优先级（sourceRank）无关。
// 之后新接入的来源不在表里，?? 9 排在最后，不会挤掉已知来源
const DISPLAY_ORDER = { manual: 0, workbuddy: 1, glm: 2, trae: 3 };

/**
 * 手动补记一笔实际操作：覆盖当天该基金的建议，并直接标记为已执行。
 * 金额规则与定时任务共用同一套校验，避免两处规则不一样。
 */
export function upsertManualRecord({ code, tradeDate, action, amount, nav, note }) {
  const errors = [];
  const c = String(code || '').trim();
  const d = String(tradeDate || '').trim();
  const act = String(action || '').trim();

  if (!/^[A-Za-z0-9]{4,12}$/.test(c)) errors.push('基金代码非法');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('日期格式应为 YYYY-MM-DD');
  if (!FUND_ACTIONS.includes(act)) errors.push(`action 非法：${act}，可选 ${FUND_ACTIONS.join('/')}`);

  const resolved = errors.length === 0 ? resolveAmount(act, amount, 'record', errors) : { ok: false };
  if (!resolved.ok) return { ok: false, errors };

  const db = getDb();
  const t = now();
  // 手动补记就是「我实际做了什么」，比任何建议都可信。
  // 先让同一天其他来源落选，否则会撞上「一天只能执行一条」的唯一约束
  db.prepare(
    `UPDATE fund_advice SET executed = 0, updated_at = ?
      WHERE code = ? AND trade_date = ? AND IFNULL(source,'workbuddy') <> 'manual' AND executed = 1`
  ).run(t, c, d);
  // 手动补记写进独立的 manual 格子：不覆盖两只工具各自的判断，
  // 但优先级最高（用户自己说"我实际买了"永远比模型的建议可信）
  const info = db
    .prepare(
      `INSERT INTO fund_advice
         (code, trade_date, source, action, confidence, amount, nav, nav_date, summary,
          reason, risks, sources, stale, model, executed, created_at, updated_at)
       VALUES
         (@code, @tradeDate, 'manual', @action, NULL, @amount, @nav, @tradeDate, @summary,
          NULL, '[]', '[]', 0, 'manual', 1, @t, @t)
       ON CONFLICT(code, trade_date, source) DO UPDATE SET
         action = excluded.action,
         amount = excluded.amount,
         nav = COALESCE(excluded.nav, fund_advice.nav),
         summary = excluded.summary,
         model = 'manual',
         executed = 1,
         updated_at = @t`
    )
    .run({
      code: c,
      tradeDate: d,
      action: act,
      amount: resolved.amount,
      nav: nav === undefined || nav === null || nav === '' ? null : Number(nav),
      summary: String(note || '').slice(0, 200) || '手动补记',
      t,
    });

  return { ok: true, id: Number(info.lastInsertRowid) || null };
}

/** 累计加减仓金额（只统计已执行的），用于展示与模型参考 */
export function positionSummary(code) {
  // 折叠成「一天一条」再统计：同一天两只工具的建议只能算一笔真实操作
  const rows = effectiveHistory(code, 200).filter((a) => a.executed && a.amount);
  let added = 0;
  let reduced = 0;
  for (const a of rows) {
    if (a.action === 'buy' || a.action === 'add') added += a.amount;
    if (a.action === 'reduce' || a.action === 'sell') reduced += a.amount;
  }
  return { added, reduced, count: rows.length };
}

/* ---------------- 建议 ---------------- */

/**
 * 最新建议。
 * 传 source → 只要该来源的（每只基金一条）；
 * 不传 → 返回「每只基金 × 每个来源」各自的最新一条，供页面做来源对比。
 */
export function latestAdvice(source) {
  const db = getDb();
  if (source && source !== 'all') {
    return db
      .prepare(
        `SELECT a.* FROM fund_advice a
           JOIN (SELECT code, MAX(id) AS mid FROM fund_advice
                  WHERE IFNULL(source,'workbuddy') = ? GROUP BY code) m
             ON a.id = m.mid
          ORDER BY a.trade_date DESC, a.updated_at DESC`
      )
      .all(source)
      .map(mapAdvice);
  }
  return db
    .prepare(
      `SELECT a.* FROM fund_advice a
         JOIN (SELECT code, IFNULL(source,'workbuddy') AS s, MAX(id) AS mid FROM fund_advice
                GROUP BY code, s) m
           ON a.id = m.mid
        ORDER BY a.trade_date DESC, a.updated_at DESC`
    )
    .all()
    .map(mapAdvice);
}

/**
 * 页面上会出现哪些来源入口。
 * 取「已配置令牌的来源」∪「库里实际写过的来源」——
 * 前者保证某个工具今天没跑也能在 tab 上看到它（日期空白/落后即提示），
 * 而不是悄悄消失；后者保住历史来源与手动补记。manual 不主动占位，
 * 它只在真有补记记录时出现（它不是一条分析途径）
 */
export function adviceSources() {
  const rows = getDb()
    .prepare(
      `SELECT IFNULL(source,'workbuddy') AS source, COUNT(*) AS n, MAX(trade_date) AS last
         FROM fund_advice GROUP BY source`
    )
    .all();
  const bySource = new Map(rows.map((r) => [r.source, r]));
  for (const s of FUND_SOURCES) {
    if (s === 'manual') continue;
    if (!bySource.has(s)) bySource.set(s, { source: s, n: 0, last: null });
  }
  return [...bySource.values()]
    .sort((a, b) => {
      if ((a.n > 0) !== (b.n > 0)) return a.n > 0 ? -1 : 1;
      return String(b.last || '').localeCompare(String(a.last || ''));
    })
    .map((r) => ({
      source: r.source,
      label: SOURCE_LABELS[r.source] || r.source,
      count: r.n,
      lastDate: r.last,
    }));
}

export function adviceHistory(code, limit = 10, source) {
  const db = getDb();
  const cap = Math.min(Math.max(Number(limit) || 10, 1), 60);
  const rows = source && source !== 'all'
    ? db
        .prepare(
          `SELECT * FROM fund_advice WHERE code = ? AND IFNULL(source,'workbuddy') = ?
            ORDER BY trade_date DESC LIMIT ?`
        )
        .all(code, source, cap)
    : db
        .prepare(`SELECT * FROM fund_advice WHERE code = ? ORDER BY trade_date DESC, id DESC LIMIT ?`)
        .all(code, cap);
  return rows.map(mapAdvice);
}

function mapDaily(row) {
  if (!row) return null;
  return {
    tradeDate: row.trade_date,
    source: row.source || 'workbuddy',
    sourceLabel: SOURCE_LABELS[row.source || 'workbuddy'] || row.source || 'workbuddy',
    summary: row.summary || '',
    market: row.market || '',
    model: row.model || null,
    updatedAt: row.updated_at,
  };
}

/** 最新一天的整体结论；传 source 时只取该来源的 */
export function latestDaily(source) {
  const db = getDb();
  const row = source && source !== 'all'
    ? db
        .prepare(
          `SELECT * FROM fund_daily WHERE IFNULL(source,'workbuddy') = ?
            ORDER BY trade_date DESC LIMIT 1`
        )
        .get(source)
    : db.prepare(`SELECT * FROM fund_daily ORDER BY trade_date DESC, updated_at DESC LIMIT 1`).get();
  return mapDaily(row);
}

/** 每个来源各自最新一天的整体结论，供页面按来源切换 */
export function latestDailyList() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.* FROM fund_daily d
         JOIN (SELECT IFNULL(source,'workbuddy') AS s, MAX(trade_date) AS md
                 FROM fund_daily GROUP BY s) m
           ON d.trade_date = m.md AND IFNULL(d.source,'workbuddy') = m.s
        ORDER BY d.trade_date DESC, d.updated_at DESC`
    )
    .all();
  return rows.map(mapDaily);
}

/**
 * 顶层 summary 缺失时的兜底：用当天的操作分布 + 每条建议的一句话结论拼一段。
 * 只陈述库里已有的事实，不做任何新判断。
 */
function buildDailySummary(tradeDate, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const inCount = rows.filter((r) => r.action === 'buy' || r.action === 'add');
  const outCount = rows.filter((r) => r.action === 'reduce' || r.action === 'sell');
  const holdCount = rows.filter((r) => r.action === 'hold');

  const parts = [];
  if (inCount.length) {
    const total = inCount.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    parts.push(`建议买入/加仓 ${inCount.length} 只，合计 ${total} 元`);
  }
  if (outCount.length) parts.push(`建议减仓 ${outCount.length} 只`);
  if (holdCount.length) parts.push(`其余 ${holdCount.length} 只建议持有`);

  const lines = [...inCount, ...outCount]
    .filter((r) => r.summary)
    .slice(0, 4)
    .map((r) => `${r.name || r.code}：${String(r.summary).trim()}`);
  return [`${tradeDate} 共跟踪 ${rows.length} 只基金：${parts.join('，')}。`, ...lines]
    .join('\n')
    .slice(0, 2000);
}

/**
 * 加仓额度硬校验。
 *
 * 主约束是**总投资额**（我最多拿多少钱出来投，含已经投进去的），不再按日限额。
 * 理由：日限额会把钱平均摊到每一天，好机会来了也只能下 500，反而错过；
 * 真正的风险是总盘子超支，把约束放在总额上才对。
 * 每日上限仍保留为可选项（dailyAddBudget > 0 时生效），两个约束取更严的那个。
 *
 * 先到先得：按 items 顺序分配，额度不够就削减，连最小金额都不够就判持有。
 * 不整批拒绝——那样第二个工具当天就直接没有建议了，反而丢信息。
 * 所有削减都会写进 reason 并返回 adjusted，任务日志与页面上都能查到。
 */
function applyBudget(normalized, tradeDate, source, cfg, invest) {
  const db = getDb();
  const minAdd = Math.max(0, Number(cfg.minAddAmount) || 0);
  const adjusted = [];
  const picking = `action IN ('buy','add') AND amount IS NOT NULL`;

  // 两个工具可能对同一只基金同一天各排一笔，但真正会成交的只有一笔。
  // 所以「已排计划」按每只基金取各来源最大值。注意只包含**未执行**的：
  // 已执行的在 invest.used 里算过了，重复计会白白吃掉额度。
  const planByCode = new Map();
  for (const r of db
    .prepare(
      `SELECT code, MAX(amount) AS mx FROM fund_advice
        WHERE trade_date = ? AND settled = 0 AND executed = 0 AND ${picking} GROUP BY code`
    )
    .all(tradeDate)) {
    planByCode.set(r.code, Number(r.mx) || 0);
  }

  // 约束一：总投资额。已确认占用 + 当天全部已排计划（含批次内的地板）
  const totalBudget = Number(cfg.totalBudget) || 0;
  let totalLeft = Number.POSITIVE_INFINITY;
  if (totalBudget > 0) {
    let occupied = Number(invest.used) || 0;
    for (const mx of planByCode.values()) occupied += mx;
    totalLeft = Math.max(0, totalBudget - occupied);
  }

  // 约束二：当日上限（0 = 不限），同一套口径
  let dayLeft = Number.POSITIVE_INFINITY;
  const daily = Number(cfg.dailyAddBudget) || 0;
  if (daily > 0) {
    let used = 0;
    for (const mx of planByCode.values()) used += mx;
    dayLeft = Math.max(0, daily - used);
  }

  for (const row of normalized) {
    if (row.action !== 'buy' && row.action !== 'add') continue;
    const want = Number(row.amount) || 0;
    const floor = planByCode.get(row.code) || 0;
    // 边际占用：金额不超过地板时并没有多占额度（本来源这次是覆盖自己那条）
    const marginal = Math.max(0, want - floor);
    const totalOk = want <= totalLeft;
    const dayOk = marginal <= dayLeft;
    if (totalOk && dayOk) {
      totalLeft -= marginal;
      dayLeft -= marginal;
      continue;
    }

    // 能批多少：两个约束各自能给的量取小，再加上地板
    let approved = Number.isFinite(totalLeft) ? Math.min(want, floor + totalLeft) : want;
    if (Number.isFinite(dayLeft)) approved = Math.min(approved, floor + dayLeft);
    approved = Math.floor(Math.max(0, approved));

    if (approved >= minAdd && minAdd > 0) {
      const why = !totalOk
        ? `总投资额度只剩 ${Math.round(Number.isFinite(totalLeft) ? totalLeft : 0)} 元`
        : `当日额度只剩 ${Math.round(dayLeft)} 元`;
      row.reason = `【额度拦截】${why}（${SOURCE_LABELS[source] || source} 来源），`
        + `原建议 ${row.action} ${want} 元已下调为 ${approved} 元。${row.reason || ''}`.slice(0, 2000);
      row.amount = approved;
      totalLeft -= Math.max(0, approved - floor);
      dayLeft -= Math.max(0, approved - floor);
      adjusted.push({ code: row.code, action: row.action, requested: want, approved });
    } else {
      const why = !totalOk
        ? `总投资额度（${Math.round(totalBudget)} 元）已用尽`
        : `当日 ${Math.round(daily)} 元额度已用完`;
      row.reason = `【额度拦截】${why}（${SOURCE_LABELS[source] || source} 来源），`
        + `原建议 ${row.action} ${want} 元改为持有。${row.reason || ''}`.slice(0, 2000);
      row.action = 'hold';
      row.amount = null;
      adjusted.push({ code: row.code, action: 'hold', requested: want, approved: 0 });
    }
  }

  return { adjusted };
}

/**
 * 写入定时任务产出的建议。强校验：任何一条不合法就整批拒绝，
 * 避免脏数据入库后污染前端展示。
 *
 * source 由服务端从令牌判定后传入，不接受任务在 body 里自报——
 * 否则提示词一改就可能把 A 的建议写进 B 的格子里。
 */
export function ingestAdvice(payload, options = {}) {
  const source = normalizeSource(options.source);
  const errors = [];
  const tradeDate = String(payload?.tradeDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    errors.push('tradeDate 缺失或格式错误，应为 YYYY-MM-DD');
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) errors.push('items 为空');
  if (items.length > 100) errors.push('items 超过 100 条');

  const normalized = [];
  const navPoints = []; // code -> 序列，建议入库后统一写净值表
  items.forEach((raw, index) => {
    const at = `items[${index}]`;
    const code = String(raw?.code || '').trim();
    if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
      errors.push(`${at}.code 非法：${code || '(空)'}`);
      return;
    }
    const action = String(raw?.action || '').trim();
    if (!FUND_ACTIONS.includes(action)) {
      errors.push(`${at}.action 非法：${action || '(空)'}，可选 ${FUND_ACTIONS.join('/')}`);
      return;
    }
    const confidence = String(raw?.confidence || '').trim();
    if (confidence && !FUND_CONFIDENCE.includes(confidence)) {
      errors.push(`${at}.confidence 非法：${confidence}`);
      return;
    }
    const navDate = raw?.navDate ? String(raw.navDate) : null;
    if (navDate && !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
      errors.push(`${at}.navDate 格式错误`);
      return;
    }
    // 金额规则由定时任务与手动补记共用，抽成函数避免两处规则漂移
    const resolved = resolveAmount(action, raw?.amount, at, errors);
    if (!resolved.ok) return;
    const amount = resolved.amount;

    if (Array.isArray(raw?.navSeries)) {
      const points = [];
      raw.navSeries.slice(0, 400).forEach((p) => {
        const d = String(p?.date || '').trim();
        const v = parseNum(p?.nav);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== null) points.push({ date: d, nav: v });
      });
      if (points.length > 0) navPoints.push({ code, points });
    }

    normalized.push({
      code,
      name: raw?.name ? String(raw.name).slice(0, 80) : null,
      tradeDate,
      action,
      confidence: confidence || null,
      amount,
      nav: parseNum(raw?.nav),
      navDate,
      estimate: parseNum(raw?.estimate),
      estimatePct: parseNum(raw?.estimatePct),
      navPct: parseNum(raw?.navPct),
      summary: raw?.summary ? String(raw.summary).slice(0, 500) : null,
      reason: raw?.reason ? String(raw.reason).slice(0, 2000) : null,
      risks: JSON.stringify(Array.isArray(raw?.risks) ? raw.risks.slice(0, 10).map((r) => String(r).slice(0, 200)) : []),
      sources: JSON.stringify(
        Array.isArray(raw?.sources)
          ? raw.sources.slice(0, 10).map((s) => ({
              title: String(s?.title || '').slice(0, 200),
              url: String(s?.url || '').slice(0, 500),
            }))
          : []
      ),
      stale: raw?.stale ? 1 : 0,
      model: raw?.model ? String(raw.model).slice(0, 80) : (payload?.model ? String(payload.model).slice(0, 80) : null),
      source,
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const db = getDb();
  // 额度必须在入库前算：库里已有的投入 + 本批次新承诺的，加起来不能超总投资额
  const cfg = getFundConfig();
  // 传 tradeDate：当天已排但未执行的加仓也要算进占用，
  // 否则两个工具同一天各排一笔就能把总额排穿
  const invest = investmentSummary(cfg, tradeDate);

  // 一天内重复跑任务：唯一键 (code, trade_date, source) 决定它是**覆盖**而不是新增，
  // 所以不会攒出多条记录、也不会重复占用额度。
  //
  // 但**已经落地的事实不能被机器改写**：已采纳（我实际下单了）或已结算（账本已入账）
  // 的那条记录代表真实发生的操作。若新的判断把它覆盖掉，就会出现
  // 「记录写 300、账本按 200 入账」这种对不上的事故，而且没有任何提示。
  // 这些条目跳过不写，并在响应里报告，让任务汇报时点出来
  const stateStmt = db.prepare(
    `SELECT executed, settled FROM fund_advice
      WHERE code = ? AND trade_date = ? AND IFNULL(source,'workbuddy') = ?`
  );
  const locked = [];
  const writable = [];
  for (const row of normalized) {
    const cur = stateStmt.get(row.code, row.tradeDate, row.source);
    if (cur && (Number(cur.executed) === 1 || Number(cur.settled) === 1)) {
      locked.push({
        code: row.code,
        action: row.action,
        amount: row.amount,
        lockedBy: Number(cur.settled) === 1 ? '已结算' : '已采纳',
      });
    } else {
      writable.push(row);
    }
  }

  // 额度只对真正要写入的条目计算：被保护的那些金额没变，占用也就不变
  const { adjusted } = applyBudget(writable, tradeDate, source, cfg, invest);

  const upsert = db.prepare(
    `INSERT INTO fund_advice
       (code, trade_date, source, action, confidence, amount, nav, nav_date, estimate, estimate_pct, nav_pct,
        summary, reason, risks, sources, stale, model, created_at, updated_at)
     VALUES
       (@code, @tradeDate, @source, @action, @confidence, @amount, @nav, @navDate, @estimate, @estimatePct, @navPct,
        @summary, @reason, @risks, @sources, @stale, @model, @now, @now)
     ON CONFLICT(code, trade_date, source) DO UPDATE SET
       action = excluded.action, confidence = excluded.confidence, amount = excluded.amount,
       nav = excluded.nav,
       nav_date = excluded.nav_date, estimate = excluded.estimate,
       estimate_pct = excluded.estimate_pct, nav_pct = excluded.nav_pct,
       summary = excluded.summary, reason = excluded.reason, risks = excluded.risks,
       sources = excluded.sources, stale = excluded.stale, model = excluded.model,
       updated_at = excluded.updated_at`
  );

  const daily = db.prepare(
    `INSERT INTO fund_daily (trade_date, source, summary, market, model, created_at, updated_at)
     VALUES (@tradeDate, @source, @summary, @market, @model, @now, @now)
     ON CONFLICT(trade_date, source) DO UPDATE SET
       summary = excluded.summary, market = excluded.market, model = excluded.model,
       updated_at = excluded.updated_at`
  );

  const run = db.transaction((rows) => {
    for (const row of rows) {
      upsert.run({ ...row, now: now() });
      // 当天净值自动入序列，即使定时任务没给历史也能逐日累积
      if (row.nav !== null && row.navDate) {
        saveNavPoints(row.code, [{ date: row.navDate, nav: row.nav }]);
      }
    }
    for (const item of navPoints) saveNavPoints(item.code, item.points);
    // 一条都没写进去时不刷新整体结论，免得页面头部换成新的说法、
    // 卡片却还是旧建议，看起来像没跑成功
    if (rows.length === 0) return;
    daily.run({
      tradeDate,
      source,
      // 模型偶尔会漏写顶层 summary。没有兜底的话页面头部会显示成"还没有分析数据"，
      // 而当天明明有几条建议——这里用当天的操作分布 + 每条结论拼一段出来
      summary: payload?.summary
        ? String(payload.summary).slice(0, 2000)
        : buildDailySummary(tradeDate, normalized),
      market: payload?.market ? String(payload.market).slice(0, 2000) : null,
      model: payload?.model ? String(payload.model).slice(0, 80) : null,
      now: now(),
    });
  });
  run(writable);

  return {
    ok: true,
    accepted: writable.length,
    tradeDate,
    source,
    // 被保护跳过的条目：该基金当天已被采纳或已结算，新的判断没有覆盖它。
    // 任务汇报时要说明，否则会以为写进去了
    skipped: locked,
    // 被额度拦截而削减/改持有的条目：非空的 adjusted 说明模型报超了，任务汇报要点出来
    budget: {
      adjusted,
      totalBudget: invest.totalBudget,
      used: invest.used,
      remaining: invest.remaining,
    },
  };
}
