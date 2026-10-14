import { getDb } from '../db/index.js';
import { config } from '../config.js';

// 基金投资约束：总投资额 / 目标收益率 / 每日加仓上限。
//
// 存在 settings 表里而不是 .env，是因为这些数字会经常调（补仓、改目标），
// 每次都去服务器上改环境变量再重启太笨重；页面改完立刻生效。
// .env 里的同名变量只作为「库里还没配过」时的初始值。

const KEYS = {
  totalBudget: 'fund.totalBudget',
  targetReturnPct: 'fund.targetReturnPct',
  dailyAddBudget: 'fund.dailyAddBudget',
  minAddAmount: 'fund.minAddAmount',
};

const FALLBACK = {
  totalBudget: () => config.fundTotalBudget,
  targetReturnPct: () => config.fundTargetReturnPct,
  dailyAddBudget: () => config.fundDailyAddBudget,
  minAddAmount: () => config.fundMinAddAmount,
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const RANGE = {
  totalBudget: [0, 100000000],
  targetReturnPct: [-90, 1000],
  dailyAddBudget: [0, 100000000],
  minAddAmount: [0, 100000],
};

export function getFundConfig() {
  const rows = getDb()
    .prepare(`SELECT key, value FROM settings WHERE key LIKE 'fund.%'`)
    .all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const [field, key] of Object.entries(KEYS)) {
    out[field] = num(stored.get(key), FALLBACK[field]());
  }
  // 负数没有意义，兜一下
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k]);
  return out;
}

/** 只接受已知字段，且限定取值范围——这是会被花钱的地方，不能让脏值进来 */
export function updateFundConfig(patch, updatedBy = null) {
  const errors = [];
  const next = {};
  for (const [field, key] of Object.entries(KEYS)) {
    if (!(field in patch)) continue;
    const raw = patch[field];
    if (raw === '' || raw === null || raw === undefined) {
      next[field] = FALLBACK[field]();
      continue;
    }
    const n = Number(raw);
    const [min, max] = RANGE[field];
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${field} 应为 ${min} 到 ${max} 之间的数字（收到 ${raw}）`);
      continue;
    }
    next[field] = n;
  }
  if (Object.keys(next).length === 0) {
    return { ok: false, errors: errors.length ? errors : ['没有可更新的字段'] };
  }
  if (errors.length) return { ok: false, errors };

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  );
  db.transaction(() => {
    for (const [field, value] of Object.entries(next)) {
      stmt.run(KEYS[field], String(value), updatedBy, now);
    }
  })();
  return { ok: true, config: getFundConfig() };
}
