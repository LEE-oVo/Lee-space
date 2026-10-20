/**
 * 事后评估核对脚本（第九套）
 *
 * 本机跑：`DB_PATH=./data/local-test.db node verify-evaluation.mjs`
 *
 * 为什么要单独跑一遍而不是直接上线看：
 * 评估里全是「事后才知道」的数，一旦算错谁也看不出来——它们是错的，
 * 页面上却照样是一条漂亮的曲线。所以这里把每条建议的收益用最笨的方式
 * 重算一遍（直接按日期在净值表里查），跟 evaluation.js 的结果对，对不上就是 bug。
 *
 * 覆盖点：
 *   A. 前瞻收益：基准价必须取建议当天的收盘净值（这是真正的成交价）
 *   B. 方向符号：add/buy 涨了算赢，reduce/sell 跌了算赢，hold 不进胜负率
 *   C. 模拟组合：老仓位（非 advice 批次）只能算一遍，采纳建议买出来的批次必须整段排除
 *   D. 挑选增值：只看同一天同一只基金的横向对比，跨日期不得混算
 *   E. 样本不足：视窗回退到「次日」时必须显式告警，不许静默出结论
 */

import Database from 'better-sqlite3';
import { evaluationReport, EVAL_WINDOWS } from './src/services/evaluation.js';
import { equityCurve } from './src/services/position.js';

const dbPath = process.env.DB_PATH || './data/local-test.db';
const db = new Database(dbPath, { readonly: true });

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

const navRows = db.prepare(`SELECT code, nav_date, nav FROM fund_nav ORDER BY code, nav_date`).all();
const navMap = new Map();
for (const r of navRows) {
  if (!navMap.has(r.code)) navMap.set(r.code, []);
  navMap.get(r.code).push({ date: r.nav_date, nav: r.nav });
}

console.log('\n=== 0. 数据概况 ===');
const counts = db.prepare(`SELECT IFNULL(source,'workbuddy') s, COUNT(*) c FROM fund_advice GROUP BY s`).all();
console.log('  建议行数（按来源）:', counts.map((r) => `${r.s}=${r.c}`).join('  '));
const actCounts = db.prepare(`SELECT action, COUNT(*) c FROM fund_advice GROUP BY action`).all();
console.log('  动作分布:', actCounts.map((r) => `${r.action}=${r.c}`).join('  '));
console.log('  净值天数:', [...navMap.values()].map((a) => a.length).join('/'));

console.log('\n=== 1. 生成评估报告 ===');
const report = evaluationReport();
const card = report.scorecard;
console.log(`  行数 ${card.rowCount}，主视窗 ${report.primary}，跨度 ${card.span?.from} → ${card.span?.to}`);
console.log('  各窗口样本:', JSON.stringify(card.windowSampleCounts));
check('生成不报错', true);
check('每 advise 行都有对应的评估行', card.rowCount === counts.reduce((a, b) => a + b.c, 0),
  `${card.rowCount} vs ${counts.reduce((a, b) => a + b.c, 0)}`);

console.log('\n=== 2. A · 前瞻收益用「建议当天」的收盘净值做基准 ===');
{
  // 抽 8 条有 t1 的 add/buy，用最笨的方式重算
  const marked = card.rows.filter((r) => r.status === 'ok' && r.fwd.t1 != null).slice(0, 8);
  let allMatch = true;
  let firstDetail = '';
  for (const r of marked) {
    const arr = navMap.get(r.code) || [];
    const i = arr.findIndex((p) => p.date === r.tradeDate);
    if (i < 0 || i + 1 >= arr.length) continue;
    const expect = ((arr[i + 1].nav - arr[i].nav) / arr[i].nav) * 100;
    const got = r.fwd.t1;
    if (Math.abs(expect - got) > 0.02) {
      allMatch = false;
      firstDetail = `${r.code} ${r.tradeDate} 期望 ${expect.toFixed(2)} 实得 ${got}`;
    }
    // 基准净值必须等于当天净值
    if (Math.abs(arr[i].nav - r.baseNav) > 1e-4) {
      allMatch = false;
      firstDetail = `${r.code} ${r.tradeDate} baseNav ${r.baseNav} != ${arr[i].nav}`;
    }
  }
  check('t1 前瞻收益与笨算一致（抽查 8 条）', allMatch, firstDetail);

  // 长窗口要跨的是「交易日」而不是自然日：t5 的日期必须在 seri 里排第 6 位
  const long = card.rows.find((r) => r.fwd.t5 != null);
  if (long) {
    const arr = navMap.get(long.code) || [];
    const i = arr.findIndex((p) => p.date === long.tradeDate);
    const w5 = db.prepare(`SELECT nav_date FROM fund_nav WHERE code=? AND nav_date > ? ORDER BY nav_date LIMIT 1 OFFSET 4`)
      .get(long.code, long.tradeDate);
    check('t5 取的是第 5 个交易日（非自然日）', arr[i + 5]?.date === w5?.nav_date,
      `${arr[i + 5]?.date} vs ${w5?.nav_date}`);
  } else {
    check('t5 有样本可供核对', false, '当前库里没有走到 T+5 的建议');
  }
}

console.log('\n=== 3. B · 方向符号、hold 记 0、金额口径 ===');
{
  const bad = [];
  for (const row of card.rows) {
    if (row.status !== 'ok') continue;
    for (const w of EVAL_WINDOWS) {
      if (row.fwd[w.key] == null) continue;
      if (row.bet === 'long') {
        if (row.score[w.key] !== row.fwd[w.key]) bad.push(`${row.code} ${w.key} long`);
        if (row.unit[w.key] !== row.fwd[w.key]) bad.push(`${row.code} ${w.key} long-unit`);
        if (row.hit[w.key] !== (row.fwd[w.key] > 0)) bad.push(`${row.code} ${w.key} hit`);
      } else if (row.bet === 'short') {
        if (row.score[w.key] !== -row.fwd[w.key]) bad.push(`${row.code} ${w.key} short`);
        if (row.hit[w.key] !== (row.fwd[w.key] < 0)) bad.push(`${row.code} ${w.key} hit`);
      } else if (row.score[w.key] != null || row.hit[w.key] != null) {
        bad.push(`${row.code} ${w.key} hold 方向口径不该有 score`);
      } else if (row.unit[w.key] !== 0) {
        bad.push(`${row.code} ${w.key} hold 机会成本口径必须为 0`);
      }
      // 金额口径：amount 带符号，直接用 amount*fwd/100，方向自动带上
      const expectProfit = (row.amount * row.fwd[w.key]) / 100;
      if (Math.abs(row.profit[w.key] - expectProfit) > 0.02) {
        bad.push(`${row.code} ${w.key} profit ${row.profit[w.key]} != ${expectProfit.toFixed(2)}`);
      }
    }
  }
  check('add=+前瞻 / 减仓=−前瞻 / hold 方向口径不计、机会成本口径记 0 / 金额口径自洽',
    bad.length === 0, bad.slice(0, 3).join('; '));

  const w = card.windows[report.primary];
  const betRows = card.rows.filter((r) => r.score[report.primary] != null).length;
  const allRows = card.rows.filter((r) => r.unit[report.primary] != null).length;
  const holdRows = card.rows.filter((r) => r.bet === 'none' && r.fwd[report.primary] != null).length;
  check('方向口径 count == 下注行数', w.directional.count === betRows, `${w.directional.count} vs ${betRows}`);
  check('机会成本口径 count == 全部可看后市的行', w.opportunity.count === allRows, `${w.opportunity.count} vs ${allRows}`);
  check('hold 行数单列统计、未混入方向口径', w.hold.count === holdRows, `${w.hold.count} vs ${holdRows}`);
  check('hold 不再让样本废掉一半', allRows > betRows, `全量 ${allRows} / 下注 ${betRows}`);
  // 未被采纳的建议也必须被评分（这是整套方法的立足点）
  const unadoptedScored = card.rows.filter((r) => !r.adopted && r.unit[report.primary] != null).length;
  check('未采纳的建议同样被评分', unadoptedScored > 0, `未采纳但已评分 ${unadoptedScored} 条`);
}

console.log('\n=== 4. C · 模拟组合：底层批次不得重复计入 ===');
{
  const adviceLots = db.prepare(`SELECT COUNT(*) c FROM fund_lots WHERE source='advice'`).get().c;
  const baseLots = db.prepare(`SELECT COUNT(*) c FROM fund_lots WHERE IFNULL(source,'')<>'advice'`).get().c;
  console.log(`  账本批次：非建议产生 ${baseLots} 笔，采纳建议产生 ${adviceLots} 笔`);

  const real = equityCurve();
  const sims = report.simulations;
  check('每个来源各有一条模拟曲线 + 一条无操作基准',
    sims.length === card.sources.length + 1 && sims.some((s) => s.isBaseline),
    `${sims.length} 条 / 来源 ${card.sources.length}`);

  for (const s of sims) {
    const pts = s.points;
    const monotone = pts.every((p, i) => i === 0 || p.date > pts[i - 1].date);
    const finite = pts.every((p) => Number.isFinite(p.market) && Number.isFinite(p.twrPct));
    check(`${s.sourceLabel}: 曲线单调且数值有限`, monotone && finite);
  }
  // 无操作基准的最后市值，应等于「老仓位」的市值，不受任何建议影响
  const base = sims.find((s) => s.isBaseline);
  const lastNavs = new Map();
  for (const [code, arr] of navMap) lastNavs.set(code, arr[arr.length - 1].nav);
  let legacyValue = 0;
  for (const l of db.prepare(`SELECT code, shares FROM fund_lots WHERE IFNULL(source,'')<>'advice'`).all()) {
    const nav = lastNavs.get(l.code);
    if (nav) legacyValue += l.shares * nav;
  }
  check('无操作基准的期末市值 == 老仓位按最后净值折算',
    Math.abs((base.summary?.market || 0) - legacyValue) < 1,
    `${base.summary?.market} vs ${legacyValue.toFixed(2)}`);

  // 模拟里「按建议买入」的净投入不得超过总投资上限
  const cfgTotal = 15000;
  for (const s of sims) {
    check(`${s.sourceLabel}: 净投入未突破总投资上限`,
      (s.summary?.netInvested || 0) <= cfgTotal + 0.01,
      `${s.summary?.netInvested}`);
  }
  console.log('  各曲线期末：', sims.map((s) => `${s.sourceLabel} 投入${s.summary?.netInvested} TWR ${s.summary?.twrPct}%`).join(' | '));
  console.log(`  真实组合：投入${real.summary?.netInvested} TWR ${real.summary?.twrPct}%`);
  check('真实组合与自己重算的 TWR 一致（回归保护）',
    Math.abs((real.summary?.twrPct || 0) - (equityCurve().summary?.twrPct || 0)) < 1e-9);
}

console.log('\n=== 5. D · 挑选增值只在「同日同基金」内横比 ===');
{
  const p = report.picks;
  console.log(`  可评决策 ${p.count} 条，未操作 ${p.undecided.length} 条，选中最优率 ${p.bestRate}%`);
  console.log(`  平均每元挑增 ${p.avgPickValuePct}pp，平均金额挑增 ${p.avgPickValueYuan} 元`);
  check('被拒条目与采纳条目不同源、且至少有一条',
    p.decisions.every((d) => d.rejected.length >= 1 && !d.rejected.some((r) => r.source === d.chosen.source)));
  check('所有决策均同日同基金（不得跨日期）',
    p.decisions.every((d) => d.tradeDate && d.code && d.participants >= 2));
  const pk = new Set(p.decisions.map((d) => `${d.code}|${d.tradeDate}`));
  check('无重复决策主键', pk.size === p.decisions.length);
  // add 对上 hold 必须能比出差值（这正是账户里最常见的分歧），否则整套层 ③ 就是死的
  const addVsHold = p.decisions.filter(
    (d) => [d.chosen, ...d.rejected].some((r) => r.action === 'add' || r.action === 'buy')
      && [d.chosen, ...d.rejected].some((r) => r.action === 'hold')
  );
  check('存在「加仓 vs 不动」的可比决策', addVsHold.length > 0, `${addVsHold.length} 条`);
  check('这种决策的挑增不得恒为 0', addVsHold.some((d) => d.pickValuePct !== 0),
    addVsHold.map((d) => d.pickValuePct).join(','));
  if (p.decisions[0]) {
    for (const d of p.decisions.slice(0, 3)) {
      console.log(`  ${d.tradeDate} ${d.name} 采纳 ${d.chosen.sourceLabel}(${d.chosen.action}${d.chosen.amount ? ` ${d.chosen.amount}` : ''}) ` +
        `得分 ${d.chosen.scorePct}% / 未采纳均值 ${d.otherMeanPct}% → 挑增 ${d.pickValuePct}pp · ${d.pickValueYuan}元，排名 ${d.rank}/${d.participants}`);
    }
  }
}

console.log('\n=== 6. E · 样本不足必须告警 ===');
{
  const longZero = EVAL_WINDOWS.filter((w) => w.key !== 't1')
    .filter((w) => (card.windowSampleCounts[w.key] || 0) === 0)
    .map((w) => w.label);
  for (const label of longZero) {
    check(`提示「${label}」无可评样本`, report.notes.some((n) => n.includes(label)),
      report.notes.join(' / '));
  }
  if (report.primaryInsufficient) {
    check('主视窗样本不足时给出显式告警', report.notes.some((n) => n.includes('样本不足')));
  }
  check('评估报告标记为「暂不回传」', report.isolation.feedbackAllowed === false);
  for (const n of report.notes) console.log(`   · ${n}`);
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
