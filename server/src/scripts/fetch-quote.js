/*
 * 拉一次盘中估值并写库。定时任务（每 5 分钟）和页面上的「刷新估值」按钮
 * 共用 services/quote.js 里的同一个函数，两边结果一致、互不干扰。
 *
 * 手动执行：cd /opt/workbench/server && node src/scripts/fetch-quote.js
 */
import { refreshQuotes } from '../services/quote.js';

// --force 只给调试用：跳过盘中判断硬拉一次，验证兜底链是不是通的
const force = process.argv.includes('--force');
const result = await refreshQuotes({ force });

const summary = {
  at: new Date().toISOString(),
  trading: result.trading,
  reason: result.reason || null,
  written: result.written,
  unresolved: result.unresolved || [],
};
console.log(JSON.stringify(summary));

if (!result.trading) process.exit(0);
const total = (result.unresolved || []).length + result.written;
// 全部拉不到才算失败——单个标的换源失败是常态，不该让 systemd 记一堆错误
process.exit(total > 0 && result.written === 0 ? 1 : 0);
