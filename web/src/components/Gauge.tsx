interface GaugeProps {
  /** 0 - 100 */
  value: number;
  label: string;
  /** 环形中央的主文字，默认显示百分比 */
  center?: string;
  /** 环形下方的补充说明 */
  sub?: string;
  /** 未启用/无数据时置灰 */
  muted?: boolean;
}

const SIZE = 104;
const RADIUS = 44;
const CIRC = 2 * Math.PI * RADIUS;

function toneColor(pct: number): string {
  if (pct >= 88) return 'var(--c-danger)';
  if (pct >= 70) return 'var(--c-warning)';
  return 'var(--c-success)';
}

export function Gauge({ value, label, center, sub, muted }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const color = muted ? 'var(--c-text-faint)' : toneColor(pct);

  return (
    <div className="gauge">
      <div className="gauge-ring">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label} ${Math.round(pct)}%`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--c-border-strong)"
            strokeWidth={9}
            opacity={0.35}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ transition: 'stroke-dasharray 0.6s var(--ease), stroke 0.4s linear' }}
          />
        </svg>
        <div className="gauge-center">
          <div className="gauge-value" style={{ color: muted ? 'var(--c-text-faint)' : undefined }}>
            {center ?? `${Math.round(pct)}%`}
          </div>
          <div className="gauge-unit">{label}</div>
        </div>
      </div>
      <div className="gauge-sub">{sub || '—'}</div>
    </div>
  );
}
