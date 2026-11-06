import { config } from '../config.js';

// 建议来源：每个工具各写各的判断，账本只有一本。
// 这个文件单独抽出来，是因为 funds.js 与 position.js 都要用它，
// 互相 import 会形成循环依赖。
//
// 来源集合不再写死——它等于「配了令牌的来源 + manual」。
// 接入新模型只要在 FUND_INGEST_TOKENS 里加一个令牌，
// 来源、标签、页面 tab 会自动跟着出现，代码一行都不用改
function configuredSources() {
  const set = new Set(Object.keys(config.fundIngestTokens || {}));
  set.add('manual');
  return [...set];
}

export const FUND_SOURCES = configuredSources();

/** 唯一分析模型（null = 多来源并存）。设了它就只看它一个，+ manual */
export const FUND_MODEL = config.fundModel || null;

/**
 * 当前生效的来源：单一模型模式下只有「模型 + manual」。
 * 历史 workbuddy / trae 记录仍然在库里，只是不再进入页面、复盘与模型上下文。
 */
export const ACTIVE_SOURCES = FUND_MODEL ? [FUND_MODEL, 'manual'] : [...FUND_SOURCES];

// 页面上的称呼。config 里已经内置了常见来源，这里再兜一层默认值
const FALLBACK_LABELS = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  glm: '智谱 GLM',
  manual: '手动补记',
};

export const SOURCE_LABELS = { ...FALLBACK_LABELS, ...(config.fundSourceLabels || {}) };

/** 唯一模型的展示名；没有单一模型时返回 null */
export const FUND_MODEL_LABEL = FUND_MODEL ? (SOURCE_LABELS[FUND_MODEL] || FUND_MODEL) : null;

export function normalizeSource(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'manual') return 'manual';
  // 配了令牌的来源即为合法来源。未知的（脏数据、已下线的工具）归到当前模型，
  // 免得建议被写进一个页面上根本不存在的格子
  if (config.fundIngestTokens && config.fundIngestTokens[s]) return s;
  return FUND_MODEL || 'workbuddy';
}

/** 这个来源是否还参与页面与复盘 */
export function isActiveSource(value) {
  if (!FUND_MODEL) return true;
  const s = normalizeSource(value);
  return s === FUND_MODEL || s === 'manual';
}

/**
 * SQL 过滤片段：把历史来源挡在计算之外。
 * 返回空 args 时调用方不应拼 WHERE（表示不限制）。
 */
export function activeSourceFilter(column = "IFNULL(source,'workbuddy')") {
  if (!FUND_MODEL) return { sql: '', args: [] };
  const marks = ACTIVE_SOURCES.map(() => '?').join(',');
  return { sql: `${column} IN (${marks})`, args: [...ACTIVE_SOURCES] };
}

/** 入账优先级：数字越小越优先。同一基金同一天只认排在最前的那条 */
export function sourceRank(source) {
  const s = normalizeSource(source);
  const order = config.fundSettlePriority;
  const i = order.indexOf(s);
  if (i >= 0) return i;
  const j = FUND_SOURCES.indexOf(s);
  return order.length + (j >= 0 ? j : FUND_SOURCES.length);
}
