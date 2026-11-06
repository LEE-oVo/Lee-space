/**
 * 决策复盘的总览图。
 *
 * 2026-11-06 起只保留一个分析模型，所以这里不再回答「谁说得更准」，
 * 只回答两个问题：
 *   1. AI 的建议到底押对没有？（胜率与金额）
 *   2. 照它做 vs 我自己做，这段时间谁挣得多？（TWR 与盈亏）
 * 两张图的数据全部来自服务端已有的评估结果，这里只做挑选和画图。
 */

import type { FundEvaluation } from '../types';

interface WinRow {
  key: string;
  label: string;
  /** 机会成本口径胜率：所有能看后市的建议都算，持有记 0 分 */
  winRate: number | null;
  count: number;
  /** 其中真正下单（买/卖）的条数，只作说明 */
  betCount: number;
  /** 金额口径这段时间折算出来的盈亏（元） */
  profit: number | null;
  insufficient: boolean;
  tone: 'model' | 'mine';
}

interface InvRow {
  key: string;
  label: string;
  twrPct: number | null;
  returnPct: number | null;
  netInvested: number | null;
  profit: number | null;
  maxDrawdownPct: number | null;
  vsBaselinePct: number | null;
  tone: 'model' | 'mine' | 'baseline';
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function fmtPct(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtYuan(v: number | null | undefined, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}¥${Math.abs(v).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function Bar({
  value,
  domain,
  zeroLeft,
  positiveClass = 'up',
}: {
  value: number;
  domain: [number, number];
  zeroLeft: number;
  positiveClass?: string;
}) {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const left = ((Math.min(value, 0) - lo) / span) * 100;
  const width = (Math.abs(value) / span) * 100;
  const positive = value >= 0;
  // 胜率那张图的零点就在最左边缘，画出来会跟容器描边叠在一起，索性不画
  const showZero = zeroLeft > 0.5 && zeroLeft < 99.5;
  return (
    <div className="evov-track">
      {showZero ? <div className="evov-zero" style={{ left: `${zeroLeft}%` }} /> : null}
      <div
        className={`evov-bar ${positive ? positiveClass : 'down'}`}
        style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
      />
    </div>
  );
}

export function FundEvaluationOverview({ data }: { data: FundEvaluation }) {
  const primaryKey = data.primary;
  const windowLabel = data.windows.find((w) => w.key === primaryKey)?.label || primaryKey;
  const sampleCount = data.scorecard.windowSampleCounts?.[primaryKey] ?? 0;
  const modelLabel = data.modelLabel || 'AI';
  const mine = data.myVsModel;

  /* ── 图一：准不准 ───────────────────────────────────────────── */
  const winRows: WinRow[] = [];
  if (mine) {
    // 用同一批决策做分母，AI 与我才是同题对照
    winRows.push({
      key: mine.model,
      label: `${modelLabel} 的建议`,
      winRate: mine.modelStats.winRate,
      count: mine.modelStats.count,
      betCount: mine.decisions.filter((d) => d.deltaPct != null && d.model.action !== 'hold').length,
      profit: mine.modelStats.totalProfit,
      insufficient: mine.modelStats.count < data.minSamples,
      tone: 'model',
    });
    winRows.push({
      key: '__mine__',
      label: '我的操作',
      winRate: mine.mineStats.winRate,
      count: mine.mineStats.count,
      betCount: mine.decisions.filter((d) => d.deltaPct != null && d.mine.action !== 'hold').length,
      profit: mine.mineStats.totalProfit,
      insufficient: mine.mineStats.count < data.minSamples,
      tone: 'mine',
    });
  } else {
    // 旧的多来源模式（没配 FUND_MODEL 时）还按来源列
    for (const g of data.scorecard.bySource) {
      winRows.push({
        key: g.source || g.key,
        label: g.sourceLabel || g.source || g.key,
        winRate: g.opportunity?.winRate ?? null,
        count: g.opportunity?.count ?? 0,
        betCount: g.directional?.count ?? 0,
        profit: g.money?.totalProfit ?? null,
        insufficient: Boolean(g.opportunity?.insufficient),
        tone: 'model',
      });
    }
  }

  /* ── 图二：总的投资结果 ──────────────────────────────────── */
  const baseline = data.simulations.find((s) => s.isBaseline) || null;
  const invRows: InvRow[] = data.simulations
    .filter((s) => !s.isBaseline)
    .map((s) => ({
      key: s.source,
      label: `全听 ${s.sourceLabel}`,
      twrPct: s.summary?.twrPct ?? null,
      returnPct: s.summary?.returnPct ?? null,
      netInvested: s.summary?.netInvested ?? null,
      profit: s.summary?.profit ?? null,
      maxDrawdownPct: s.summary?.maxDrawdownPct ?? null,
      vsBaselinePct: data.vsBaseline?.[s.source]?.twrVsBaselinePct ?? null,
      tone: 'model' as const,
    }));

  const actual = data.actualSummary;
  if (actual) {
    invRows.push({
      key: '__mine__',
      label: '我的操作（实际）',
      twrPct: actual.twrPct ?? null,
      returnPct: actual.returnPct ?? null,
      netInvested: actual.netInvested ?? null,
      profit: actual.profit ?? null,
      maxDrawdownPct: actual.maxDrawdownPct ?? null,
      vsBaselinePct:
        baseline?.summary?.twrPct != null && actual.twrPct != null
          ? round2(actual.twrPct - baseline.summary.twrPct)
          : null,
      tone: 'mine',
    });
  }
  if (baseline?.summary) {
    invRows.push({
      key: '__hold__',
      label: '完全不操作',
      twrPct: baseline.summary.twrPct ?? null,
      returnPct: baseline.summary.returnPct ?? null,
      netInvested: baseline.summary.netInvested ?? null,
      profit: baseline.summary.profit ?? null,
      maxDrawdownPct: baseline.summary.maxDrawdownPct ?? null,
      vsBaselinePct: 0,
      tone: 'baseline' as const,
    });
  }

  const invValues = invRows.map((r) => r.twrPct).filter((v): v is number => v != null);
  const invDomain: [number, number] = [
    Math.min(0, ...invValues),
    Math.max(0, ...invValues),
  ];
  const invSpan = invDomain[1] - invDomain[0] || 1;
  const invZeroLeft = ((0 - invDomain[0]) / invSpan) * 100;

  const span = data.scorecard.span;

  return (
    <div className="card eval-card evov-card">
      <div className="eval-head">
        <div>
          <div className="eval-title">总览</div>
          <div className="faint">
            窗口取「{windowLabel}」，{sampleCount} 条建议到期；
            左边看 {modelLabel} 说得准不准，右边看照它做 vs 你自己做
          </div>
        </div>
      </div>

      <div className="evov-metrics">
        <div className="evov-metric">
          <span>建议条数</span>
          <b>{data.scorecard.rowCount} 条</b>
          <em>{modelLabel} 的历史记录，全部按纸上交易打分</em>
        </div>
        <div className="evov-metric">
          <span>我与 AI 一致</span>
          <b className={mine?.agreeRate != null && mine.agreeRate >= 50 ? 'up' : ''}>
            {fmtPct(mine?.agreeRate ?? null, 1)}
          </b>
          <em>
            {mine ? `${mine.same}/${mine.count} 次同日同基金照做或不动` : '暂无对照'}
          </em>
        </div>
        <div className="evov-metric">
          <span>偏离的差额</span>
          <b className={(mine?.totalDeltaYuan ?? 0) > 0 ? 'up' : (mine?.totalDeltaYuan ?? 0) < 0 ? 'down' : ''}>
            {fmtYuan(mine?.totalDeltaYuan ?? null)}
          </b>
          <em>
            {mine
              ? `${mine.deviations} 次改主意/没动，正数说明你改得更好`
              : '暂无对照'}
          </em>
        </div>
        <div className="evov-metric">
          <span>数据覆盖</span>
          <b>{span ? `${span.from.slice(5)} ~ ${span.to.slice(5)}` : '暂无区间'}</b>
          <em>{span ? `${span.days} 个交易日` : '还没有建议'}</em>
        </div>
      </div>

      <div className="evov-grid">
        <section className="evov-panel">
          <div className="evov-sub">
            {modelLabel} 说得准不准
            <span className="faint">
              条形长度＝机会成本口径胜率（持有记 0 分）
            </span>
          </div>
          {winRows.length === 0 ? (
            <div className="eval-empty">还没有可评的建议</div>
          ) : (
            winRows.map((r) => (
              <div className={`evov-row ${r.tone === 'mine' ? 'is-mine' : ''}`} key={r.key}>
                <div className="evov-name">
                  {r.label}
                  {r.insufficient ? <span className="eval-thin-mark">样本少</span> : null}
                </div>
                <div className="evov-barcol">
                  <Bar value={r.winRate ?? 0} domain={[0, 100]} zeroLeft={0} />
                  <div className="evov-note">
                    {r.count} 条 · 其中 {r.betCount} 条真下单
                  </div>
                </div>
                <div className="evov-val">
                  <span className={r.winRate == null ? '' : r.winRate >= 50 ? 'up' : 'down'}>
                    {fmtPct(r.winRate, 1)}
                  </span>
                  <em>{fmtYuan(r.profit)}</em>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="evov-panel">
          <div className="evov-sub">
            照谁做挣了多少
            <span className="faint">
              条形长度＝时间加权收益率 TWR%
            </span>
          </div>
          {invRows.length === 0 ? (
            <div className="eval-empty">还没有可比的模拟组合</div>
          ) : (
            invRows.map((r) => (
              <div
                className={`evov-row ${r.tone === 'mine' ? 'is-mine' : ''} ${
                  r.tone === 'baseline' ? 'is-baseline' : ''
                }`}
                key={r.key}
              >
                <div className="evov-name">{r.label}</div>
                <div className="evov-barcol">
                  <Bar value={r.twrPct ?? 0} domain={invDomain} zeroLeft={invZeroLeft} />
                  <div className="evov-note">
                    本金 {fmtYuan(r.netInvested)} · 盈亏 {fmtYuan(r.profit)} · 回撤{' '}
                    {fmtPct(r.maxDrawdownPct, 1)}
                    {r.tone === 'baseline' ? '' : ` · 相对不动 ${fmtPct(r.vsBaselinePct, 2)}`}
                  </div>
                </div>
                <div className="evov-val">
                  <span className={r.twrPct == null ? '' : r.twrPct >= 0 ? 'up' : 'down'}>
                    {fmtPct(r.twrPct)}
                  </span>
                  <em>简单收益 {fmtPct(r.returnPct)}</em>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
