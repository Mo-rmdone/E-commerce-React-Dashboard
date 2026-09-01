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
 * Revenue and profit as grouped bars, growth as a line.
 *
 * The mark follows what each measure is. Revenue and profit are amounts booked
 * *within* a period, so they get bars — discrete, sitting on a shared zero,
 * comparable side by side. Growth is a rate measured *between* periods, so it
 * gets a line, the only mark that says "this one continues from the last".
 *
 * The two money series share a single axis rather than getting one each. A
 * second axis would let profit's bar rise as high as revenue's, which is
 * precisely the comparison this card exists to keep honest.
 */

export type TrajectoryMetric = 'revenue' | 'profit' | 'growth';

const M = { top: 18, right: 46, bottom: 26, left: 54 };

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
  const showGrowth = visible.has('growth');

  const geom = useMemo(() => {
    if (w < 120 || points.length === 0) return null;

    const iw = Math.max(20, w - M.left - M.right);
    const ih = Math.max(20, height - M.top - M.bottom);

    const band = scaleBand<string>()
      .domain(points.map((p) => p.key))
      .range([0, iw])
      .paddingInner(0.34)
      .paddingOuter(0.18);

    // Whichever money series are switched on split the band between them.
    const moneySeries: TrajectoryMetric[] = [];
    if (showRevenue) moneySeries.push('revenue');
    if (showProfit) moneySeries.push('profit');

    const inner = scaleBand<string>()
      .domain(moneySeries)
      .range([0, band.bandwidth()])
      .padding(0.16);

    const rev = points.map((p) => revenue(p.measures, basis));
    const prof = points.map((p) => p.measures.profit);

    const shown: number[] = [];
    if (showRevenue) shown.push(...rev);
    if (showProfit) shown.push(...prof);

    const lo = Math.min(0, min(shown) ?? 0);
    const hi = max(shown) ?? 1;
    const yMoney = scaleLinear()
      .domain([lo, hi === 0 ? 1 : hi * 1.06])
      .range([ih, 0])
      .nice(4);

    const growths = points.map((p) => p.yoy).filter((g): g is number => g !== null);
    const gLo = Math.min(0, ...growths, BUSINESS_TARGETS.revenueGrowth);
    const gHi = Math.max(...growths, BUSINESS_TARGETS.revenueGrowth, 0.05);
    // Deliberately not nice()d: rounding a 0–26% range to "nice" bounds pushed
    // the axis out to −20%..40% and spent half the plot on empty space.
    const pad = (gHi - gLo) * 0.12 || 0.04;
    const yGrowth = scaleLinear()
      .domain([gLo - (gLo < 0 ? pad : 0), gHi + pad])
      .range([ih, 0]);

    const centre = (i: number) => (band(points[i].key) ?? 0) + band.bandwidth() / 2;

    // The line spans only periods that have a prior period to compare against,
    // so it starts where the comparison starts rather than at an invented zero.
    const growthPts = points
      .map((p, i) => ({ i, yoy: p.yoy }))
      .filter((d): d is { i: number; yoy: number } => d.yoy !== null);

    const growthLine =
      growthPts.length > 1
        ? (line<{ i: number; yoy: number }>()
            .x((d) => centre(d.i))
            .y((d) => yGrowth(d.yoy))
            .curve(curveMonotoneX)(growthPts) ?? '')
        : '';

    return {
      iw,
      ih,
      band,
      inner,
      yMoney,
      yGrowth,
      rev,
      prof,
      centre,
      growthPts,
      growthLine,
      moneyTicks: yMoney.ticks(4),
      growthTicks: yGrowth.ticks(4),
      xTicks: pickTicks(points, iw),
      hasMoney: moneySeries.length > 0,
    };
  }, [w, height, points, basis, showRevenue, showProfit]);

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
        {
          label: 'Revenue',
          value: usd(revenue(p.measures, basis)),
          strong: true,
        },
        { label: 'Profit', value: usd(p.measures.profit) },
        {
          label: 'Margin',
          value: pct(p.measures.grossMargin),
        },
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
      status:
        p.yoy === null
          ? undefined
          : {
              level:
                p.yoy >= BUSINESS_TARGETS.revenueGrowth
                  ? ('on-target' as const)
                  : ('off-target' as const),
              label:
                p.yoy >= BUSINESS_TARGETS.revenueGrowth
                  ? `Clears the ${pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target`
                  : `${pct(BUSINESS_TARGETS.revenueGrowth - p.yoy)} short of target`,
            },
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

  return (
    <div ref={ref} style={{ width: '100%', minHeight: height }}>
      {geom ? (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label="Revenue and profit by period, with year-over-year growth"
        >
          <g transform={`translate(${M.left},${M.top})`}>
            {/* Grid follows whichever axis is carrying marks. */}
            {(geom.hasMoney ? geom.moneyTicks : geom.growthTicks).map((t) => {
              const y = geom.hasMoney ? geom.yMoney(t) : geom.yGrowth(t);
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
                fill="var(--c-surface-3)"
                opacity={0.75}
                rx={3}
              />
            ) : null}

            {/* Zero rule, drawn only when a bar can fall below it. */}
            {geom.hasMoney && geom.yMoney.domain()[0] < 0 ? (
              <line
                x1={0}
                x2={geom.iw}
                y1={geom.yMoney(0)}
                y2={geom.yMoney(0)}
                stroke="var(--c-axis)"
                strokeWidth={1}
              />
            ) : null}

            {points.map((p, i) => {
              const bx = geom.band(p.key) ?? 0;
              const zero = geom.yMoney(0);
              const dim = focus !== null && focus !== i;
              return (
                <g key={`bars-${p.key}`} opacity={dim ? 0.55 : 1}>
                  {showRevenue ? (
                    <rect
                      x={bx + (geom.inner('revenue') ?? 0)}
                      y={Math.min(geom.yMoney(geom.rev[i]), zero)}
                      width={geom.inner.bandwidth()}
                      height={Math.max(1, Math.abs(zero - geom.yMoney(geom.rev[i])))}
                      rx={2}
                      fill="var(--c-accent)"
                    />
                  ) : null}
                  {showProfit ? (
                    <rect
                      x={bx + (geom.inner('profit') ?? 0)}
                      y={Math.min(geom.yMoney(geom.prof[i]), zero)}
                      width={geom.inner.bandwidth()}
                      height={Math.max(1, Math.abs(zero - geom.yMoney(geom.prof[i])))}
                      rx={2}
                      fill={geom.prof[i] < 0 ? 'var(--c-neg)' : 'var(--c-cat-2)'}
                    />
                  ) : null}
                </g>
              );
            })}

            {showGrowth ? (
              <>
                {/* A reference, not a series: the faintest grey in the system,
                    with its label parked at the left margin so it never sits on
                    top of the bars or the growth line. */}
                <line
                  x1={0}
                  x2={geom.iw}
                  y1={geom.yGrowth(BUSINESS_TARGETS.revenueGrowth)}
                  y2={geom.yGrowth(BUSINESS_TARGETS.revenueGrowth)}
                  stroke="var(--c-reference-soft)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={2}
                  y={geom.yGrowth(BUSINESS_TARGETS.revenueGrowth) - 6}
                  textAnchor="start"
                  className="chart-ref-label chart-ref-label--quiet"
                >
                  {pct(BUSINESS_TARGETS.revenueGrowth, 0)} target
                </text>
              </>
            ) : null}

            {/* The rate that connects periods. */}
            {showGrowth && geom.growthLine ? (
              <path
                d={geom.growthLine}
                fill="none"
                stroke="var(--c-ink-2)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {showGrowth
              ? geom.growthPts.map((d) => (
                  <circle
                    key={`gp-${points[d.i].key}`}
                    cx={geom.centre(d.i)}
                    cy={geom.yGrowth(d.yoy)}
                    r={focus === d.i ? 5 : 3.5}
                    fill={d.yoy >= BUSINESS_TARGETS.revenueGrowth ? 'var(--c-pos)' : 'var(--c-neg)'}
                    stroke="var(--c-surface)"
                    strokeWidth={1.75}
                  />
                ))
              : null}

            {geom.hasMoney
              ? geom.moneyTicks.map((t) => (
                  <text
                    key={`my${t}`}
                    x={-9}
                    y={geom.yMoney(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="chart-axis-label"
                  >
                    {usdShort(t)}
                  </text>
                ))
              : null}
            {showGrowth
              ? geom.growthTicks.map((t) => (
                  <text
                    key={`gy${t}`}
                    x={geom.iw + 9}
                    y={geom.yGrowth(t)}
                    dy="0.32em"
                    textAnchor="start"
                    className="chart-axis-label chart-axis-label--alt"
                  >
                    {pct(t, 0)}
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
