import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, curveMonotoneX } from 'd3-shape';
import { max } from 'd3-array';
import { BarChart3 } from 'lucide-react';
import type { ConcentrationResult } from '@/data/metrics/customers';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { int, pct, usd } from '@/utils/format';
import './customer-concentration.css';

/**
 * A Pareto view of the customer base: how much of total revenue comes from
 * how few customers.
 *
 * Customers are ranked by spend and grouped into equal-count bins so a base of
 * thousands still draws as a legible set of bars — but the cumulative curve
 * and the 50/80/90% crossing points are computed at full resolution first, so
 * the headline numbers are exact even though the bars are a downsampled
 * silhouette of them.
 *
 * The three crossings are the reading of this chart, so each one is marked on
 * the curve and labelled in a chip above the plot floor. An earlier version
 * wrote them along the baseline, where three labels at increasing ranks
 * collided into one illegible grey run.
 */

const M = { top: 34, right: 52, bottom: 34, left: 56 };
/** Chip geometry — measured from the text so the plate always fits its label. */
const CHIP_H = 17;
const CHIP_PAD = 7;
const CHAR_W = 5.6;

type Crossing = { key: string; n: number; t: number; x: number; y: number; label: string };

export function CustomerConcentration({
  data,
  selectedCustomerRank,
  selectedCustomerLabel,
  height = 260,
}: {
  data: ConcentrationResult;
  selectedCustomerRank?: { rank: number; cumPct: number } | null;
  selectedCustomerLabel?: string;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [hoverBin, setHoverBin] = useState<number | null>(null);

  const w = size.width;

  const geom = useMemo(() => {
    if (w < 160 || data.bins.length === 0) return null;
    const iw = Math.max(20, w - M.left - M.right);
    const ih = Math.max(20, height - M.top - M.bottom);

    const x = scaleLinear().domain([0, data.n]).range([0, iw]);
    const yBar = scaleLinear()
      .domain([0, (max(data.bins, (b) => b.sales) ?? 1) * 1.1])
      .range([ih, 0])
      .nice(4);
    const yPct = scaleLinear().domain([0, 1]).range([ih, 0]);

    const curvePoints: [number, number][] = [
      [0, 0],
      ...data.bins.map((b) => [b.endRank, b.cumPct] as [number, number]),
    ];
    const lineGen = d3line<[number, number]>()
      .x((d) => x(d[0]))
      .y((d) => yPct(d[1]))
      .curve(curveMonotoneX);

    // Each crossing sits on its own guide line, so the three chips are already
    // separated vertically and only need to be kept inside the plot. On a
    // narrow plot the label drops the noun rather than the number.
    const terse = iw < 340;
    const raw: Crossing[] = (
      [
        ['p50', 0.5],
        ['p80', 0.8],
        ['p90', 0.9],
      ] as const
    )
      .map(([key, t]): Crossing | null => {
        const n = data.thresholds[key];
        if (n === null) return null;
        return {
          key,
          n,
          t,
          x: x(n),
          y: yPct(t),
          label: terse ? `${int(n)} · ${pct(t, 0)}` : `${int(n)} customers · ${pct(t, 0)}`,
        };
      })
      .filter((c): c is Crossing => c !== null);

    const chipW = (label: string) => Math.min(iw, label.length * CHAR_W + CHIP_PAD * 2);
    for (const c of raw) {
      const half = chipW(c.label) / 2;
      c.x = Math.min(Math.max(c.x, half), iw - half);
    }

    return { iw, ih, x, yBar, yPct, path: lineGen(curvePoints) ?? '', crossings: raw, chipW };
  }, [w, height, data]);

  if (data.n === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={BarChart3}
          title="No customers to rank"
          message="The current filter selects no order lines."
        />
      </div>
    );
  }

  const tooltipForBin = (i: number) => {
    const b = data.bins[i];
    const width = b.endRank - b.startRank + 1;
    return {
      title: width === 1 ? `Rank #${b.startRank}` : `Ranks #${b.startRank}–${b.endRank}`,
      subtitle: `${int(width)} ${width === 1 ? 'customer' : 'customers'}`,
      rows: [
        { label: 'Sales in this band', value: usd(b.sales), strong: true },
        { label: 'Cumulative revenue', value: pct(b.cumPct, 0) },
      ],
    };
  };

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rank = geom.x.invert(e.clientX - rect.left);
    const i = data.bins.findIndex((b) => rank <= b.endRank);
    const idx = i === -1 ? data.bins.length - 1 : i;
    setHoverBin(idx);
    show(tooltipForBin(idx), e);
  };
  const clear = () => {
    setHoverBin(null);
    hide();
  };

  return (
    <div ref={ref} className="chart-wrap cconc" style={{ minHeight: height }}>
      {geom ? (
        <svg width={w} height={height} role="img" aria-label="Customer revenue concentration">
          <g transform={`translate(${M.left},${M.top})`}>
            {geom.yBar.ticks(4).map((t) => (
              <g key={`b${t}`}>
                <line
                  x1={0}
                  x2={geom.iw}
                  y1={geom.yBar(t)}
                  y2={geom.yBar(t)}
                  stroke="var(--c-grid)"
                />
                <text
                  x={-8}
                  y={geom.yBar(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {t === 0
                    ? '$0'
                    : new Intl.NumberFormat('en-US', {
                        notation: 'compact',
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 1,
                      }).format(t)}
                </text>
              </g>
            ))}

            {/* Cumulative axis, right — the scale the curve is read against. */}
            {[0.5, 0.8, 0.9, 1].map((t) => (
              <text
                key={`p${t}`}
                x={geom.iw + 8}
                y={geom.yPct(t)}
                dy="0.32em"
                textAnchor="start"
                className="chart-axis-label cconc__pct"
              >
                {pct(t, 0)}
              </text>
            ))}

            {/* Reference guides. Dashed and quiet: they are the question, the
                curve is the answer. */}
            {geom.crossings.map((c) => (
              <line
                key={`g${c.key}`}
                x1={0}
                x2={geom.iw}
                y1={c.y}
                y2={c.y}
                className="cconc__guide"
              />
            ))}

            {data.bins.map((b, i) => {
              const bx = geom.x(b.startRank - 1);
              const bw = Math.max(0.6, geom.x(b.endRank) - bx - 1);
              const by = geom.yBar(b.sales);
              const bh = Math.max(0, geom.ih - by);
              const on = hoverBin === i;
              return (
                <rect
                  key={i}
                  className="chart-hit cconc__bar"
                  x={bx}
                  y={by}
                  width={bw}
                  height={bh}
                  rx={Math.min(2.5, bw / 2)}
                  opacity={on ? 0.95 : 0.5}
                />
              );
            })}

            <path d={geom.path} className="cconc__curve" />

            {/* Each crossing is marked on the curve and named in a chip that
                sits on its own plate, so the label survives the bars behind it. */}
            {geom.crossings.map((c) => {
              const width = geom.chipW(c.label);
              const chipY = c.y - CHIP_H - 9;
              return (
                <g key={c.key} className="cconc__cross">
                  <line x1={c.x} x2={c.x} y1={c.y} y2={geom.ih} className="cconc__drop" />
                  <circle cx={c.x} cy={c.y} r={4} className="cconc__dot" />
                  <rect
                    x={c.x - width / 2}
                    y={chipY}
                    width={width}
                    height={CHIP_H}
                    rx={CHIP_H / 2}
                    className="cconc__chip"
                  />
                  <text
                    x={c.x}
                    y={chipY + CHIP_H / 2}
                    dy="0.34em"
                    textAnchor="middle"
                    className="cconc__chip-label"
                  >
                    {c.label}
                  </text>
                </g>
              );
            })}

            {selectedCustomerRank ? (
              <g>
                <line
                  x1={geom.x(selectedCustomerRank.rank)}
                  x2={geom.x(selectedCustomerRank.rank)}
                  y1={0}
                  y2={geom.ih}
                  stroke="var(--c-ink)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <circle
                  cx={geom.x(selectedCustomerRank.rank)}
                  cy={geom.yPct(selectedCustomerRank.cumPct)}
                  r={4.5}
                  fill="var(--c-ink)"
                  stroke="var(--c-surface)"
                  strokeWidth={1.5}
                />
                <text
                  x={geom.x(selectedCustomerRank.rank)}
                  y={-20}
                  textAnchor="middle"
                  className="chart-series-label"
                  fontWeight={700}
                >
                  {selectedCustomerLabel
                    ? `${selectedCustomerLabel} · #${int(selectedCustomerRank.rank)}`
                    : `#${int(selectedCustomerRank.rank)}`}
                </text>
              </g>
            ) : null}

            <text
              x={geom.iw / 2}
              y={geom.ih + 25}
              textAnchor="middle"
              className="chart-axis-label"
            >
              Customers, ranked by annual sales (1–{int(data.n)})
            </text>

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
