import { config } from '../config.js';

// 建议来源：两个工具各写各的判断，账本只有一本。
// 这个文件单独抽出来，是因为 funds.js 与 position.js 都要用它，
// 互相 import 会形成循环依赖。
export const FUND_SOURCES = ['workbuddy', 'trae', 'manual'];

export const SOURCE_LABELS = {
  workbuddy: 'WorkBuddy',
  trae: 'Trae Work',
  manual: '手动补记',
};

export function normalizeSource(value) {
  const s = String(value || '').trim().toLowerCase();
  return FUND_SOURCES.includes(s) ? s : 'workbuddy';
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
