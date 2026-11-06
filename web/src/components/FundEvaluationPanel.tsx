/**
 * 决策复盘面板。
 *
 * 只有一个分析模型了，所以这里只回答两个问题：
 *   ① AI 的建议准不准（逐条纸上交易，按基金 / 置信度拆分）
 *   ② 我实际做的操作，比 AI 的建议好还是差（逐日对照 + 组合曲线）
 *
 * ② 含我本人的取舍，绝不能回流给模型：它一旦知道自己被对照，
 * 就会照着我的偏好改答案，这份复盘也就失效了。
 *
 * 数据全部来自 /funds/evaluation，要求 fund:detail + 已登录。
 */

import { useMemo, useState } from 'react';
import type { EvalGroup, EvalMyDecision, EvalRow, EvalStat, FundEvaluation } from '../types';

type Tab = 'scorecard' | 'compare';

const ACTION_LABEL: Record<string, string> = {
  buy: '买入', add: '加仓', hold: '持有', reduce: '减仓', sell: '卖出',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高', medium: '中', low: '低', unset: '未标',
};

const STATUS_LABEL: Record<EvalMyDecision['status'], string> = {
  same: '照做',
  changed: '改主意',
  none: '没动',
};

function pct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function yuan(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : '−'}¥${Math.abs(value).toFixed(0)}`;
}

function tone(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return '';
}

/** 样本不够时把数字压暗并挂提示，别让人拿 3 条数据的排名当结论 */
function MaybeThin({ stat, minSamples, children }: { stat: EvalStat; minSamples: number; children: React.ReactNode }) {
  if (!stat.insufficient) return <>{children}</>;
  return (
    <span className="eval-thin" title={`只有 ${stat.count} 条样本，不足 ${minSamples} 条，仅供参考`}>
      {children}
      <sup className="eval-thin-mark">样本少</sup>
    </span>
  );
}

function StatTable({ rows, groupLabel, minSamples }: { rows: EvalGroup[]; groupLabel: string; minSamples: number }) {
  return (
    <table className="eval-table">
      <thead>
        <tr>
          <th>{groupLabel}</th>
          <th title="这个模型建议的数量">建议数</th>
          <th title="机会成本口径：加仓=基金涨幅，持有=0，减仓=跌幅">平均前瞻</th>
          <th title="机会成本口径下得分为正的比例">胜率</th>
          <th title="得分波动：越小说明发挥越稳定">波动</th>
          <th title="只统计真正下单的建议，hold 不参与">押注数</th>
          <th title="押方向押对了的数量">押中</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={`${groupLabel}-${g.key}`}>
            <td className="eval-name">
              {g.name || g.confidence || g.code || g.key}
              {g.code ? <span className="faint"> {g.code}</span> : null}
              {g.confidence && !g.name ? (
                <span className="faint"> {CONFIDENCE_LABEL[g.confidence] || g.confidence}</span>
              ) : null}
            </td>
            <td className="mono">{g.opportunity.count}</td>
            <td className={`mono ${tone(g.opportunity.avgScorePct)}`}>
              <MaybeThin stat={g.opportunity} minSamples={minSamples}>
                {pct(g.opportunity.avgScorePct)}
              </MaybeThin>
            </td>
            <td className="mono">{g.opportunity.winRate === null ? '—' : `${g.opportunity.winRate}%`}</td>
            <td className="mono faint">{g.opportunity.stdScorePct === null ? '—' : g.opportunity.stdScorePct.toFixed(2)}</td>
            <td className="mono">{g.directional.count}</td>
            <td className="mono">
              {g.directional.count && g.directional.insufficient ? (
                <MaybeThin stat={g.directional} minSamples={minSamples}>
                  {`${g.directional.wins}/${g.directional.count}`}
                </MaybeThin>
              ) : g.directional.count ? (
                `${g.directional.wins}/${g.directional.count}`
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowList({ rows, windowKey }: { rows: EvalRow[]; windowKey: string }) {
  const items = rows.filter((r) => r.status === 'ok' && r.unit[windowKey] != null);
  if (!items.length) return <div className="eval-empty">这个窗口还没有能看的后市数据。</div>;
  return (
    <table className="eval-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>基金</th>
          <th>建议</th>
          <th>采纳</th>
          <th title="这段时间基金本身的涨跌">基金涨跌</th>
          <th title="照这条建议做，这笔钱多赚/少赚多少">这次多少钱</th>
          <th title="每元口径：加仓=基金涨幅，持有=0，减仓=跌幅">每元得分</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id}>
            <td className="mono faint">{r.tradeDate.slice(5)}</td>
            <td className="eval-name" title={r.name}>{r.name}</td>
            <td>
              <span className={`act-${r.action === 'hold' ? 'hold' : 'buy'}`}>{ACTION_LABEL[r.action] || r.action}</span>
              {r.amount ? <span className="faint mono"> ¥{r.amount}</span> : null}
            </td>
            <td>{r.adopted ? '✓' : ''}</td>
            <td className={`mono ${tone(r.fwd[windowKey])}`}>{pct(r.fwd[windowKey])}</td>
            <td className={`mono ${tone(r.profit[windowKey])}`}>{yuan(r.profit[windowKey])}</td>
            <td className={`mono ${tone(r.unit[windowKey])}`}>{pct(r.unit[windowKey])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompareTable({ rows }: { rows: EvalMyDecision[] }) {
  if (!rows.length) return <div className="eval-empty">还没有可对照的记录。</div>;
  return (
    <table className="eval-table eval-compare">
      <thead>
        <tr>
          <th>日期</th>
          <th>基金</th>
          <th>AI 建议</th>
          <th>我的操作</th>
          <th>状态</th>
          <th title="这段时间基金本身的涨跌">基金涨跌</th>
          <th title="AI 按机会成本口径的得分">AI 得分</th>
          <th title="我实际操作的得分；没动记 0">我的得分</th>
          <th title="我的得分 − AI 得分：正数说明我改得更好">差额</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={`${d.code}-${d.tradeDate}`}>
            <td className="mono faint">{d.tradeDate.slice(5)}</td>
            <td className="eval-name" title={d.name}>{d.name}</td>
            <td>
              <span className={`act-${d.model.action === 'hold' ? 'hold' : 'buy'}`}>
                {ACTION_LABEL[d.model.action] || d.model.action}
              </span>
              {d.model.amount ? <span className="faint mono"> ¥{d.model.amount}</span> : null}
            </td>
            <td>
              <span className={`act-${d.mine.action === 'hold' ? 'hold' : 'buy'}`}>
                {ACTION_LABEL[d.mine.action] || d.mine.action}
              </span>
              {d.mine.amount ? <span className="faint mono"> ¥{d.mine.amount}</span> : null}
              {d.mine.source === 'manual' ? <span className="faint"> 补记</span> : null}
            </td>
            <td>
              <span className={`eval-status is-${d.status}`}>{STATUS_LABEL[d.status]}</span>
              <span className="faint" style={{ fontSize: 11, marginLeft: 4 }}>{d.windowLabel}</span>
            </td>
            <td className={`mono ${tone(d.fundFwdPct)}`}>{pct(d.fundFwdPct)}</td>
            <td className={`mono ${tone(d.model.scorePct)}`}>{pct(d.model.scorePct)}</td>
            <td className={`mono ${tone(d.mine.scorePct)}`}>{pct(d.mine.scorePct)}</td>
            <td className={`mono ${tone(d.deltaPct)}`}>
              {pct(d.deltaPct)}
              {d.deltaYuan != null ? <span className="faint"> ({yuan(d.deltaYuan)})</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FundEvaluationPanel({ data }: { data: FundEvaluation }) {
  const [tab, setTab] = useState<Tab>('scorecard');
  const [windowKey, setWindowKey] = useState(data.primary);
  const [onlyDeviations, setOnlyDeviations] = useState(false);
  const card = data.scorecard;
  const mine = data.myVsModel;
  const w = card.windows[windowKey] || card.windows[data.primary];
  const modelLabel = data.modelLabel || 'AI';

  const baseline = data.simulations.find((s) => s.isBaseline);
  const actual = data.actualSummary;

  // 仿真曲线按下限/上限做公共坐标，几条线画在一起才比得出高低。
  // 真实组合也要算进来，否则它可能画到坐标区外面
  const simCurves = useMemo(() => {
    const all = [
      ...data.simulations.flatMap((s) => s.points.map((p) => p.twrPct)),
      ...(data.actualPoints || []).map((p) => p.twrPct),
    ];
    if (!all.length) return { min: 0, max: 0 };
    return { min: Math.min(...all), max: Math.max(...all) };
  }, [data.simulations, data.actualPoints]);

  const compareRows = useMemo(
    () => (mine ? (onlyDeviations ? mine.decisions.filter((d) => d.status !== 'same') : mine.decisions) : []),
    [mine, onlyDeviations]
  );

  return (
    <div className="card eval-card">
      <div className="eval-head">
        <div>
          <div className="eval-title">决策复盘</div>
          <div className="faint">
            {card.span ? `${card.span.from} → ${card.span.to}，共 ${card.rowCount} 条建议` : '还没有建议数据'}
            {' · 主视窗 '}
            {w?.label || '—'}
          </div>
        </div>
        <div className="eval-tabs">
          <button className={`eval-tab${tab === 'scorecard' ? ' is-on' : ''}`} onClick={() => setTab('scorecard')}>
            ① 建议成绩单
          </button>
          <button className={`eval-tab${tab === 'compare' ? ' is-on' : ''}`} onClick={() => setTab('compare')}>
            ② 我的操作 vs AI
          </button>
        </div>
      </div>

      {data.notes.length > 0 && (
        <div className="eval-notes">
          {data.notes.map((n) => (
            <div key={n}>· {n}</div>
          ))}
        </div>
      )}

      {tab === 'scorecard' && (
        <>
          <div className="eval-window-picker">
            <span className="faint">前瞻窗口</span>
            {data.windows.map((opt) => (
              <button
                key={opt.key}
                className={`eval-chip${windowKey === opt.key ? ' is-on' : ''}`}
                disabled={(card.windowSampleCounts[opt.key] || 0) === 0}
                onClick={() => setWindowKey(opt.key)}
                title={`${opt.label}：${card.windowSampleCounts[opt.key] || 0} 条可评`}
              >
                {opt.label}
                <span className="faint"> {card.windowSampleCounts[opt.key] || 0}</span>
              </button>
            ))}
          </div>

          <div className="eval-body">
            <div className="eval-summary">
              <div className="eval-metric">
                <span className="eval-metric-label">建议总数</span>
                <b className="mono">{card.rowCount}</b>
                <span className="faint">可评 {w?.opportunity.count ?? 0}</span>
              </div>
              <div className="eval-metric">
                <span className="eval-metric-label">平均前瞻收益</span>
                <b className={`mono ${tone(w?.opportunity.avgScorePct)}`}>{pct(w?.opportunity.avgScorePct)}</b>
                <span className="faint">持有记 0 的口径</span>
              </div>
              <div className="eval-metric">
                <span className="eval-metric-label">押方向的胜率</span>
                <b className="mono">{w?.directional.winRate === null ? '—' : `${w?.directional.winRate}%`}</b>
                <span className="faint">{w?.directional.count ?? 0} 条真下单</span>
              </div>
              <div className="eval-metric">
                <span className="eval-metric-label">按金额折算</span>
                <b className={`mono ${tone(w?.money.totalProfit)}`}>{yuan(w?.money.totalProfit)}</b>
                <span className="faint">{w?.money.count ?? 0} 条有金额</span>
              </div>
            </div>

            {w && w.hold.count > 0 && (
              <div className="eval-hold-note">
                其中 <b>{w.hold.count}</b> 条是「持有」：那段时间基金平均 {pct(w.hold.avgFwdPct)}，
                避开下跌 <b className="up">{w.hold.avoidedDrop}</b> 次、错过上涨 <b className="down">{w.hold.missedRise}</b> 次。
                持有不进上面的胜率——它没押方向，混进去会把「保守」算成「看错」。
              </div>
            )}

            <h4 className="eval-sub">按基金</h4>
            <StatTable rows={card.byFund} groupLabel="基金" minSamples={data.minSamples} />
            <h4 className="eval-sub">按置信度</h4>
            <StatTable rows={card.byConfidence} groupLabel="置信度" minSamples={data.minSamples} />

            <h4 className="eval-sub">逐条明细</h4>
            <RowList rows={card.rows} windowKey={windowKey} />
          </div>
        </>
      )}

      {tab === 'compare' && (
        <div className="eval-body">
          <div className="eval-explain">
            同一天、同一只基金，{modelLabel} 给了一条建议，我实际做的可能与它相同、也可能改主意。
            两边都按同一套「机会成本」口径打分：买/加仓 = 基金涨跌，卖/减仓 = 跌幅，没动 = 0。
            基金本身的涨跌在这里被约掉，剩下的纯粹是「我的取舍值不值」。
            <b> 这一层永远不回传给模型。</b>
          </div>

          {!mine ? (
            <div className="eval-empty">还没有可对照的数据。</div>
          ) : (
            <>
              <div className="eval-summary">
                <div className="eval-metric">
                  <span className="eval-metric-label">可对照决策</span>
                  <b className="mono">{mine.count}</b>
                  <span className="faint">已到期 {mine.evaluated}</span>
                </div>
                <div className="eval-metric">
                  <span className="eval-metric-label">与 AI 一致</span>
                  <b className="mono">{mine.agreeRate === null ? '—' : `${mine.agreeRate}%`}</b>
                  <span className="faint">
                    照做 {mine.same} · 改主意 {mine.changed} · 没动 {mine.noAction}
                  </span>
                </div>
                <div className="eval-metric">
                  <span className="eval-metric-label">平均偏离（每元）</span>
                  <b className={`mono ${tone(mine.avgDeltaPct)}`}>{pct(mine.avgDeltaPct)}</b>
                  <span className="faint">改好 {mine.better} / 改坏 {mine.worse}</span>
                </div>
                <div className="eval-metric">
                  <span className="eval-metric-label">偏离折合金额</span>
                  <b className={`mono ${tone(mine.totalDeltaYuan)}`}>{yuan(mine.totalDeltaYuan)}</b>
                  <span className="faint">正数说明我改得更好</span>
                </div>
              </div>

              {mine.insufficient && (
                <div className="eval-warn">
                  只有 {mine.evaluated} 条可对照决策（门槛 {mine.minSamples} 条）。
                  现在这个数大概率是运气，攒到十几条再看。
                </div>
              )}

              <h4 className="eval-sub">组合曲线：全听 AI vs 我的操作</h4>
              <div className="eval-explain">
                两条剧本都从同一份「建议期之前就有的老仓位」出发，只在建议期之后按各自的走法推进；
                再把「完全不操作」当基线，用来回答这段时间择时到底挣了钱还是毁了钱。
              </div>
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>剧本</th>
                    <th title="最终总资产">期末市值</th>
                    <th title="累计投入">净投入</th>
                    <th title="时间加权收益率：忽略加减仓现金流的影响">TWR</th>
                    <th title="相对「完全不操作」的超额">vs 基线</th>
                    <th>最大回撤</th>
                    <th>交易数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.simulations.filter((s) => !s.isBaseline).map((s) => {
                    const vs = data.vsBaseline[s.source];
                    return (
                      <tr key={s.source}>
                        <td className="eval-name">{s.sourceLabel}</td>
                        <td className="mono">¥{Math.round(s.summary?.market || 0).toLocaleString('zh-CN')}</td>
                        <td className="mono">¥{Math.round(s.summary?.netInvested || 0).toLocaleString('zh-CN')}</td>
                        <td className={`mono ${tone(s.summary?.twrPct)}`}>{pct(s.summary?.twrPct)}</td>
                        <td className={`mono ${tone(vs?.twrVsBaselinePct)}`}>{pct(vs?.twrVsBaselinePct)}</td>
                        <td className="mono down">{s.summary?.maxDrawdownPct ?? '—'}%</td>
                        <td className="mono">{s.trades}</td>
                      </tr>
                    );
                  })}
                  {actual && (
                    <tr className="eval-row-actual">
                      <td className="eval-name">我的操作（实际执行）</td>
                      <td className="mono">¥{Math.round(actual.market).toLocaleString('zh-CN')}</td>
                      <td className="mono">¥{Math.round(actual.netInvested).toLocaleString('zh-CN')}</td>
                      <td className={`mono ${tone(actual.twrPct)}`}>{pct(actual.twrPct)}</td>
                      <td className="mono">
                        {baseline?.summary ? pct(actual.twrPct - baseline.summary.twrPct) : '—'}
                      </td>
                      <td className="mono down">{actual.maxDrawdownPct}%</td>
                      <td className="mono faint">—</td>
                    </tr>
                  )}
                  {data.simulations.filter((s) => s.isBaseline).map((s) => (
                    <tr key={s.source} className="eval-row-baseline">
                      <td className="eval-name">
                        {s.sourceLabel}
                        <span className="faint">（建议期内一分钱不动）</span>
                      </td>
                      <td className="mono">¥{Math.round(s.summary?.market || 0).toLocaleString('zh-CN')}</td>
                      <td className="mono">¥{Math.round(s.summary?.netInvested || 0).toLocaleString('zh-CN')}</td>
                      <td className={`mono ${tone(s.summary?.twrPct)}`}>{pct(s.summary?.twrPct)}</td>
                      <td className="mono">—</td>
                      <td className="mono down">{s.summary?.maxDrawdownPct ?? '—'}%</td>
                      <td className="mono">{s.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.simulations[0]?.points?.length ? (
                <SimulationChart
                  simulations={data.simulations}
                  actualPoints={data.actualPoints}
                  min={simCurves.min}
                  max={simCurves.max}
                />
              ) : null}

              <div className="eval-explain">
                这段窗口只有 {data.simulations[0]?.adviceDays || 0} 个建议日，
                这两条剧本的差距基本在噪声范围内。别拿这里的差距去改提示词——
                要看 AI 准不准，回到第 ① 层的逐条得分。
              </div>

              <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
                <h4 className="eval-sub" style={{ margin: 0 }}>逐日对照</h4>
                <label className="faint row" style={{ gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={onlyDeviations}
                    onChange={(e) => setOnlyDeviations(e.target.checked)}
                  />
                  只看我改主意/没动的
                </label>
              </div>
              <CompareTable rows={compareRows} />
            </>
          )}
        </div>
      )}

      <div className="eval-foot">
        <span className="faint">{data.syncNote}</span>
        {!data.isolation.feedbackAllowed && (
          <span className="faint"> · 当前不向模型回传评估结果</span>
        )}
      </div>
    </div>
  );
}

/** 仿真组合对比图：几条 TWR 曲线叠在一起，横轴共用 */
function SimulationChart({
  simulations, actualPoints, min, max,
}: {
  simulations: FundEvaluation['simulations'];
  actualPoints: FundEvaluation['actualPoints'];
  min: number;
  max: number;
}) {
  const width = 640;
  const height = 160;
  const pad = { l: 40, r: 12, t: 10, b: 18 };
  const points0 = simulations.find((s) => s.points.length > 0)?.points || simulations[0]?.points || [];
  const n = Math.max(...simulations.map((s) => s.points.length), 1);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
  const colors = ['#7F77DD', '#4C9F70', '#C2703A', '#8C8C8C'];
  const dates = points0;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1];
  // 真实组合与模拟曲线共用同一条净值时间轴（同一起点、同一批日期），
  // 所以直接按日期对上横轴索引，不用另算坐标
  const dateIndex = new Map(dates.map((p, i) => [p.date, i]));
  const actualPath = actualPoints
    .map((p) => {
      const i = dateIndex.get(p.date);
      return i == null ? null : `${x(i)},${y(p.twrPct)}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <div className="eval-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="模拟组合 TWR 对比">
        {[min + span * 0.25, min + span * 0.5, min + span * 0.75].map((v) => (
          <line key={v} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="eval-grid" />
        ))}
        {simulations.map((s, i) => (
          <polyline
            key={s.source}
            fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth={s.isBaseline ? 1.2 : 1.8}
            strokeDasharray={s.isBaseline ? '4 3' : undefined}
            points={s.points.map((p, j) => `${x(j)},${y(p.twrPct)}`).join(' ')}
          />
        ))}
        {actualPath ? (
          <polyline fill="none" stroke="#C2703A" strokeWidth={1.8} points={actualPath} />
        ) : null}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={height - 4} className="eval-axis" textAnchor={t === 0 ? 'start' : t === n - 1 ? 'end' : 'middle'}>
            {dates[t]?.date?.slice(5) || ''}
          </text>
        ))}
        <text x={2} y={y(max) + 4} className="eval-axis">{max.toFixed(1)}%</text>
        <text x={2} y={y(min)} className="eval-axis">{min.toFixed(1)}%</text>
      </svg>
      <div className="eval-legend">
        {simulations.map((s, i) => (
          <span key={s.source}>
            <i style={{ background: colors[i % colors.length] }} />
            {s.sourceLabel}
          </span>
        ))}
        {actualPath ? (
          <span>
            <i style={{ background: '#C2703A' }} />
            我的操作（实际）
          </span>
        ) : null}
      </div>
    </div>
  );
}
