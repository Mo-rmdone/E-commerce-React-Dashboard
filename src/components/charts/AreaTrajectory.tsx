import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { max, min } from 'd3-array';
import type { TimePoint } from '@/data/metrics/timeseries';
import { BUSINESS_TARGETS, type RevenueBasis } from '@/config/targets';
import { revenue } from '@/data/metrics/breakdowns';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { LineChart } from 'lucide-react';
import { pct, pctSigned, usd, usdShort } from '@/utils/format';
import type { TrajectoryMetric } from './TrajectoryChart';

/**
 * A soft area-line chart: revenue and profit as smooth, filled trend lines on
 * their own axes, with margin available as a dotted overlay. A hover guide picks
 * a period, marking each line and reading the value and its year-over-year
 * change into the tooltip — the amounts read as trajectories, not columns.
 */

const M = { top: 18, right: 52, bottom: 26, left: 56 };

export function AreaTrajectory({
  points,
  basis,
  height = 240,
  visible,
}: {
  points: TimePoint[];
  basis: RevenueBasis;
  height?: number;
  visible: Set<TrajectoryMetric>;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [focus, setFocus] = useState<number | null>(null);

  const w = size.width;
  const showRevenue = visible.has('revenue');
  const showProfit = visible.has('profit');
  const showMargin = visible.has('margin');

  const geom = useMemo(() => {
    if (w < 120 || points.length === 0) return null;

    const iw = Math.max(20, w - M.left - M.right);
    const ih = Math.max(20, height - M.top - M.bottom);
    const n = points.length;
    const xAt = (i: number) => (n === 1 ? iw / 2 : (i / (n - 1)) * iw);

    const rev = points.map((p) => revenue(p.measures, basis));
    const prof = points.map((p) => p.measures.profit);
    const marg = points.map((p) => p.measures.grossMargin ?? 0);

    const yRev = scaleLinear().domain([0, (max(rev) || 1) * 1.1]).range([ih, 0]).nice(4);
    const yProf = scaleLinear()
      .domain([Math.min(0, min(prof) ?? 0), (max(prof) || 1) * 1.18])
      .range([ih, 0])
      .nice(4);
    const yMargin = scaleLinear().domain([0, (max(marg) || 0.15) * 1.25]).range([ih, 0]);

    const mkLine = (vals: number[], y: (v: number) => number) =>
      n > 1 ? line<number>().x((_, i) => xAt(i)).y((v) => y(v)).curve(curveMonotoneX)(vals) ?? '' : '';
    const mkArea = (vals: number[], y: (v: number) => number) =>
      n > 1
        ? area<number>().x((_, i) => xAt(i)).y0(ih).y1((v) => y(v)).curve(curveMonotoneX)(vals) ?? ''
        : '';

    return {
      iw, ih, xAt, rev, prof, marg, yRev, yProf, yMargin,
      revLine: mkLine(rev, yRev),
      revArea: mkArea(rev, yRev),
      profLine: mkLine(prof, yProf),
      profArea: mkArea(prof, yProf),
      marginLine: mkLine(marg, yMargin),
      revTicks: yRev.ticks(4),
      profTicks: yProf.ticks(4),
      marginTicks: yMargin.ticks(4),
      xTicks: pickTicks(points, iw),
    };
  }, [w, height, points, basis]);

  if (points.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={LineChart}
          title="No periods in view"
          message="The current filter selects no order lines, so there is nothing to plot."
        />
      </div>
    );
  }

  const tooltipFor = (i: number) => {
    const p = points[i];
    return {
      title: p.label,
      subtitle: `${p.measures.lines.toLocaleString()} order lines`,
      rows: [
        { label: 'Revenue', value: usd(revenue(p.measures, basis)), strong: true },
        { label: 'Profit', value: usd(p.measures.profit) },
        { label: 'Margin', value: pct(p.measures.grossMargin) },
        {
          label: 'YoY growth',
          value: p.yoy === null ? 'no prior period' : pctSigned(p.yoy),
          tone:
            p.yoy === null
              ? ('muted' as const)
              : p.yoy >= BUSINESS_TARGETS.revenueGrowth
                ? ('pos' as const)
                : ('neg' as const),
        },
      ],
    };
  };

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const n = points.length;
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((mx / geom.iw) * (n - 1))));
    setFocus(i);
    show(tooltipFor(i), e);
  };
  const clear = () => {
    setFocus(null);
    hide();
  };

  return (
    <div ref={ref} style={{ width: '100%', minHeight: height }}>
      {geom ? (
        <svg width={w} height={height} role="img" aria-label="Revenue and profit as area trend lines">
          <defs>
            <linearGradient id="area-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="area-prof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-cat-2)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--c-cat-2)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <g transform={`translate(${M.left},${M.top})`}>
            {/* grid + left revenue axis */}
            {geom.revTicks.map((t) => (
              <g key={`g${t}`}>
                <line x1={0} x2={geom.iw} y1={geom.yRev(t)} y2={geom.yRev(t)} stroke="var(--c-grid)" />
                {showRevenue ? (
                  <text x={-10} y={geom.yRev(t)} dy="0.32em" textAnchor="end" className="chart-axis-label">
                    {usdShort(t)}
                  </text>
                ) : null}
              </g>
            ))}
            {/* right profit ($) or margin (%) axis */}
            {showProfit
              ? geom.profTicks.map((t) => (
                  <text key={`rp${t}`} x={geom.iw + 10} y={geom.yProf(t)} dy="0.32em" textAnchor="start" className="chart-axis-label chart-axis-label--alt">
                    {usdShort(t)}
                  </text>
                ))
              : showMargin
                ? geom.marginTicks.map((t) => (
                    <text key={`rm${t}`} x={geom.iw + 10} y={geom.yMargin(t)} dy="0.32em" textAnchor="start" className="chart-axis-label" fill="var(--c-reference)">
                      {pct(t, 0)}
                    </text>
                  ))
                : null}

            {/* areas (draw first so lines sit on top) */}
            {showProfit && geom.profArea ? <path d={geom.profArea} fill="url(#area-prof)" /> : null}
            {showRevenue && geom.revArea ? <path d={geom.revArea} fill="url(#area-rev)" /> : null}

            {/* hover guide */}
            {focus !== null ? (
              <line
                x1={geom.xAt(focus)}
                x2={geom.xAt(focus)}
                y1={0}
                y2={geom.ih}
                stroke="var(--c-accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.6}
              />
            ) : null}

            {/* margin dotted line */}
            {showMargin && geom.marginLine ? (
              <path d={geom.marginLine} fill="none" stroke="var(--c-reference)" strokeWidth={1.75} strokeDasharray="2 4" strokeLinecap="round" />
            ) : null}

            {/* profit line */}
            {showProfit && geom.profLine ? (
              <path d={geom.profLine} fill="none" stroke="var(--c-cat-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}

            {/* revenue line (primary) */}
            {showRevenue && geom.revLine ? (
              <path d={geom.revLine} fill="none" stroke="var(--c-accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}

            {/* hover markers */}
            {focus !== null ? (
              <>
                {showMargin ? <Dot cx={geom.xAt(focus)} cy={geom.yMargin(geom.marg[focus])} color="var(--c-reference)" /> : null}
                {showProfit ? <Dot cx={geom.xAt(focus)} cy={geom.yProf(geom.prof[focus])} color="var(--c-cat-2)" /> : null}
                {showRevenue ? <Dot cx={geom.xAt(focus)} cy={geom.yRev(geom.rev[focus])} color="var(--c-accent)" /> : null}
              </>
            ) : null}

            {/* x labels */}
            {geom.xTicks.map((i) => (
              <text key={`x${points[i].key}`} x={geom.xAt(i)} y={geom.ih + 18} textAnchor="middle" className="chart-axis-label">
                {points[i].label}
              </text>
            ))}

            <rect x={0} y={0} width={geom.iw} height={geom.ih} fill="transparent" onPointerMove={handleMove} onPointerLeave={clear} style={{ cursor: 'crosshair' }} />
          </g>
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function Dot({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return <circle cx={cx} cy={cy} r={4.5} fill="var(--c-surface)" stroke={color} strokeWidth={2.5} />;
}

function pickTicks(points: TimePoint[], width: number): number[] {
  const maxTicks = Math.max(2, Math.floor(width / 62));
  if (points.length <= maxTicks) return points.map((_, i) => i);
  const step = Math.ceil(points.length / maxTicks);
  const out: number[] = [];
  for (let i = 0; i < points.length; i += step) out.push(i);
  if (out[out.length - 1] !== points.length - 1) out.push(points.length - 1);
  return out;
}
