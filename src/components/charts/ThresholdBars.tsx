import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { max } from 'd3-array';
import { BarChart3 } from 'lucide-react';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import type { TooltipModel } from '@/components/tooltips/Tooltip';

/**
 * Markets ranked by total revenue in view, with year-over-year growth beside.
 *
 * Bar length is the total across the whole filtered window, so the ranking
 * answers "how big is this market". Bar *colour* answers a second, annual
 * question — did it clear the viability bar in the latest year — and the
 * growth figure answers a third: which way is it moving.
 *
 * The threshold rule is deliberately not drawn on the track. A four-year total
 * measured against a one-year target would clear it by arithmetic rather than
 * by performance, so that verdict lives in the colour and the tooltip instead.
 */

export interface ThresholdBarDatum {
  key: number;
  label: string;
  /** Total revenue across the filtered window — drives the bar. */
  value: number;
  /** Revenue in the latest full year — what the annual bar is measured on. */
  latest: number;
  /** Latest-year distance from the threshold, signed. Shown in the tooltip. */
  variance: number;
  /** Year-over-year revenue growth, or null when there is no prior year. */
  growth: number | null;
  /** How that growth grades against the growth target. */
  growthStatus: 'on-target' | 'at-risk' | 'off-target' | 'neutral';
  meets: boolean;
  tooltip: TooltipModel;
}

const ROW_H = 28;
const LABEL_W = 108;
const VALUE_W = 150;

export function ThresholdBars({
  data,
  formatValue,
  formatGrowth,
  selected,
  onSelect,
  maxRows = 12,
  periodLabel,
}: {
  data: ThresholdBarDatum[];
  formatValue: (v: number) => string;
  formatGrowth: (v: number | null) => string;
  selected: number[];
  onSelect: (key: number) => void;
  maxRows?: number;
  /** e.g. "Bars: total revenue · arrow: vs $400K in 2023" */
  periodLabel: string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const rows = data.slice(0, maxRows);
  const w = size.width;
  const plotW = Math.max(40, w - LABEL_W - VALUE_W - 16);

  const x = useMemo(() => {
    const hi = max(rows, (d) => d.value) ?? 0;
    return scaleLinear().domain([0, hi || 1]).range([0, plotW]);
  }, [rows, plotW]);

  if (data.length === 0) {
    return (
      <div ref={ref}>
        <EmptyState
          icon={BarChart3}
          title="No markets in view"
          message="Nothing matches the current filter, so there is nothing to rank."
        />
      </div>
    );
  }

  const h = rows.length * ROW_H + 6;
  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="chart-wrap">
      {w > 100 ? (
        <>
          <svg width={w} height={h} role="img" aria-label={`Markets by revenue. ${periodLabel}`}>
            {rows.map((d, i) => {
              const isSel = selected.includes(d.key);
              const dim = hasSelection && !isSel;
              const cy = ROW_H / 2;
              return (
                <g
                  key={d.key}
                  className="chart-hit"
                  transform={`translate(0,${3 + i * ROW_H})`}
                  onPointerEnter={(e) => show(d.tooltip, e)}
                  onPointerMove={(e) => show(d.tooltip, e)}
                  onPointerLeave={hide}
                  onClick={() => onSelect(d.key)}
                  opacity={dim ? 0.4 : 1}
                >
                  <rect x={0} y={0} width={w} height={ROW_H} fill="transparent" />
                  <text
                    x={LABEL_W - 12}
                    y={cy}
                    dy="0.32em"
                    textAnchor="end"
                    className="chart-series-label"
                    fontWeight={isSel ? 700 : 500}
                  >
                    {d.label}
                  </text>

                  <g transform={`translate(${LABEL_W},0)`}>
                    <rect x={0} y={cy - 6} width={plotW} height={12} rx={3} fill="var(--c-track)" />
                    <rect
                      x={0}
                      y={cy - 6}
                      width={Math.max(2, x(d.value))}
                      height={12}
                      rx={3}
                      fill={d.meets ? 'var(--c-pos)' : 'var(--c-neg)'}
                    />
                  </g>

                  {/* Total, then growth with its own direction marker. The
                      annual viability verdict is carried by the bar's colour. */}
                  <text
                    x={LABEL_W + plotW + 12}
                    y={cy}
                    dy="0.32em"
                    className="chart-value-label"
                  >
                    {formatValue(d.value)}
                  </text>
                  {d.growth !== null ? (
                    <g transform={`translate(${LABEL_W + plotW + 74},${cy})`}>
                      <path
                        d={
                          d.growth >= 0
                            ? 'M0,3.5 L4,-2.5 L8,3.5 Z'
                            : 'M0,-2.5 L4,3.5 L8,-2.5 Z'
                        }
                        fill={`var(--c-${growthTone(d.growthStatus)})`}
                      />
                      <text
                        x={13}
                        y={0}
                        dy="0.32em"
                        className="chart-value-label"
                        fill={`var(--c-${growthTone(d.growthStatus)})`}
                      >
                        {formatGrowth(d.growth)}
                      </text>
                    </g>
                  ) : (
                    <text
                      x={LABEL_W + plotW + 74}
                      y={cy}
                      dy="0.32em"
                      className="chart-value-label"
                      fill="var(--c-faint)"
                    >
                      —
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <p className="threshold__note">{periodLabel}</p>
        </>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

/**
 * Growth is graded against the growth target, not merely against zero: a
 * market growing 8% is moving the right way but still missing the commitment,
 * and amber says that where green would not.
 */
function growthTone(status: ThresholdBarDatum['growthStatus']): string {
  return status === 'on-target'
    ? 'pos'
    : status === 'at-risk'
      ? 'warn'
      : status === 'off-target'
        ? 'neg'
        : 'faint';
}
