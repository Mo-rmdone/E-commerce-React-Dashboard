import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { scaleLinear } from 'd3-scale';
import { Grid3x3, ArrowUpDown } from 'lucide-react';
import { ChartTooltip, type TooltipModel } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { EmptyState } from '@/components/primitives';
import { truncate } from '@/utils/format';

/**
 * Matrix of one measure across two dimensions.
 *
 * The scale is diverging around zero because profit contribution is genuinely
 * signed — a single-hue ramp would render a loss as "a bit less green" and hide
 * the sign, which is the most important thing in the cell.
 */

export interface HeatmapCell {
  row: number;
  col: number;
  value: number;
  tooltip: TooltipModel;
}

export interface HeatmapAxis {
  key: number;
  label: string;
  total: number;
}

export function Heatmap({
  rows,
  cols,
  cells,
  formatValue,
  selectedRows,
  selectedCols,
  onSelectRow,
  onSelectCol,
  onSelectCell,
  rowLabelWidth = 132,
}: {
  rows: HeatmapAxis[];
  cols: HeatmapAxis[];
  cells: HeatmapCell[];
  formatValue: (v: number) => string;
  selectedRows: number[];
  selectedCols: number[];
  onSelectRow: (key: number) => void;
  onSelectCol: (key: number) => void;
  onSelectCell?: (row: number, col: number) => void;
  rowLabelWidth?: number;
}) {
  const { model, position, show, hide } = useChartTooltip();
  const [sortCol, setSortCol] = useState<number | null>(null);

  const grid = useMemo(() => {
    const map = new Map<string, HeatmapCell>();
    let lo = 0;
    let hi = 0;
    for (const c of cells) {
      map.set(`${c.row}:${c.col}`, c);
      if (c.value < lo) lo = c.value;
      if (c.value > hi) hi = c.value;
    }
    const bound = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    // Diverging ramp anchored at zero so positive and negative are symmetric.
    const pos = scaleLinear<number>().domain([0, bound]).range([0.06, 0.85]).clamp(true);
    const neg = scaleLinear<number>().domain([0, -bound]).range([0.06, 0.85]).clamp(true);
    return { map, pos, neg };
  }, [cells]);

  const orderedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const av = grid.map.get(`${a.key}:${sortCol}`)?.value ?? 0;
      const bv = grid.map.get(`${b.key}:${sortCol}`)?.value ?? 0;
      return bv - av;
    });
  }, [rows, sortCol, grid]);

  if (rows.length === 0 || cols.length === 0) {
    return (
      <EmptyState
        icon={Grid3x3}
        title="No matrix to build"
        message="The current filter leaves fewer than two dimensions with data."
      />
    );
  }

  return (
    <div className="heat">
      <div className="heat__scroll">
        <table className="heat__table">
          <thead>
            <tr>
              <th className="heat__corner" scope="col">
                <span className="label">Country</span>
              </th>
              {cols.map((c) => (
                <th key={c.key} scope="col" className="heat__colhead">
                  <button
                    type="button"
                    className="heat__colbtn"
                    aria-pressed={selectedCols.includes(c.key)}
                    onClick={() => onSelectCol(c.key)}
                    title={`Filter to ${c.label}`}
                  >
                    {truncate(c.label, 16)}
                  </button>
                  <button
                    type="button"
                    className="heat__sort"
                    aria-label={`Sort countries by ${c.label}`}
                    aria-pressed={sortCol === c.key}
                    onClick={() => setSortCol((s) => (s === c.key ? null : c.key))}
                  >
                    <ArrowUpDown size={10} />
                  </button>
                </th>
              ))}
              <th className="heat__total" scope="col">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((r, ri) => {
              const rowSel = selectedRows.includes(r.key);
              return (
                <tr key={r.key} className={rowSel ? 'heat__row--sel' : undefined}>
                  <th scope="row" className="heat__rowhead">
                    <button
                      type="button"
                      className="heat__rowbtn"
                      aria-pressed={rowSel}
                      onClick={() => onSelectRow(r.key)}
                      style={{ maxWidth: rowLabelWidth }}
                      title={`Filter to ${r.label}`}
                    >
                      {truncate(r.label, 18)}
                    </button>
                  </th>
                  {cols.map((c) => {
                    const cell = grid.map.get(`${r.key}:${c.key}`);
                    const v = cell?.value ?? 0;
                    const alpha = v >= 0 ? grid.pos(v) : grid.neg(v);
                    const base = v >= 0 ? 'var(--c-pos)' : 'var(--c-neg)';
                    return (
                      <td key={c.key} className="heat__cell">
                        <motion.button
                          type="button"
                          className="heat__cellbtn num"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.24, delay: Math.min(ri * 0.012, 0.25) }}
                          style={{
                            background: cell
                              ? `color-mix(in srgb, ${base} ${alpha * 100}%, var(--c-surface))`
                              : 'var(--c-surface-2)',
                            color:
                              cell && alpha > 0.5 ? 'var(--c-surface)' : 'var(--c-ink-2)',
                          }}
                          onPointerEnter={(e) => cell && show(cell.tooltip, e)}
                          onPointerMove={(e) => cell && show(cell.tooltip, e)}
                          onPointerLeave={hide}
                          onClick={() => onSelectCell?.(r.key, c.key)}
                          aria-label={`${r.label}, ${c.label}: ${cell ? formatValue(v) : 'no data'}`}
                        >
                          {cell ? formatValue(v) : '·'}
                        </motion.button>
                      </td>
                    );
                  })}
                  <td className="heat__total num">{formatValue(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ChartTooltip model={model} position={position} />
    </div>
  );
}
