import { useEffect, useMemo, useRef, useState } from 'react';
import type { FundEquity, FundEquityEvent, FundEquityPoint } from '../types';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function money(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = v >= 0 ? '+' : '−';
  return `${s}${money(Math.abs(v), digits)}`;
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
}

function weekdayOf(date: string) {
  const t = Date.parse(`${date}T00:00:00`);
  return Number.isFinite(t) ? WEEK[new Date(t).getDay()] : '';
}

function eventText(e: FundEquityEvent | undefined) {
  if (!e) return null;
  const parts: string[] = [];
  if (e.init > 0) parts.push(`建仓 ¥${money(e.init, 0)}`);
  if (e.add > 0) parts.push(`加仓 ¥${money(e.add, 0)}`);
  if (e.reduce > 0) parts.push(`减仓 ¥${money(e.reduce, 0)}`);
  return parts.length ? parts.join(' · ') : null;
}

interface Props {
  data: FundEquity;
}

/**
 * 组合收益曲线：所有基金合起来看「我这笔钱每天的收益怎么走」。
 *
 * 上面是累计收益曲线（可切收益率% / 金额），下面一排细柱是每天的盈亏，
 * 中间穿插建仓/加仓/减仓的事件点，鼠标移上去有当天的完整明细。
 *
 * 刻意多给一条 TWR（时间加权收益率，虚线）：加仓会摊薄「累计收益率」的分母，
 * 一路加仓时它显得很低，那不是亏了。想看真实的涨跌水平要看 TWR，
 * 最大回撤也是按它算的。
 *
 * 尺寸用真实像素（ResizeObserver 量宽度）而不是 SVG 缩放，
 * 否则 viewBox 拉伸会把坐标文字压变形。
 */
export function EquityChart({ data }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [mode, setMode] = useState<'pct' | 'amount'>('pct');
  const [showTwr, setShowTwr] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = data.points || [];
  const summary = data.summary;
  const eventMap = useMemo(() => {
    const m = new Map<string, FundEquityEvent>();
    for (const e of data.events || []) m.set(e.date, e);
    return m;
  }, [data.events]);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const W = width;
    const padL = 58;
    const padR = 18;
    const padT = 16;
    const mainH = 158;
    const gap = 10;
    const barH = 44;
    const padB = 34;
    const H = padT + mainH + gap + barH + padB;
    const barTop = padT + mainH + gap;
    const barMid = barTop + barH / 2;

    const values = points.map((p) => (mode === 'pct' ? p.returnPct : p.profit));
    const twrValues = showTwr ? points.map((p) => p.twrPct) : [];
    const pool = [...values, ...twrValues, 0];
    // 目标线也要在视野内，否则「离目标还有多远」看不出来
    if (mode === 'pct' && data.targetReturnPct > 0) pool.push(data.targetReturnPct);
    let min = Math.min(...pool);
    let max = Math.max(...pool);
    const span = max - min || Math.max(Math.abs(max) * 0.2, 1);
    const lo = min - span * 0.12;
    const hi = max + span * 0.12;

    const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
    const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * mainH;

    const maxAbsDaily = Math.max(...points.map((p) => Math.abs(p.dailyProfit)), 1);
    const barY = (v: number) => barMid - (v / maxAbsDaily) * (barH / 2 - 2);

    const path = (get: (p: FundEquityPoint) => number) =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');

    const line = path((p) => (mode === 'pct' ? p.returnPct : p.profit));
    const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + mainH).toFixed(1)} L${padL},${(padT + mainH).toFixed(1)} Z`;

    return {
      W, H, padL, padR, padT, mainH, barTop, barH, barMid, lo, hi, x, y, barY, line, area,
      twrLine: showTwr ? path((p) => p.twrPct) : null,
      ticks: [hi, (hi + lo) / 2, lo],
      // X 轴最多 6 个刻度，多了会挤在一起
      xTicks: Array.from({ length: Math.min(6, points.length) }, (_, k) =>
        Math.round((k / (Math.min(6, points.length) - 1)) * (points.length - 1))),
    };
  }, [points, mode, showTwr, width, data.targetReturnPct]);

  if (!geo) {
    return (
      <div className="equity-empty">
        收益曲线需要至少两个交易日的净值数据，结算几次之后这里就会自动出现
      </div>
    );
  }

  const last = points[points.length - 1];
  const rising = last.profit >= 0;
  const color = rising ? 'var(--c-danger)' : 'var(--c-success)';
  const cur = hover === null ? null : points[hover];
  const fmtY = (v: number) => (mode === 'pct' ? `${v.toFixed(2)}%` : `¥${money(v, 0)}`);
  const targetInRange = mode === 'pct' && data.targetReturnPct > 0
    && data.targetReturnPct <= geo.hi && data.targetReturnPct >= geo.lo;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - geo!.padL;
    const usable = geo!.W - geo!.padL - geo!.padR;
    const i = Math.round((px / usable) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    <div className="equity" ref={wrapRef}>
      <div className="equity-head">
        <div>
          <div className="equity-title">总投入收益曲线</div>
          <div className="equity-sub faint">
            {summary ? `${summary.from} ~ ${summary.to} · ${summary.days} 个交易日` : '按日汇总全部基金'}
            {' · '}
            口径与上方投资总览一致
          </div>
        </div>
        <div className="equity-tools">
          <button
            type="button"
            className={`equity-toggle${showTwr ? ' is-on' : ''}`}
            onClick={() => setShowTwr((v) => !v)}
            title="剔除加减仓现金流的影响，看「钱放着不动能涨多少」"
          >
            时间加权
          </button>
          <button
            type="button"
            className={`equity-toggle${mode === 'pct' ? ' is-on' : ''}`}
            onClick={() => setMode('pct')}
          >
            收益率
          </button>
          <button
            type="button"
            className={`equity-toggle${mode === 'amount' ? ' is-on' : ''}`}
            onClick={() => setMode('amount')}
          >
            金额
          </button>
        </div>
      </div>

      <div
        className="equity-plot"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg width={geo.W} height={geo.H} viewBox={`0 0 ${geo.W} ${geo.H}`}>
          <defs>
            <linearGradient id="eq-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 主图网格与 Y 轴 */}
          {geo.ticks.map((v) => (
            <g key={`t${v}`}>
              <line
                x1={geo.padL} x2={geo.W - geo.padR} y1={geo.y(v)} y2={geo.y(v)}
                stroke="var(--c-border)" strokeWidth="1" strokeDasharray={Math.abs(v) < 1e-9 ? '' : '3 3'}
              />
              <text x={geo.padL - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="middle"
                fill="var(--c-text-faint)" style={{ fontSize: 11 }}>
                {fmtY(v)}
              </text>
            </g>
          ))}

          {/* 零轴：盈亏分界，稍重一点 */}
          {0 >= geo.lo && 0 <= geo.hi && (
            <line
              x1={geo.padL} x2={geo.W - geo.padR} y1={geo.y(0)} y2={geo.y(0)}
              stroke="var(--c-border-strong)" strokeWidth="1"
            />
          )}

          {/* 目标收益率 */}
          {targetInRange && (
            <g>
              <line
                x1={geo.padL} x2={geo.W - geo.padR} y1={geo.y(data.targetReturnPct)} y2={geo.y(data.targetReturnPct)}
                stroke="var(--c-warning)" strokeWidth="1" strokeDasharray="6 4"
              />
              <text x={geo.W - geo.padR} y={geo.y(data.targetReturnPct) - 5} textAnchor="end"
                fill="var(--c-warning)" style={{ fontSize: 10 }}>
                目标 {data.targetReturnPct}%
              </text>
            </g>
          )}

          {/* 每日盈亏柱：正红负绿，零轴在中间 */}
          {points.map((p, i) => {
            const zero = geo.barY(0);
            const top = geo.barY(p.dailyProfit);
            const h = Math.max(1, Math.abs(top - zero));
            return (
              <rect
                key={`b${p.date}`}
                x={geo.x(i) - 1.6}
                y={Math.min(top, zero)}
                width={Math.max(2, (geo.W - geo.padL - geo.padR) / points.length - 1.4)}
                height={h}
                fill={p.dailyProfit >= 0 ? 'var(--c-danger)' : 'var(--c-success)'}
                opacity={hover === i ? 0.9 : 0.42}
              />
            );
          })}
          <line
            x1={geo.padL} x2={geo.W - geo.padR} y1={geo.barMid} y2={geo.barMid}
            stroke="var(--c-border)" strokeWidth="1"
          />
          <text x={geo.padL - 8} y={geo.barMid} textAnchor="end" dominantBaseline="middle"
            fill="var(--c-text-faint)" style={{ fontSize: 10 }}>
            日盈亏
          </text>

          {/* 曲线 */}
          <path d={geo.area} fill="url(#eq-area)" />
          <path
            d={geo.line} fill="none" stroke={color} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round"
          />
          {geo.twrLine && (
            <path
              d={geo.twrLine} fill="none" stroke="var(--c-accent)" strokeWidth="1.4"
              strokeDasharray="5 3" opacity="0.75"
            />
          )}

          {/* 操作事件：建仓/加仓/减仓 */}
          {points.map((p, i) => {
            const e = eventMap.get(p.date);
            if (!e) return null;
            return (
              <circle
                key={`e${p.date}`}
                cx={geo.x(i)}
                cy={geo.padT + geo.mainH - 4}
                r={3.4}
                fill={e.reduce > 0 ? 'var(--c-success)' : 'var(--c-accent)'}
                stroke="var(--c-surface)"
                strokeWidth="1"
              />
            );
          })}

          {/* 悬停指示 */}
          {hover !== null && (
            <g>
              <line
                x1={geo.x(hover)} x2={geo.x(hover)} y1={geo.padT} y2={geo.barTop + geo.barH}
                stroke="var(--c-border-strong)" strokeWidth="1"
              />
              <circle
                cx={geo.x(hover)}
                cy={geo.y(mode === 'pct' ? points[hover].returnPct : points[hover].profit)}
                r={4}
                fill={color}
                stroke="var(--c-surface)"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* X 轴日期 */}
          {geo.xTicks.map((i) => (
            <text
              key={`x${i}`}
              x={geo.x(i)}
              y={geo.H - 12}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fill="var(--c-text-faint)"
              style={{ fontSize: 11 }}
            >
              {points[i].date.slice(5)}
            </text>
          ))}
        </svg>

        {cur && (
          <div
            className="equity-tip"
            style={{
              left: geo.x(hover as number),
              transform: geo.x(hover as number) > geo.W * 0.58
                ? 'translateX(calc(-100% - 12px))'
                : 'translateX(12px)',
            }}
          >
            <div className="equity-tip-head">
              {cur.date} 周{weekdayOf(cur.date)}
            </div>
            <div className="equity-tip-row">
              <span>总市值</span><b>¥{money(cur.market)}</b>
            </div>
            <div className="equity-tip-row">
              <span>累计投入</span><b>¥{money(cur.netInvested)}</b>
            </div>
            <div className="equity-tip-row">
              <span>累计收益</span>
              <b className={cur.profit >= 0 ? 'up' : 'down'}>
                {signed(cur.profit)}（{pct(cur.returnPct)}）
              </b>
            </div>
            <div className="equity-tip-row">
              <span>当日盈亏</span>
              <b className={cur.dailyProfit >= 0 ? 'up' : 'down'}>{signed(cur.dailyProfit)}</b>
            </div>
            {showTwr && (
              <div className="equity-tip-row">
                <span>时间加权</span><b>{pct(cur.twrPct)}</b>
              </div>
            )}
            {eventText(eventMap.get(cur.date)) && (
              <div className="equity-tip-note">{eventText(eventMap.get(cur.date))}</div>
            )}
          </div>
        )}
      </div>

      <div className="equity-legend">
        <span><i className="dot" style={{ background: color }} />累计收益</span>
        {showTwr && <span><i className="dot dash" style={{ background: 'var(--c-accent)' }} />时间加权（剔除加减仓）</span>}
        <span><i className="dot" style={{ background: 'var(--c-accent)' }} />建仓 / 加仓</span>
        <span><i className="dot" style={{ background: 'var(--c-success)' }} />减仓</span>
      </div>

      {summary && (
        <div className="equity-stats">
          <Stat label="区间收益" value={signed(summary.profit)} sub={pct(summary.returnPct)} tone={summary.profit >= 0} />
          <Stat label="时间加权" value={pct(summary.twrPct)} sub="剔除加减仓影响" />
          <Stat
            label="最大回撤"
            value={`−${summary.maxDrawdownPct.toFixed(2)}%`}
            sub={summary.maxDrawdownAt ? `低点 ${summary.maxDrawdownAt.slice(5)}` : '—'}
            tone={false}
          />
          <Stat label="最好 / 最差" value={signed(summary.bestDay?.profit ?? 0, 0)} sub={`最差 ${signed(summary.worstDay?.profit ?? 0, 0)}`} tone={(summary.bestDay?.profit ?? 0) >= 0} />
          <Stat label="最高 / 最低" value={pct(summary.peakPct)} sub={`低 ${pct(summary.troughPct)}`} />
          <Stat label="涨跌天数" value={`${summary.upDays} 涨`} sub={`${summary.downDays} 跌`} />
          <Stat
            label="距目标"
            value={pct(summary.returnPct - data.targetReturnPct)}
            sub={`目标 ${data.targetReturnPct}%`}
            tone={summary.returnPct >= data.targetReturnPct}
          />
          <Stat label="当前市值" value={`¥${money(summary.market, 0)}`} sub={`投入 ¥${money(summary.netInvested, 0)}`} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: boolean }) {
  return (
    <div className="equity-stat">
      <span className="equity-stat-label">{label}</span>
      <span className={`equity-stat-value${tone === undefined ? '' : tone ? ' up' : ' down'}`}>{value}</span>
      {sub ? <span className="equity-stat-sub faint">{sub}</span> : null}
    </div>
  );
}
