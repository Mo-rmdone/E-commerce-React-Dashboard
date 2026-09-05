import { useMemo } from 'react';
import { Rows3 } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { pct, usd, usdShort } from '@/utils/format';
import './category-bars.css';

/**
 * A grouped horizontal bar chart over Category → Subcategory.
 *
 * Every subcategory is shown at once — there are only seventeen, so the rows are
 * sized to the available height and the whole ranking fits without scrolling.
 * The category is banded down the left, its subcategories ranked within, and all
 * bars share one axis so a bar in one category is directly comparable to another.
 * The value label sits just past each bar's end and carries the part-to-whole:
 * each subcategory's share of the total, so rank and share are read together —
 * what a treemap gives up for its tiling.
 *
 * On Sales bars run from zero, coloured by category. On Profit they diverge from
 * a zero line — right and green for a gain, left and red for a loss — because a
 * loss must not read as a short gain.
 */

type Metric = 'sales' | 'profit';

// Horizontal room reserved past the bar so the value label always sits clear of
// the fill rather than on top of it.
const LABEL_W = { sales: 86, profit: 64 } as const;

interface SubRow {
  key: number;
  label: string;
  sales: number;
  profit: number;
}
interface CatGroup {
  key: number;
  label: string;
  sales: number;
  profit: number;
  subs: SubRow[];
}

export function CategoryBars({
  ds,
  rows,
  metric,
  palette,
  selectedCategories,
  selectedSubcategories,
  onToggleCategory,
  onToggleSubcategory,
  height = 320,
}: {
  ds: Dataset;
  rows: Int32Array;
  metric: Metric;
  palette: string[];
  selectedCategories: number[];
  selectedSubcategories: number[];
  onToggleCategory: (key: number) => void;
  onToggleSubcategory: (key: number) => void;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const data = useMemo(() => {
    const f = ds.facts;
    const nSub = ds.dims.subcategories.length;
    const subSales = new Float64Array(nSub);
    const subProfit = new Float64Array(nSub);
    let totalSales = 0;
    let totalProfit = 0;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const s = f.subcategory[i];
      subSales[s] += f.sales[i];
      subProfit[s] += f.profitCents[i] / 100;
      totalSales += f.sales[i];
      totalProfit += f.profitCents[i] / 100;
    }
    const cats: CatGroup[] = ds.dims.categories.map((label, key) => ({
      key,
      label,
      sales: 0,
      profit: 0,
      subs: [],
    }));
    for (let s = 0; s < nSub; s++) {
      if (subSales[s] === 0 && subProfit[s] === 0) continue;
      const c = ds.dims.subToCategory[s];
      cats[c].subs.push({ key: s, label: ds.dims.subcategories[s].name, sales: subSales[s], profit: subProfit[s] });
      cats[c].sales += subSales[s];
      cats[c].profit += subProfit[s];
    }
    const v = (o: { sales: number; profit: number }) => (metric === 'sales' ? o.sales : o.profit);
    const active = cats.filter((c) => c.subs.length > 0).sort((a, b) => v(b) - v(a));
    active.forEach((c) => c.subs.sort((a, b) => v(b) - v(a)));
    const maxBar = Math.max(1, ...active.flatMap((c) => c.subs.map((s) => Math.abs(v(s)))));
    const totalRows = active.reduce((n, c) => n + c.subs.length, 0);
    return { cats: active, totalSales, totalProfit, maxBar, totalRows };
  }, [ds, rows, metric]);

  if (data.cats.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={Rows3}
          title="Nothing to chart"
          message="The current filter selects no order lines."
        />
      </div>
    );
  }

  const v = (o: { sales: number; profit: number }) => (metric === 'sales' ? o.sales : o.profit);
  const grand = metric === 'sales' ? data.totalSales : data.totalProfit;

  // Fit every row into the available height — no scrolling. Rows only fall back
  // to a floor (then the container scrolls) if the card is genuinely too short.
  const availH = size.height || height;
  // Subtract headroom (group borders + sub-pixel accumulation + a safety gap)
  // so the rows always total a little under the space and never tip into scroll.
  const rowH = Math.max(16, Math.min(32, Math.floor((availH - 14) / Math.max(1, data.totalRows))));
  const barH = Math.max(7, Math.min(15, rowH - 7));
  const lw = LABEL_W[metric];

  const tip = (name: string, sub: string, sales: number, profit: number) => {
    const m = sales > 0 ? profit / sales : null;
    return {
      title: name,
      subtitle: sub,
      rows: [
        { label: 'Sales', value: usd(sales), strong: metric === 'sales' },
        {
          label: 'Profit',
          value: usd(profit),
          strong: metric === 'profit',
          tone: profit < 0 ? ('neg' as const) : ('pos' as const),
        },
        { label: 'Margin', value: pct(m) },
        ...(metric === 'sales' && data.totalSales > 0
          ? [{ label: 'Share of total', value: pct(sales / data.totalSales, 1) }]
          : []),
      ],
      status: {
        level:
          m !== null && m >= BUSINESS_TARGETS.profitMargin
            ? ('on-target' as const)
            : profit >= 0
              ? ('at-risk' as const)
              : ('off-target' as const),
        label:
          profit < 0
            ? 'Loss-making'
            : m !== null && m >= BUSINESS_TARGETS.profitMargin
              ? `Clears the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
              : `Under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`,
      },
    };
  };

  return (
    <div className="cbars" style={{ minHeight: height }}>
      <div ref={ref} className="cbars__scroll">
        <table className="cbars__table">
          <tbody>
            {data.cats.map((c) => {
              const catSel = selectedCategories.includes(c.key);
              const colour = palette[c.key % palette.length];
              return c.subs.map((s, i) => {
                const val = v(s);
                const frac = Math.abs(val) / data.maxBar;
                const subSel = selectedSubcategories.includes(s.key);
                const sub = `Subcategory of ${c.label}`;
                const fillStyle = barFill(metric, val, frac, lw, colour, barH);
                return (
                  <tr key={`${c.key}-${s.key}`} style={{ height: rowH }} className={i === 0 ? 'cbars__grouptop' : undefined}>
                    {i === 0 ? (
                      <th
                        scope="rowgroup"
                        rowSpan={c.subs.length}
                        className={`cbars__cat ${catSel ? 'is-sel' : ''}`}
                        onClick={() => onToggleCategory(c.key)}
                        onPointerEnter={(e) => show(tip(c.label, 'Category', c.sales, c.profit), e)}
                        onPointerMove={(e) => show(tip(c.label, 'Category', c.sales, c.profit), e)}
                        onPointerLeave={hide}
                      >
                        <span className="cbars__cat-dot" style={{ background: colour }} />
                        <span className="cbars__cat-name">{c.label}</span>
                      </th>
                    ) : null}

                    <td
                      className={`cbars__sub ${subSel ? 'is-sel' : ''}`}
                      onClick={() => onToggleSubcategory(s.key)}
                    >
                      {s.label}
                    </td>

                    <td
                      className="cbars__barcell"
                      onPointerEnter={(e) => show(tip(s.label, sub, s.sales, s.profit), e)}
                      onPointerMove={(e) => show(tip(s.label, sub, s.sales, s.profit), e)}
                      onPointerLeave={hide}
                      onClick={() => onToggleSubcategory(s.key)}
                    >
                      <div className="cbars__track" style={{ height: rowH }}>
                        {metric === 'profit' ? <span className="cbars__zero" /> : null}
                        <span
                          className={`cbars__fill ${
                            metric === 'profit' ? (val < 0 ? 'is-neg' : 'is-pos') : ''
                          }`}
                          style={fillStyle}
                        />
                        <span
                          className={`cbars__val num ${val < 0 ? 'val--neg' : ''} ${
                            metric === 'profit' && val < 0 ? 'cbars__val--left' : ''
                          }`}
                          style={labelStyle(metric, val, frac, lw)}
                        >
                          {usdShort(val)}
                          {metric === 'sales' && grand > 0 ? (
                            <span className="cbars__val-share">{pct(s.sales / grand, 0)}</span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

/**
 * The fill is scaled into the track *minus* the reserved label width, so the
 * bar can never reach the edge and the label always clears it.
 */
function barFill(
  metric: Metric,
  val: number,
  frac: number,
  lw: number,
  colour: string,
  barH: number,
): React.CSSProperties {
  const base: React.CSSProperties = { height: barH };
  if (metric === 'sales') {
    return { ...base, left: 0, width: `calc(${frac} * (100% - ${lw}px))`, background: colour };
  }
  const w = `calc(${frac} * (50% - ${lw}px))`;
  return val < 0
    ? { ...base, right: '50%', width: w }
    : { ...base, left: '50%', width: w };
}

/** Place the value just past the bar's outer end, always outside the fill. */
function labelStyle(metric: Metric, val: number, frac: number, lw: number): React.CSSProperties {
  if (metric === 'sales') {
    return { left: `calc(${frac} * (100% - ${lw}px) + 7px)` };
  }
  const end = `calc(50% + ${frac} * (50% - ${lw}px) + 7px)`;
  return val < 0 ? { right: end } : { left: end };
}
