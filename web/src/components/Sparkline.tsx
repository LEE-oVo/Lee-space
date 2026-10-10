interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  /** 固定纵轴上界，不给则按数据自适应 */
  max?: number;
}

const W = 320;
const PAD = 4;

export function Sparkline({ data, color = 'var(--c-accent)', height = 64, max }: SparklineProps) {
  const H = height;
  const points = data.length ? data : [0];
  const upper = max ?? Math.max(...points, 1);
  const lower = 0;
  const span = upper - lower || 1;

  const coords = points.map((v, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
    const y = H - PAD - ((Math.max(v, lower) - lower) / span) * (H - PAD * 2);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: H, display: 'block' }}
      role="img"
      aria-label="实时趋势"
    >
      <path d={area} fill={color} opacity={0.14} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
