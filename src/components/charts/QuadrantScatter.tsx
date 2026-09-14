import { useMemo, useState } from 'react';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { Grid3x3 } from 'lucide-react';
import { ChartTooltip, type TooltipModel } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import './quadrant-scatter.css';

/**
 * Two measures against two thresholds, sized by a third.
 *
 * The thresholds are the analysis, not decoration: they are what turns a cloud
 * of points into four populations with different names and different actions.
 * So the quadrant labels sit in the corners of the plot rather than in a
 * legend, and the reference lines are drawn before the marks.
 */

export interface ScatterPoint {
  key: number;
  label: string;
  x: number;
  y: number;
  size: number;
  /** Drives the mark colour; the caller owns the meaning. */
  tone: 'pos' | 'accent' | 'warn' | 'neg';
  tooltip: TooltipModel;
}

export interface QuadrantLabels {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

const TONE_FILL: Record<ScatterPoint['tone'], string> = {
  pos: 'var(--c-pos)',
  accent: 'var(--c-accent)',
  warn: 'var(--c-warn)',
  neg: 'var(--c-neg)',
};

const M = { top: 18, right: 18, bottom: 40, left: 54 };

export function QuadrantScatter({
  points,
  xThreshold,
  yThreshold,
  xLabel,
  yLabel,
  formatX,
  formatY,
  quadrants,
  selected,
  onSelect,
  height = 380,
  xClamp,
}: {
  points: ScatterPoint[];
  xThreshold: number;
  yThreshold: number;
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  quadrants: QuadrantLabels;
  selected?: number | null;
  onSelect?: (key: number) => void;
  height?: number;
  /** Trims the x domain to a percentile, so one outlier cannot flatten the rest. */
  xClamp?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [hover, setHover] = useState<number | null>(null);

  const w = size.width;

  const geom = useMemo(() => {
    if (w < 240 || points.length === 0) return null;
    const iw = Math.max(40, w - M.left - M.right);
    const ih = Math.max(40, height - M.top - M.bottom);

    const xs = points.map((p) => p.x).sort((a, b) => a - b);
    const ys = points.map((p) => p.y).sort((a, b) => a - b);
    const at = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    // A single deep-loss product would otherwise push every other mark into a
    // sliver on the right, so the domain is trimmed and the mark clamped.
    const xLo = xClamp ? Math.min(at(xs, xClamp), xThreshold) : xs[0];
    const xHi = xClamp ? Math.max(at(xs, 1 - xClamp), xThreshold) : xs[xs.length - 1];
    const pad = (hi: number, lo: number) => (hi - lo) * 0.08 || 0.02;

    const x = scaleLinear()
      .domain([xLo - pad(xHi, xLo), xHi + pad(xHi, xLo)])
      .range([0, iw]);
    const y = scaleLinear()
      .domain([ys[0] - pad(ys[ys.length - 1], ys[0]), ys[ys.length - 1] + pad(ys[ys.length - 1], ys[0])])
      .range([ih, 0]);
    const r = scaleSqrt()
      .domain([0, Math.max(1, ...points.map((p) => p.size))])
      .range([2.5, Math.min(22, ih / 9)]);

    return { iw, ih, x, y, r };
  }, [w, height, points, xThreshold, xClamp]);

  if (points.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={Grid3x3}
          title="Nothing to plot"
          message="The current filter leaves no item with enough orders to read."
        />
      </div>
    );
  }

  return (
    <div ref={ref} className="chart-wrap qscatter" style={{ minHeight: height }}>
      {geom ? (
        <svg width={w} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`}>
          <g transform={`translate(${M.left},${M.top})`}>
            {geom.y.ticks(4).map((t) => (
              <g key={`y${t}`}>
                <line x1={0} x2={geom.iw} y1={geom.y(t)} y2={geom.y(t)} stroke="var(--c-grid)" />
                <text x={-8} y={geom.y(t)} dy="0.32em" textAnchor="end" className="chart-axis-label">
                  {formatY(t)}
                </text>
              </g>
            ))}
            {geom.x.ticks(5).map((t) => (
              <text
                key={`x${t}`}
                x={geom.x(t)}
                y={geom.ih + 15}
                textAnchor="middle"
                className="chart-axis-label"
              >
                {formatX(t)}
              </text>
            ))}

            {/* The two thresholds that define the quadrants. */}
            <line
              x1={geom.x(xThreshold)}
              x2={geom.x(xThreshold)}
              y1={0}
              y2={geom.ih}
              className="qscatter__split"
            />
            <line
              x1={0}
              x2={geom.iw}
              y1={geom.y(yThreshold)}
              y2={geom.y(yThreshold)}
              className="qscatter__split"
            />

            <text x={6} y={12} className="qscatter__quad">
              {quadrants.topLeft}
            </text>
            <text x={geom.iw - 6} y={12} textAnchor="end" className="qscatter__quad">
              {quadrants.topRight}
            </text>
            <text x={6} y={geom.ih - 6} className="qscatter__quad">
              {quadrants.bottomLeft}
            </text>
            <text x={geom.iw - 6} y={geom.ih - 6} textAnchor="end" className="qscatter__quad">
              {quadrants.bottomRight}
            </text>

            {points.map((p) => {
              const cx = geom.x(Math.max(geom.x.domain()[0], Math.min(geom.x.domain()[1], p.x)));
              const cy = geom.y(p.y);
              const on = hover === p.key || selected === p.key;
              const dim = (hover !== null && hover !== p.key) || (selected != null && selected !== p.key);
              return (
                <circle
                  key={p.key}
                  className="qscatter__dot chart-hit"
                  cx={cx}
                  cy={cy}
                  r={geom.r(p.size) + (on ? 2 : 0)}
                  fill={TONE_FILL[p.tone]}
                  opacity={dim ? 0.18 : 0.62}
                  stroke={on ? 'var(--c-ink)' : 'none'}
                  strokeWidth={on ? 1.5 : 0}
                  onPointerEnter={(e) => {
                    setHover(p.key);
                    show(p.tooltip, e);
                  }}
                  onPointerMove={(e) => show(p.tooltip, e)}
                  onPointerLeave={() => {
                    setHover(null);
                    hide();
                  }}
                  onClick={() => onSelect?.(p.key)}
                />
              );
            })}

            <text x={geom.iw / 2} y={geom.ih + 32} textAnchor="middle" className="chart-axis-label">
              {xLabel}
            </text>
          </g>
          <text
            transform={`translate(12,${M.top + (geom.ih ?? 0) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="chart-axis-label"
          >
            {yLabel}
          </text>
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}
