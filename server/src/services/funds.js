import { getDb } from '../db/index.js';

// 本模块只负责存取与校验：行情抓取和买卖判断由 WorkBuddy 定时任务里的大模型完成，
// 工作台从不自行推断任何投资结论。

export const FUND_ACTIONS = ['buy', 'add', 'hold', 'reduce', 'sell'];
export const FUND_CONFIDENCE = ['low', 'medium', 'high'];

const HOLDING_FIELDS = ['code', 'name', 'category', 'cost', 'shares', 'amount', 'note', 'status', 'sortOrder'];

function now() {
  return Math.floor(Date.now() / 1000);
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
  for (const field of HOLDING_FIELDS) {
    if (!(field in patch)) continue;
    const column = field === 'sortOrder' ? 'sort_order' : field;
    sets.push(`${column} = @${field}`);
    params[field] = ['cost', 'shares', 'amount', 'sortOrder'].includes(field)
      ? (field === 'sortOrder' ? Number(patch[field]) || 0 : parseNum(patch[field]))
      : (patch[field] ?? null);
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

/* ---------------- 建议 ---------------- */

/** 每只基金各取最新一条建议 */
export function latestAdvice() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT a.* FROM fund_advice a
     JOIN (SELECT code, MAX(id) AS mid FROM fund_advice GROUP BY code) m
       ON a.id = m.mid`
  ).all();
  return rows.map(mapAdvice);
}

export function adviceHistory(code, limit = 10) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM fund_advice WHERE code = ? ORDER BY trade_date DESC LIMIT ?`
  ).all(code, Math.min(Math.max(Number(limit) || 10, 1), 60)).map(mapAdvice);
}

export function latestDaily() {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM fund_daily ORDER BY trade_date DESC LIMIT 1`).get();
  if (!row) return null;
  return {
    tradeDate: row.trade_date,
    summary: row.summary || '',
    market: row.market || '',
    model: row.model || null,
    updatedAt: row.updated_at,
  };
}

/**
 * 写入定时任务产出的建议。强校验：任何一条不合法就整批拒绝，
 * 避免脏数据入库后污染前端展示。
 */
export function ingestAdvice(payload) {
  const errors = [];
  const tradeDate = String(payload?.tradeDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    errors.push('tradeDate 缺失或格式错误，应为 YYYY-MM-DD');
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) errors.push('items 为空');
  if (items.length > 100) errors.push('items 超过 100 条');

  const normalized = [];
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
    normalized.push({
      code,
      name: raw?.name ? String(raw.name).slice(0, 80) : null,
      tradeDate,
      action,
      confidence: confidence || null,
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
    });
  });

  if (errors.length > 0) return { ok: false, errors };

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO fund_advice
       (code, trade_date, action, confidence, nav, nav_date, estimate, estimate_pct, nav_pct,
        summary, reason, risks, sources, stale, model, created_at, updated_at)
     VALUES
       (@code, @tradeDate, @action, @confidence, @nav, @navDate, @estimate, @estimatePct, @navPct,
        @summary, @reason, @risks, @sources, @stale, @model, @now, @now)
     ON CONFLICT(code, trade_date) DO UPDATE SET
       action = excluded.action, confidence = excluded.confidence, nav = excluded.nav,
       nav_date = excluded.nav_date, estimate = excluded.estimate,
       estimate_pct = excluded.estimate_pct, nav_pct = excluded.nav_pct,
       summary = excluded.summary, reason = excluded.reason, risks = excluded.risks,
       sources = excluded.sources, stale = excluded.stale, model = excluded.model,
       updated_at = excluded.updated_at`
  );

  const daily = db.prepare(
    `INSERT INTO fund_daily (trade_date, summary, market, model, created_at, updated_at)
     VALUES (@tradeDate, @summary, @market, @model, @now, @now)
     ON CONFLICT(trade_date) DO UPDATE SET
       summary = excluded.summary, market = excluded.market, model = excluded.model,
       updated_at = excluded.updated_at`
  );

  const run = db.transaction((rows) => {
    for (const row of rows) upsert.run({ ...row, now: now() });
    daily.run({
      tradeDate,
      summary: payload?.summary ? String(payload.summary).slice(0, 2000) : null,
      market: payload?.market ? String(payload.market).slice(0, 2000) : null,
      model: payload?.model ? String(payload.model).slice(0, 80) : null,
      now: now(),
    });
  });
  run(normalized);

  return { ok: true, accepted: normalized.length, tradeDate };
}
