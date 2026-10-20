/**
 * 决策复盘面板：把「模型判断得准不准」和「我挑得准不准」分成三层摆出来。
 *
 * 三层为什么不能合成一个分数——它们的因果链完全不同：
 *   ① 模型成绩单：模型 vs 行情。纯预测能力，模型自己能改的部分。
 *   ② 模拟组合：某家的建议照单全收会怎样。含资金约束、含加减仓密度，
 *      跟模型「猜得准不准」不是一回事，不能拿来给模型打分。
 *   ③ 挑选增值：同一天同一只基金，我选的那条比没选的那条好多少。这是我的功劳/我的锅。
 * ① 得出的结论能回头改提示词；②③ 只能用来调整「采纳策略」，绝不能回流给模型。
 *
 * 这个组件的数据全部来自 /funds/evaluation，且要求 fund:detail + 已登录，
 * 游客和非特权角色拿不到任何一块。
 */

import { useMemo, useState } from 'react';
import type {
  EvalDecision, EvalGroup, EvalRow, EvalStat, EvalUndecided, FundEvaluation,
} from '../types';

type Tab = 'scorecard' | 'simulation' | 'picks';

const ACTION_LABEL: Record<string, string> = {
  buy: '买入', add: '加仓', hold: '持有', reduce: '减仓', sell: '卖出',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高', medium: '中', low: '低', unset: '未标',
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
          <th title="这条模型建议的数量">建议数</th>
          <th title="机会成本口径：加仓=基金涨幅，持有=0，减仓=跌幅">平均前瞻</th>
          <th title="这个模型建议赚钱的比例">胜率</th>
          <th title="得分波动：越小说明这家模型稳定性越好">波动</th>
          <th title="只统计真正下单的建议，hold 不参与">押注数</th>
          <th title="押方向押对了的数量">押中</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={`${groupLabel}-${g.key}`}>
            <td className="eval-name">
              {g.sourceLabel || g.name || g.confidence || g.code || g.key}
              {g.code && g.sourceLabel ? <span className="faint"> {g.code}</span> : null}
              {g.confidence && !g.sourceLabel ? <span className="faint"> {CONFIDENCE_LABEL[g.confidence] || g.confidence}</span> : null}
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
          <th>来源</th>
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
            <td className="faint">{r.sourceLabel}</td>
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

function DecisionList({ decisions }: { decisions: EvalDecision[] }) {
  return (
    <div className="eval-decisions">
      {decisions.map((d) => (
        <div className={`eval-decision${d.wasBest ? ' is-best' : ''}`} key={`${d.code}-${d.tradeDate}`}>
          <div className="eval-decision-head">
            <span className="mono faint">{d.tradeDate.slice(5)}</span>
            <span className="eval-name">{d.name}</span>
            <span className="faint">基金 {pct(d.fundFwdPct)}（{d.windowLabel}）</span>
            <span className={`eval-rank${d.rank === 1 ? ' is-top' : ''}`}>{d.rank}/{d.participants}</span>
          </div>
          <div className="eval-decision-body">
            <div className="eval-pick">
              <span className="eval-pick-label">挑了</span>
              <span className="eval-pick-src">{d.chosen.sourceLabel}</span>
              <span className="act-buy">{ACTION_LABEL[d.chosen.action] || d.chosen.action}</span>
              {d.chosen.amount ? <span className="mono faint">¥{d.chosen.amount}</span> : null}
              <span className={`mono ${tone(d.chosen.scorePct)}`}>{pct(d.chosen.scorePct)}</span>
            </div>
            <div className="eval-picks-rejected">
              {d.rejected.map((r) => (
                <div className="eval-pick" key={r.source}>
                  <span className="eval-pick-label">没挑</span>
                  <span className="eval-pick-src">{r.sourceLabel}</span>
                  <span className={`act-${r.action === 'hold' ? 'hold' : 'buy'}`}>{ACTION_LABEL[r.action] || r.action}</span>
                  {r.amount ? <span className="mono faint">¥{r.amount}</span> : null}
                  <span className={`mono ${tone(r.scorePct)}`}>{pct(r.scorePct)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="eval-decision-foot">
            挑增
            <b className={`mono ${tone(d.pickValuePct)}`}>{pct(d.pickValuePct)}</b>
            <span className="faint"> · 折钱</span>
            <b className={`mono ${tone(d.pickValueYuan)}`}>{yuan(d.pickValueYuan)}</b>
            {d.wasBest ? <span className="eval-badge good">选中最优</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function UndecidedList({ items }: { items: EvalUndecided[] }) {
  return (
    <table className="eval-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>基金</th>
          <th title="这段窗口内基金自己的涨跌">基金涨跌</th>
          <th>各家怎么说（没人执行）</th>
        </tr>
      </thead>
      <tbody>
        {items.map((u) => (
          <tr key={`${u.code}-${u.tradeDate}`}>
            <td className="mono faint">{u.tradeDate.slice(5)}</td>
            <td className="eval-name">{u.name}</td>
            <td className={`mono ${tone(u.fundFwdPct)}`}>{pct(u.fundFwdPct)}</td>
            <td className="faint">
              {u.candidates
                .map((c) => `${c.sourceLabel} ${ACTION_LABEL[c.action] || c.action}${c.amount ? ` ¥${c.amount}` : ''}`)
                .join(' / ')}
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
  const card = data.scorecard;
  const picks = data.picks;
  const w = card.windows[windowKey] || card.windows[data.primary];

  const baseline = data.simulations.find((s) => s.isBaseline);
  const actual = data.actualSummary;

  // 仿真曲线按下限/上限做公共坐标，几条线画在一起才比得出高低
  const simCurves = useMemo(() => {
    const all = data.simulations.flatMap((s) => s.points.map((p) => p.twrPct));
    if (!all.length) return { min: 0, max: 0 };
    return { min: Math.min(...all), max: Math.max(...all) };
  }, [data.simulations]);

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
            ① 模型成绩单
          </button>
          <button className={`eval-tab${tab === 'simulation' ? ' is-on' : ''}`} onClick={() => setTab('simulation')}>
            ② 模拟组合
          </button>
          <button className={`eval-tab${tab === 'picks' ? ' is-on' : ''}`} onClick={() => setTab('picks')}>
            ③ 挑选增值
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

      {tab === 'scorecard' && (
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

          <h4 className="eval-sub">按来源</h4>
          <StatTable rows={card.bySource} groupLabel="来源" minSamples={data.minSamples} />
          <h4 className="eval-sub">按基金</h4>
          <StatTable rows={card.byFund} groupLabel="基金" minSamples={data.minSamples} />
          <h4 className="eval-sub">按置信度</h4>
          <StatTable rows={card.byConfidence} groupLabel="置信度" minSamples={data.minSamples} />
          {card.bySourceFund.length > 0 && w && card.bySourceFund[0].opportunity.count > 0 && (
            <>
              <h4 className="eval-sub">来源 × 基金</h4>
              <StatTable rows={card.bySourceFund} groupLabel="组合" minSamples={data.minSamples} />
            </>
          )}

          <h4 className="eval-sub">逐条明细</h4>
          <RowList rows={card.rows} windowKey={windowKey} />
        </div>
      )}

      {tab === 'simulation' && (
        <div className="eval-body">
          <div className="eval-explain">
            每条曲线都从同一份「建议期之前就有的老仓位」出发，只在建议期之后按各自的剧本走。
            差异只来自「听谁的」，不掺混底仓贵贱的影响。完全不操作那条基线用来回答：
            这段时间择时到底挣了钱，还是把钱放出来反而更好。
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
              {actual && (
                <tr className="eval-row-actual">
                  <td className="eval-name">真实组合（实际执行）</td>
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
              {data.simulations.map((s) => {
                const vs = data.vsBaseline[s.source];
                return (
                  <tr key={s.source} className={s.isBaseline ? 'eval-row-baseline' : ''}>
                    <td className="eval-name">
                      {s.sourceLabel}
                      {s.isBaseline ? <span className="faint">（建议期内一分钱不动）</span> : null}
                    </td>
                    <td className="mono">¥{Math.round(s.summary?.market || 0).toLocaleString('zh-CN')}</td>
                    <td className="mono">¥{Math.round(s.summary?.netInvested || 0).toLocaleString('zh-CN')}</td>
                    <td className={`mono ${tone(s.summary?.twrPct)}`}>{pct(s.summary?.twrPct)}</td>
                    <td className={`mono ${tone(vs?.twrVsBaselinePct)}`}>
                      {s.isBaseline ? '—' : pct(vs?.twrVsBaselinePct)}
                    </td>
                    <td className="mono down">{s.summary?.maxDrawdownPct ?? '—'}%</td>
                    <td className="mono">{s.trades}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data.simulations[0]?.points?.length ? (
            <SimulationChart
              simulations={data.simulations}
              min={simCurves.min}
              max={simCurves.max}
            />
          ) : null}

          <div className="eval-explain">
            这段窗口只有 {data.simulations[0]?.adviceDays || 0} 个建议日，几家的差距基本在噪声范围内。
            别拿这里的排名去改提示词——要看模型准不准，回到第 ① 层的逐条得分。
          </div>
        </div>
      )}

      {tab === 'picks' && (
        <div className="eval-body">
          <div className="eval-explain">
            同一天、同一只基金，几个工具意见不一致时，挑的那条为什么会挑（得到的结果 vs 没挑的结果）。
            基金本身的涨跌在这里被约掉了，剩下的纯粹是「挑得好不好」。
            <b>这一层永远不回传给模型</b>——如果模型知道自己被人打分排名，它就会照着排行榜改答案。
          </div>

          <div className="eval-summary">
            <div className="eval-metric">
              <span className="eval-metric-label">有分歧的决策</span>
              <b className="mono">{picks.count}</b>
              <span className="faint">未操作 {picks.undecided.length}</span>
            </div>
            <div className="eval-metric">
              <span className="eval-metric-label">选中最优率</span>
              <b className="mono">{picks.bestRate === null ? '—' : `${picks.bestRate}%`}</b>
              <span className="faint">平均排名靠前程度</span>
            </div>
            <div className="eval-metric">
              <span className="eval-metric-label">平均挑增（每元）</span>
              <b className={`mono ${tone(picks.avgPickValuePct)}`}>{pct(picks.avgPickValuePct)}</b>
              <span className="faint">赢 {picks.positive} / 输 {picks.negative}</span>
            </div>
            <div className="eval-metric">
              <span className="eval-metric-label">折合金额</span>
              <b className={`mono ${tone(picks.totalPickValueYuan)}`}>{yuan(picks.totalPickValueYuan)}</b>
              <span className="faint">按各自建议金额算</span>
            </div>
          </div>

          {picks.insufficient && (
            <div className="eval-warn">
              只有 {picks.count} 条可评决策（门槛 {picks.minSamples} 条）。
              现在这个数大概率是运气，攒到十几条再看。
            </div>
          )}

          {picks.bySource.length > 0 && (
            <>
              <h4 className="eval-sub">被采纳时带来的挑增</h4>
              <table className="eval-table">
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>被采纳次数</th>
                    <th>其中是最优</th>
                    <th>平均挑增</th>
                    <th>折合金额</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.bySource.map((s) => (
                    <tr key={s.source}>
                      <td className="eval-name">{s.sourceLabel}</td>
                      <td className="mono">{s.chosen}</td>
                      <td className="mono">{s.bestCount}/{s.chosen}</td>
                      <td className={`mono ${tone(s.avgPickValuePct)}`}>{pct(s.avgPickValuePct)}</td>
                      <td className={`mono ${tone(s.totalPickValueYuan)}`}>{yuan(s.totalPickValueYuan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h4 className="eval-sub">逐日决策</h4>
          {picks.decisions.length ? (
            <DecisionList decisions={picks.decisions} />
          ) : (
            <div className="eval-empty">还没有「多家意见不一致 + 采纳了其中一条」的记录。</div>
          )}

          {picks.undecided.length > 0 && (
            <>
              <h4 className="eval-sub">有分歧但没动</h4>
              <UndecidedList items={picks.undecided} />
            </>
          )}
        </div>
      )}

      <div className="eval-foot">
        <span className="faint">{data.syncNote}</span>
        {!data.isolation.feedbackAllowed && (
          <span className="faint"> · 当前不向模型回传评估结果（样本还不够，且 ②③ 永久隔离）</span>
        )}
      </div>
    </div>
  );
}

/** 仿真组合对比图：几条 TWR 曲线叠在一起，横轴共用 */
function SimulationChart({
  simulations, min, max,
}: { simulations: FundEvaluation['simulations']; min: number; max: number }) {
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
      </div>
    </div>
  );
}
