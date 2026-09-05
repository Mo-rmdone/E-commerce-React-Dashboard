import { useMemo, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { curveMonotoneX, line } from 'd3-shape';
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

/**
 * Revenue as columns, profit as a line.
 *
 * Revenue is the volume booked in each period — a discrete amount, so a bar.
 * Profit is read as a trajectory, "which way is the bottom line heading", so a
 * line carries it better than a second bar would.
 *
 * The two sit on their own axes: revenue on the left, profit on the right.
 * That is the one place a second axis is honest — a line and a bar are never
 * mistaken for the same measure the way two bars would be, and each series
 * gets the full height of the plot rather than profit being squashed to a
 * sliver against revenue's scale. Both axes start at zero, so neither shape is
 * exaggerated.
 */

export type TrajectoryMetric = 'revenue' | 'profit';

const M = { top: 20, right: 52, bottom: 26, left: 54 };

export function TrajectoryChart({
  points,
  basis,
  height = 210,
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

  const geom = useMemo(() => {
    if (w < 120 || points.length === 0) return null;

    const iw = Math.max(20, w - M.left - M.right);
    const ih = Math.max(20, height - M.top - M.bottom);

    const band = scaleBand<string>()
      .domain(points.map((p) => p.key))
      .range([0, iw])
      .paddingInner(0.62)
      .paddingOuter(0.34);

    const rev = points.map((p) => revenue(p.measures, basis));
    const prof = points.map((p) => p.measures.profit);

    const hiRev = max(rev) ?? 1;
    const yRev = scaleLinear()
      .domain([0, hiRev === 0 ? 1 : hiRev * 1.08])
      .range([ih, 0])
      .nice(4);

    const loProf = Math.min(0, min(prof) ?? 0);
    const hiProf = max(prof) ?? 1;
    const yProf = scaleLinear()
      .domain([loProf, hiProf === 0 ? 1 : hiProf * 1.14])
      .range([ih, 0])
      .nice(4);

    const centre = (i: number) => (band(points[i].key) ?? 0) + band.bandwidth() / 2;

    const profLine =
      points.length > 1
        ? (line<number>()
            .x((_, i) => centre(i))
            .y((v) => yProf(v))
            .curve(curveMonotoneX)(prof) ?? '')
        : '';
    // Slimmer columns than before, capped so a filtered single period does not
    // become a slab.
    const barW = Math.min(band.bandwidth(), 34);

    return {
      iw,
      ih,
      band,
      barW,
      yRev,
      yProf,
      rev,
      prof,
      centre,
      profLine,
      revTicks: yRev.ticks(4),
      profTicks: yProf.ticks(4),
      xTicks: pickTicks(points, iw),
    };
  }, [w, height, points, basis]);

  if (points.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={LineChart}
          title="No periods in view"
          message="The current filter selects no order lines, so there is no trajectory to plot."
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
    const step = geom.band.step();
    const first = geom.band(points[0].key) ?? 0;
    const i = Math.max(
      0,
      Math.min(points.length - 1, Math.floor((mx - first + step * 0.5) / step)),
    );
    setFocus(i);
    show(tooltipFor(i), e);
  };

  const clear = () => {
    setFocus(null);
    hide();
  };

  // Default emphasis: the peak revenue period. At year grain that is the single
  // biggest year; at quarter or month grain it is the biggest bucket *within
  // each year*, so every year keeps a highlighted peak.
  const highlight = useMemo(() => {
    const set = new Set<number>();
    if (points.length === 0) return set;
    const revOf = (i: number) => revenue(points[i].measures, basis);
    const isYearGrain = points.every((p) => /^\d{4}$/.test(p.key));
    if (isYearGrain) {
      let best = -Infinity;
      let bi = 0;
      points.forEach((_p, i) => {
        const v = revOf(i);
        if (v > best) {
          best = v;
          bi = i;
        }
      });
      set.add(bi);
    } else {
      const bestByYear = new Map<string, number>();
      points.forEach((p, i) => {
        const y = p.key.slice(0, 4);
        const cur = bestByYear.get(y);
        if (cur === undefined || revOf(i) > revOf(cur)) bestByYear.set(y, i);
      });
      bestByYear.forEach((i) => set.add(i));
    }
    return set;
  }, [points, basis]);

  // When hovering, the hovered column is the emphasis; otherwise the peaks are.
  const emphasized = (i: number) => (focus !== null ? focus === i : highlight.has(i));
  const labelProfitAll = points.length <= 6;

  return (
    <div ref={ref} style={{ width: '100%', minHeight: height }}>
      {geom ? (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label="Revenue by period as columns, with profit as a line"
        >
          <defs>
            {/* Resting-state hatch for de-emphasised columns: the accent, but
                ghosted, so a hovered column reads as the solid one. */}
            <pattern
              id="traj-hatch"
              width={5}
              height={5}
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={5} height={5} fill="var(--c-surface)" />
              <line x1={0} y1={0} x2={0} y2={5} stroke="var(--c-accent)" strokeWidth={1.4} opacity={0.32} />
            </pattern>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {/* Grid keyed to the revenue axis when it's shown, else profit. */}
            {(showRevenue ? geom.revTicks : geom.profTicks).map((t) => {
              const y = showRevenue ? geom.yRev(t) : geom.yProf(t);
              return (
                <line
                  key={`g${t}`}
                  x1={0}
                  x2={geom.iw}
                  y1={y}
                  y2={y}
                  stroke="var(--c-grid)"
                  strokeWidth={1}
                />
              );
            })}

            {focus !== null ? (
              <rect
                x={geom.band(points[focus].key) ?? 0}
                y={0}
                width={geom.band.bandwidth()}
                height={geom.ih}
                fill="var(--c-accent-soft)"
                opacity={0.6}
                rx={4}
              />
            ) : null}

            {/* Revenue columns. The peak period(s) are solid; the rest are
                ghosted to a hatch — the emphasis holds in the default view, and
                a hover moves it to the hovered column. */}
            {showRevenue
              ? points.map((p, i) => {
                  const cx = geom.centre(i);
                  const y = geom.yRev(geom.rev[i]);
                  const h = Math.max(1, geom.ih - y);
                  const on = emphasized(i);
                  return (
                    <g key={`bar-${p.key}`}>
                      <rect
                        x={cx - geom.barW / 2}
                        y={y}
                        width={geom.barW}
                        height={h}
                        rx={Math.min(7, geom.barW / 2)}
                        fill={on ? 'var(--c-accent)' : 'url(#traj-hatch)'}
                        stroke={on ? 'none' : 'var(--c-accent-line)'}
                        strokeWidth={on ? 0 : 1}
                      />
                    </g>
                  );
                })
              : null}

            {/* Profit — a monotone line with dots. */}
            {showProfit && geom.profLine ? (
              <path
                d={geom.profLine}
                fill="none"
                stroke="var(--c-cat-2)"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {showProfit
              ? points.map((p, i) => {
                  const cx = geom.centre(i);
                  const cy = geom.yProf(geom.prof[i]);
                  const neg = geom.prof[i] < 0;
                  const on = emphasized(i);
                  // The label rides above the dot; drop it if that lands over
                  // the revenue column at this period.
                  const overBar = showRevenue && cy - 5 > geom.yRev(geom.rev[i]);
                  const showLabel = (labelProfitAll || on) && !overBar;
                  return (
                    <g key={`pp-${p.key}`}>
                      {showLabel ? (
                        <text
                          x={cx}
                          y={cy - 9}
                          textAnchor="middle"
                          className="chart-value-label"
                          fill="var(--c-cat-2)"
                        >
                          {usdShort(geom.prof[i])}
                        </text>
                      ) : null}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={on ? 4.5 : 3}
                        fill={neg ? 'var(--c-neg)' : 'var(--c-cat-2)'}
                        stroke="var(--c-surface)"
                        strokeWidth={on ? 2 : 1.5}
                      />
                    </g>
                  );
                })
              : null}

            {/* Left axis — revenue */}
            {showRevenue
              ? geom.revTicks.map((t) => (
                  <text
                    key={`ry${t}`}
                    x={-9}
                    y={geom.yRev(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="chart-axis-label"
                  >
                    {usdShort(t)}
                  </text>
                ))
              : null}

            {/* Right axis — profit */}
            {showProfit
              ? geom.profTicks.map((t) => (
                  <text
                    key={`py${t}`}
                    x={geom.iw + 9}
                    y={geom.yProf(t)}
                    dy="0.32em"
                    textAnchor="start"
                    className="chart-axis-label chart-axis-label--alt"
                  >
                    {usdShort(t)}
                  </text>
                ))
              : null}

            {geom.xTicks.map((i) => (
              <text
                key={`x${points[i].key}`}
                x={geom.centre(i)}
                y={geom.ih + 16}
                textAnchor="middle"
                className="chart-axis-label"
              >
                {points[i].label}
              </text>
            ))}

            <rect
              x={0}
              y={0}
              width={geom.iw}
              height={geom.ih}
              fill="transparent"
              onPointerMove={handleMove}
              onPointerLeave={clear}
              style={{ cursor: 'crosshair' }}
            />
          </g>
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

/** Thin x labels so they never collide at month grain. */
function pickTicks(points: TimePoint[], width: number): number[] {
  const maxTicks = Math.max(2, Math.floor(width / 62));
  if (points.length <= maxTicks) return points.map((_, i) => i);
  const step = Math.ceil(points.length / maxTicks);
  const out: number[] = [];
  for (let i = 0; i < points.length; i += step) out.push(i);
  if (out[out.length - 1] !== points.length - 1) out.push(points.length - 1);
  return out;
}
