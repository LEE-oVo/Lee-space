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

// 页面上的称呼。config 里已经内置了常见来源，这里再兜一层默认值
const FALLBACK_LABELS = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  glm: '智谱 GLM',
  manual: '手动补记',
};

export const SOURCE_LABELS = { ...FALLBACK_LABELS, ...(config.fundSourceLabels || {}) };

export function normalizeSource(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'manual') return 'manual';
  // 配了令牌的来源即为合法来源。未知的（脏数据、已下线的工具）一律归到主工具，
  // 免得建议被写进一个页面上根本不存在的格子
  if (config.fundIngestTokens && config.fundIngestTokens[s]) return s;
  return 'workbuddy';
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
