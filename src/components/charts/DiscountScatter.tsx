import { useMemo } from 'react';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { extent, max } from 'd3-array';
import { ScatterChart } from 'lucide-react';
import type { ScatterPoint } from '@/data/metrics/discount';
import { BUSINESS_TARGETS } from '@/config/targets';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { int, pct, usd } from '@/utils/format';

/**
 * Discount depth against realised margin.
 *
 * Two reference lines carry the analysis: the horizontal one is the 15% margin
 * target, and the diagonal is breakeven — the point where a group's discount
 * exactly consumes its built-in margin. Anything below the diagonal is losing
 * money by construction, which is why the region is shaded rather than left for
 * the reader to infer.
 */

const M = { top: 14, right: 16, bottom: 34, left: 46 };

export function DiscountScatter({
  points,
  height = 260,
  selected,
  onSelect,
  unitLabel,
}: {
  points: ScatterPoint[];
  height?: number;
  selected: number[];
  onSelect: (key: number) => void;
  unitLabel: string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const w = size.width;

  const geom = useMemo(() => {
    if (w < 140 || points.length === 0) return null;
    const iw = Math.max(20, w - M.left - M.right);
    const ih = Math.max(20, height - M.top - M.bottom);

    const [dLo = 0, dHi = 0.5] = extent(points, (p) => p.discount) as [number, number];
    const x = scaleLinear()
      .domain([Math.min(0, dLo), Math.max(dHi * 1.08, 0.1)])
      .range([0, iw])
      .nice(5);

    const [mLo = -0.2, mHi = 0.5] = extent(points, (p) => p.margin) as [number, number];
    const y = scaleLinear()
      .domain([Math.min(mLo * 1.15, -0.02), Math.max(mHi * 1.12, BUSINESS_TARGETS.profitMargin * 1.3)])
      .range([ih, 0])
      .nice(5);

    const r = scaleSqrt()
      .domain([0, max(points, (p) => p.sales) ?? 1])
      .range([2.5, 20]);

    // Breakeven diagonal: margin = weightedBreakeven - discount. The average
    // breakeven across the plotted groups anchors the line.
    const avgBreakeven =
      points.reduce((s, p) => s + p.breakeven * p.sales, 0) /
      Math.max(1, points.reduce((s, p) => s + p.sales, 0));

    const [x0, x1] = x.domain();
    const diagonal = [
      { x: x(x0), y: y(avgBreakeven - x0) },
      { x: x(x1), y: y(avgBreakeven - x1) },
    ];

    return { iw, ih, x, y, r, diagonal, avgBreakeven };
  }, [w, height, points]);

  if (points.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={ScatterChart}
          title="Not enough to plot"
          message={`No ${unitLabel} in the current filter carry both a discount and a margin.`}
        />
      </div>
    );
  }

  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="chart-wrap" style={{ minHeight: height }}>
      {geom ? (
        <svg width={w} height={height} role="img" aria-label="Discount versus profit margin">
          <defs>
            <clipPath id="scatter-clip">
              <rect x={0} y={0} width={geom.iw} height={geom.ih} />
            </clipPath>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {geom.y.ticks(4).map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={0}
                  x2={geom.iw}
                  y1={geom.y(t)}
                  y2={geom.y(t)}
                  stroke="var(--c-grid)"
                  strokeWidth={t === 0 ? 1.25 : 1}
                />
                <text x={-8} y={geom.y(t)} dy="0.32em" textAnchor="end" className="chart-axis-label">
                  {pct(t, 0)}
                </text>
              </g>
            ))}
            {geom.x.ticks(4).map((t) => (
              <text
                key={`x${t}`}
                x={geom.x(t)}
                y={geom.ih + 15}
                textAnchor="middle"
                className="chart-axis-label"
              >
                {pct(t, 0)}
              </text>
            ))}

            <g clipPath="url(#scatter-clip)">
              {/* Loss region: below the breakeven diagonal. */}
              <path
                d={`M ${geom.diagonal[0].x} ${geom.diagonal[0].y} L ${geom.diagonal[1].x} ${geom.diagonal[1].y} L ${geom.iw} ${geom.ih} L 0 ${geom.ih} Z`}
                fill="var(--c-neg)"
                opacity={0.05}
              />
              <line
                x1={geom.diagonal[0].x}
                y1={geom.diagonal[0].y}
                x2={geom.diagonal[1].x}
                y2={geom.diagonal[1].y}
                stroke="var(--c-neg)"
                strokeWidth={1.25}
                strokeDasharray="5 3"
                opacity={0.65}
              />
            </g>

            {/* 15% margin target */}
            <line
              x1={0}
              x2={geom.iw}
              y1={geom.y(BUSINESS_TARGETS.profitMargin)}
              y2={geom.y(BUSINESS_TARGETS.profitMargin)}
              stroke="var(--c-reference)"
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
            <text
              x={geom.iw - 2}
              y={geom.y(BUSINESS_TARGETS.profitMargin) - 5}
              textAnchor="end"
              className="chart-ref-label"
            >
              {pct(BUSINESS_TARGETS.profitMargin, 0)} margin target
            </text>

            {/* Bubble area is the encoding, so the layer paints at its true
                geometry rather than animating into place. */}
            <g>
              {points.map((p) => {
                const isSel = selected.includes(p.key);
                const below = p.margin < BUSINESS_TARGETS.profitMargin;
                return (
                  <circle
                    key={p.key}
                    className="chart-hit"
                    cx={geom.x(p.discount)}
                    cy={geom.y(p.margin)}
                    r={geom.r(p.sales)}
                    opacity={hasSelection && !isSel ? 0.22 : 0.72}
                    fill={p.margin < 0 ? 'var(--c-neg)' : below ? 'var(--c-warn)' : 'var(--c-pos)'}
                    stroke={isSel ? 'var(--c-ink)' : 'var(--c-surface)'}
                    strokeWidth={isSel ? 2 : 1}
                    style={{ transition: 'opacity 160ms var(--ease)' }}
                    onPointerEnter={(e) => show(tooltipFor(p), e)}
                    onPointerMove={(e) => show(tooltipFor(p), e)}
                    onPointerLeave={hide}
                    onClick={() => onSelect(p.key)}
                  />
                );
              })}
            </g>

            <text
              x={geom.iw / 2}
              y={geom.ih + 30}
              textAnchor="middle"
              className="chart-axis-label"
            >
              Average discount
            </text>
          </g>
          <text
            transform={`translate(12,${M.top + geom.ih / 2}) rotate(-90)`}
            textAnchor="middle"
            className="chart-axis-label"
          >
            Profit margin
          </text>
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function tooltipFor(p: ScatterPoint) {
  const headroom = p.breakeven - p.discount;
  return {
    title: p.label,
    subtitle: `${int(p.lines)} order lines`,
    rows: [
      { label: 'Revenue', value: usd(p.sales), strong: true },
      { label: 'Profit', value: usd(p.profit), tone: p.profit < 0 ? ('neg' as const) : undefined },
      { label: 'Avg discount', value: pct(p.discount) },
      { label: 'Breakeven at', value: pct(p.breakeven) },
      {
        label: 'Headroom',
        value: pct(headroom),
        tone: headroom < 0 ? ('neg' as const) : ('pos' as const),
      },
      { label: 'Lines at a loss', value: pct(p.lossShare, 0) },
    ],
    status: {
      level:
        p.margin >= BUSINESS_TARGETS.profitMargin
          ? ('on-target' as const)
          : p.margin >= 0
            ? ('at-risk' as const)
            : ('off-target' as const),
      label:
        p.margin >= BUSINESS_TARGETS.profitMargin
          ? `Margin ${pct(p.margin)} clears the target`
          : p.margin >= 0
            ? `Margin ${pct(p.margin)} is under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
            : `Loss-making at ${pct(p.margin)} margin`,
    },
    hint: 'Click to filter',
  };
}
