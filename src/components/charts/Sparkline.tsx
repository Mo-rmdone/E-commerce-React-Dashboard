import { useMemo } from 'react';
import { line, curveMonotoneX, area } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { extent } from 'd3-array';

/**
 * Trend shape for KPI cards. Deliberately axis-free: it answers "which way,
 * and how steadily" — the exact values live in the KPI beside it.
 */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  tone = 'accent',
  showEnd = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'accent' | 'pos' | 'neg' | 'muted';
  showEnd?: boolean;
}) {
  const geom = useMemo(() => {
    const clean = values.filter((v) => Number.isFinite(v));
    if (clean.length < 2) return null;

    const [lo = 0, hi = 1] = extent(clean) as [number, number];
    const pad = (hi - lo) * 0.14 || Math.abs(hi) * 0.1 || 1;
    const x = scaleLinear().domain([0, clean.length - 1]).range([1.5, width - 1.5]);
    const y = scaleLinear().domain([lo - pad, hi + pad]).range([height - 2, 2]);

    const l = line<number>()
      .x((_, i) => x(i))
      .y((v) => y(v))
      .curve(curveMonotoneX);
    const a = area<number>()
      .x((_, i) => x(i))
      .y0(height)
      .y1((v) => y(v))
      .curve(curveMonotoneX);

    return {
      path: l(clean) ?? '',
      areaPath: a(clean) ?? '',
      endX: x(clean.length - 1),
      endY: y(clean[clean.length - 1]),
    };
  }, [values, width, height]);

  if (!geom) return <div style={{ width, height }} aria-hidden />;

  const stroke = `var(--c-${tone === 'accent' ? 'accent' : tone})`;
  const id = `spark-${tone}`;

  return (
    <svg width={width} height={height} aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geom.areaPath} fill={`url(#${id})`} />
      <path
        d={geom.path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEnd ? <circle cx={geom.endX} cy={geom.endY} r={2} fill={stroke} /> : null}
    </svg>
  );
}
