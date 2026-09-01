import { useMemo } from 'react';
import { arc, pie } from 'd3-shape';
import { PieChart } from 'lucide-react';
import type { Breakdown } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import { revenue, margin } from '@/data/metrics/breakdowns';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { pct, pctSigned, usd, usdShort } from '@/utils/format';

/**
 * Composition of the current view, one ring per drill level.
 *
 * The centre carries the total so the ring is read as "what makes up this
 * number" rather than as a decorative donut. Slices are clickable and drive the
 * page filter, which is the only reason a donut earns its place over a bar
 * chart here: it is a selector as much as a chart.
 */
export function SegmentDonut({
  items,
  basis,
  total,
  centreLabel,
  selected,
  onSelect,
  onDrill,
  height = 200,
  colorOf,
}: {
  items: Breakdown[];
  basis: RevenueBasis;
  total: number;
  centreLabel: string;
  selected: number[];
  onSelect: (key: number) => void;
  onDrill?: (item: Breakdown) => void;
  height?: number;
  colorOf: (key: number, index: number) => string;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const w = size.width;
  const dim = Math.min(w, height);

  const slices = useMemo(() => {
    if (dim < 60) return null;
    const outer = dim / 2 - 4;
    const inner = outer * 0.62;

    const layout = pie<Breakdown>()
      .value((d) => Math.max(0, revenue(d.current, basis)))
      .sort(null)
      .padAngle(0.012);

    const shape = arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(inner)
      .outerRadius(outer)
      .cornerRadius(2);

    const hover = arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(inner)
      .outerRadius(outer + 3)
      .cornerRadius(2);

    return layout(items).map((a, i) => ({
      item: items[i],
      index: i,
      d: shape(a) ?? '',
      dHover: hover(a) ?? '',
      share: total > 0 ? revenue(items[i].current, basis) / total : 0,
    }));
  }, [items, basis, dim, total]);

  if (items.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={PieChart}
          title="Nothing to break down"
          message="No order lines match the current filter."
        />
      </div>
    );
  }

  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="donut" style={{ minHeight: height }}>
      {slices ? (
        <svg width={dim} height={dim} role="img" aria-label={`Composition by ${centreLabel}`}>
          <g transform={`translate(${dim / 2},${dim / 2})`}>
            {slices.map(({ item, index, d, share }) => {
              const isSel = selected.includes(item.key);
              return (
                <path
                  key={item.key}
                  className="chart-hit"
                  d={d}
                  fill={colorOf(item.key, index)}
                  opacity={hasSelection && !isSel ? 0.28 : 1}
                  style={{ transition: 'opacity 160ms var(--ease)' }}
                  stroke={isSel ? 'var(--c-ink)' : 'var(--c-surface)'}
                  strokeWidth={isSel ? 2 : 1}
                  onPointerEnter={(e) =>
                    show(tooltipFor(item, basis, share, !!onDrill), e)
                  }
                  onPointerMove={(e) => show(tooltipFor(item, basis, share, !!onDrill), e)}
                  onPointerLeave={hide}
                  onClick={() => onSelect(item.key)}
                  onDoubleClick={() => onDrill?.(item)}
                />
              );
            })}
            <text textAnchor="middle" y={-6} className="donut__total num">
              {usdShort(total)}
            </text>
            <text textAnchor="middle" y={11} className="donut__label">
              {centreLabel}
            </text>
          </g>
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function tooltipFor(
  item: Breakdown,
  basis: RevenueBasis,
  share: number,
  drillable: boolean,
) {
  return {
    title: item.label,
    subtitle: `${pct(share, 1)} of the current view`,
    rows: [
      {
        label: 'Revenue',
        value: usd(revenue(item.current, basis)),
        strong: true,
      },
      { label: 'Profit', value: usd(item.current.profit) },
      { label: 'Margin', value: pct(margin(item.current, basis)) },
      {
        label: 'YoY growth',
        value: item.growth === null ? 'no prior year' : pctSigned(item.growth),
        tone: item.growth === null ? ('muted' as const) : item.growth >= 0 ? ('pos' as const) : ('neg' as const),
      },
    ],
    hint: drillable ? 'Click to filter · double-click to drill in' : 'Click to filter',
  };
}
