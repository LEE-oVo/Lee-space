/**
 * 决策复盘的总览图。
 *
 * 页面上三层数据（模型成绩单 / 模拟组合 / 挑选增值）都是清单式的，
 * 打开就先看到一堆表格——但人第一眼想问的其实只有两句：
 *   1. 这几家里谁说得更准？（胜率）
 *   2. 照它们做，这段时间到底挣了还是亏了？（收益率与金额）
 * 所以把这两句各画成一张横向条形图钉在最上面，下面才是逐条的明细。
 *
 * 两张图的数据全部来自服务端已有的评估结果，这里只做挑选和画图：
 * 胜率取「机会成本口径」（持有记 0 分，全量可比），
 * 金额与收益率取层 ② 的模拟组合口径（剔除加减仓现金流，用 TWR）。
 */

import type { FundEvaluation, EvalRow } from '../types';

interface WinRow {
  key: string;
  label: string;
  /** 机会成本口径胜率：所有能看后市的建议都算，持有记 0 分 */
  winRate: number | null;
  /** 方向口径胜率：只数真正下单的建议 */
  betWinRate: number | null;
  count: number;
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
  const allRows: EvalRow[] = data.scorecard.allRows?.length ? data.scorecard.allRows : data.scorecard.rows;
  const sampleCount = data.scorecard.windowSampleCounts?.[primaryKey] ?? 0;

  /* ── 图一：胜率 ───────────────────────────────────────────── */
  const winRows: WinRow[] = data.scorecard.bySource.map((g) => ({
    key: g.source || g.key,
    label: g.sourceLabel || g.source || g.key,
    winRate: g.opportunity?.winRate ?? null,
    betWinRate: g.directional?.winRate ?? null,
    count: g.opportunity?.count ?? 0,
    betCount: g.directional?.count ?? 0,
    profit: g.money?.totalProfit ?? null,
    insufficient: Boolean(g.opportunity?.insufficient),
    tone: 'model' as const,
  }));

  // 「我的选择」= 这段时间里被采纳的那些建议，按同一套窗口与同一套口径算。
  // 这是全场唯一一处按采纳与否切出来的子集，所以必须放在图上明说：
  // 它衡量的是「我挑的那些」，不是「这家模型全部的建议」。
  const mineRows = allRows.filter((r) => r.adopted && r.unit?.[primaryKey] != null);
  const mineBets = mineRows.filter((r) => r.score?.[primaryKey] != null);
  const mineProfit = allRows
    .filter((r) => r.adopted && r.amount !== 0 && r.profit?.[primaryKey] != null)
    .reduce((sum, r) => sum + (r.profit[primaryKey] as number), 0);
  const mineWinRate = mineRows.length
    ? round2((mineRows.filter((r) => (r.unit[primaryKey] as number) > 0).length / mineRows.length) * 100)
    : null;
  const mineBetWinRate = mineBets.length
    ? round2((mineBets.filter((r) => (r.score[primaryKey] as number) > 0).length / mineBets.length) * 100)
    : null;

  if (mineRows.length) {
    winRows.push({
      key: '__mine__',
      label: '我的选择',
      winRate: mineWinRate,
      betWinRate: mineBetWinRate,
      count: mineRows.length,
      betCount: mineBets.length,
      profit: round2(mineProfit),
      insufficient: mineRows.length < data.minSamples,
      tone: 'mine',
    });
  }
  winRows.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));

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
      label: '我的选择（实际）',
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

  const bestRate = data.picks?.bestRate ?? null;
  const pickYuan = data.picks?.totalPickValueYuan ?? null;
  const span = data.scorecard.span;

  return (
    <div className="card eval-card evov-card">
      <div className="eval-head">
        <div>
          <div className="eval-title">总览</div>
          <div className="faint">
            窗口取「{windowLabel}」，{sampleCount} 条建议到期；左右两张图看的是同一段行情的两种问法
          </div>
        </div>
      </div>

      <div className="evov-metrics">
        <div className="evov-metric">
          <span>参与剧本</span>
          <b>{Math.max(invRows.length - (actual ? 2 : 1), 0)} 家 + 你自己</b>
          <em>谁的剧本都从同一份老仓位出发</em>
        </div>
        <div className="evov-metric">
          <span>我的挑中最优</span>
          <b className={bestRate != null && bestRate >= 50 ? 'up' : ''}>{fmtPct(bestRate, 1)}</b>
          <em>
            {data.picks?.count ?? 0} 次同日分歧 · {data.picks?.positive ?? 0} 次挑对
          </em>
        </div>
        <div className="evov-metric">
          <span>挑选增值合计</span>
          <b className={(pickYuan ?? 0) > 0 ? 'up' : 'down'}>{fmtYuan(pickYuan)}</b>
          <em>相对「挑另一条」的差额，样本极小</em>
        </div>
        <div className="evov-metric">
          <span>数据覆盖</span>
          <b>{data.scorecard.rowCount} 条建议</b>
          <em>{span ? `${span.from} ~ ${span.to}（${span.days} 天）` : '暂无区间'}</em>
        </div>
      </div>

      <div className="evov-grid">
        <section className="evov-panel">
          <div className="evov-sub">
            谁说得更准
            <span className="faint">
              条形长度＝机会成本口径胜率（持有记 0 分，全量可比）
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
                    {r.count} 条 · 其中 {r.betCount} 条真下单，这部分胜率{' '}
                    {fmtPct(r.betWinRate, 1)}
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
              条形长度＝时间加权收益率 TWR%，右侧为本金与盈亏
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
