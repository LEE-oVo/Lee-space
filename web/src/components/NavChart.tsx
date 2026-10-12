import { useId } from 'react';
import type { FundNavPoint } from '../types';

interface Props {
  points: FundNavPoint[];
  height?: number;
  /** 卡片里的迷你版：去掉坐标轴文字，只留趋势线 */
  compact?: boolean;
}

/**
 * 净值折线图：纯 SVG 手写，不引入图表库。
 * viewBox 固定宽度 + preserveAspectRatio=none 自适应容器，
 * 用 vector-effect=non-scaling-stroke 避免横向拉伸导致线宽变形。
 */
export function NavChart({ points, height, compact = false }: Props) {
  const gid = useId().replace(/:/g, '');

  if (!points || points.length < 2) {
    return (
      <div className={`nav-chart-empty${compact ? ' compact' : ''}`}>
        {compact ? '暂无走势数据' : '净值数据不足（需要至少 2 个交易日），随时间累积后会自动出现走势图'}
      </div>
    );
  }

  const W = 600;
  const H = height ?? (compact ? 74 : 190);
  const padL = compact ? 4 : 52;
  const padR = compact ? 4 : 14;
  const padT = compact ? 8 : 14;
  const padB = compact ? 8 : 26;

  const values = points.map((p) => p.nav);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max) * 0.01, 0.001);
  const lo = min - span * (compact ? 0.08 : 0.15);
  const hi = max + span * (compact ? 0.08 : 0.15);

  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.nav).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${padL},${(H - padB).toFixed(1)} Z`;

  const first = points[0].nav;
  const last = points[points.length - 1].nav;
  const rising = last >= first;
  const color = rising ? 'var(--c-danger)' : 'var(--c-success)';
  const changePct = first ? ((last - first) / first) * 100 : 0;

  const gridValues = compact ? [] : [hi, (hi + lo) / 2, lo];

  return (
    <div className={`nav-chart${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
          <span className="faint" style={{ fontSize: 12 }}>
            近 {points.length} 个交易日净值
          </span>
          <span style={{ fontSize: 12, fontWeight: 500 }} className={rising ? 'up' : 'down'}>
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H }}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={compact ? '0.26' : '0.22'} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--c-border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={padL - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--c-text-faint)"
              style={{ fontSize: 11 }}
            >
              {v.toFixed(4)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#g${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((p, i) => {
          const isLast = i === points.length - 1;
          if (compact && !isLast) return null;
          return (
            <circle key={p.date} cx={x(i)} cy={y(p.nav)} r={compact ? 3 : 2.6} fill={color}>
              <title>{`${p.date}  ${p.nav.toFixed(4)}`}</title>
            </circle>
          );
        })}

        {!compact && (
          <>
            <text x={padL} y={H - 8} fill="var(--c-text-faint)" style={{ fontSize: 11 }}>
              {points[0].date}
            </text>
            <text x={W - padR} y={H - 8} textAnchor="end" fill="var(--c-text-faint)" style={{ fontSize: 11 }}>
              {points[points.length - 1].date}
            </text>
          </>
        )}
      </svg>

      {compact && (
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
          <span className="faint">{points[0].date}</span>
          <span className={rising ? 'up' : 'down'}>
            {changePct >= 0 ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
          <span className="faint">{points[points.length - 1].date}</span>
        </div>
      )}
    </div>
  );
}
