import { scaleLinear } from 'd3-scale';
import { max, min } from 'd3-array';
import { useMemo } from 'react';
import { ListX } from 'lucide-react';
import { ChartTooltip, type TooltipModel } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { truncate } from '@/utils/format';

/**
 * Ranked bars for a single measure, with a signed scale so negatives read as
 * negatives rather than as short positives. Used for best sellers and for
 * underperformers, which is why the zero line is always drawn when the data
 * crosses it.
 */

export interface RankedDatum {
  key: number;
  label: string;
  value: number;
  /** Secondary figure printed at the row end. */
  secondary: string;
  tone: 'pos' | 'neg' | 'accent' | 'neutral';
  tooltip: TooltipModel;
}

const ROW_H = 26;
const LABEL_W = 168;
const SECOND_W = 62;

export function RankedBars({
  data,
  formatValue,
  selected,
  onSelect,
  onOpenDetail,
  emptyMessage = 'Nothing matches the current filter.',
}: {
  data: RankedDatum[];
  formatValue: (v: number) => string;
  selected: number[];
  onSelect: (key: number) => void;
  onOpenDetail?: (key: number) => void;
  emptyMessage?: string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const w = size.width;
  const plotW = Math.max(40, w - LABEL_W - SECOND_W - 14);

  const { x, zero, hasNegative } = useMemo(() => {
    const lo = Math.min(0, min(data, (d) => d.value) ?? 0);
    const hi = Math.max(0, max(data, (d) => d.value) ?? 1);
    const scale = scaleLinear()
      .domain([lo, hi === lo ? hi + 1 : hi])
      .range([0, plotW])
      .nice(3);
    return { x: scale, zero: scale(0), hasNegative: lo < 0 };
  }, [data, plotW]);

  if (data.length === 0) {
    return (
      <div ref={ref}>
        <EmptyState icon={ListX} title="No rows to rank" message={emptyMessage} />
      </div>
    );
  }

  const h = data.length * ROW_H + 6;
  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="chart-wrap">
      {w > 120 ? (
        <svg width={w} height={h} role="img" aria-label="Ranked results">
          {hasNegative ? (
            <line
              x1={LABEL_W + zero}
              x2={LABEL_W + zero}
              y1={2}
              y2={h - 4}
              stroke="var(--c-axis)"
              strokeWidth={1}
            />
          ) : null}

          {data.map((d, i) => {
            const isSel = selected.includes(d.key);
            const barW = Math.max(1.5, Math.abs(x(d.value) - zero));
            const barX = LABEL_W + Math.min(x(d.value), zero);
            return (
              <g
                key={d.key}
                className="chart-hit"
                transform={`translate(0,${i * ROW_H})`}
                opacity={hasSelection && !isSel ? 0.42 : 1}
                onPointerEnter={(e) => show(d.tooltip, e)}
                onPointerMove={(e) => show(d.tooltip, e)}
                onPointerLeave={hide}
                onClick={() => onSelect(d.key)}
                onDoubleClick={() => onOpenDetail?.(d.key)}
              >
                {/* Full label as the group's accessible name — inside <text> it
                    would be concatenated with the truncated label. */}
                <title>{d.label}</title>
                <rect x={0} y={0} width={w} height={ROW_H} fill="transparent" />
                <text
                  x={4}
                  y={ROW_H / 2 - 4}
                  dy="0.32em"
                  className="chart-series-label"
                  fontWeight={isSel ? 600 : 450}
                >
                  {truncate(d.label, 30)}
                </text>
                {/* Bar length is the value: painted final, never tweened. */}
                <rect
                  x={barX}
                  y={ROW_H / 2 + 3}
                  width={barW}
                  height={7}
                  rx={1.5}
                  fill={`var(--c-${d.tone === 'accent' ? 'accent' : d.tone})`}
                />
                <text
                  x={LABEL_W + plotW + 8}
                  y={ROW_H / 2 - 4}
                  dy="0.32em"
                  textAnchor="start"
                  className="chart-value-label"
                >
                  {formatValue(d.value)}
                </text>
                <text
                  x={LABEL_W + plotW + 8}
                  y={ROW_H / 2 + 8}
                  dy="0.32em"
                  textAnchor="start"
                  className="chart-axis-label"
                >
                  {d.secondary}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}
