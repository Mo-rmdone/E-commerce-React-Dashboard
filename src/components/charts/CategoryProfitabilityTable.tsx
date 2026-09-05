import { useMemo } from 'react';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { BUSINESS_TARGETS } from '@/config/targets';
import type { Dataset } from '@/types';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { Table2 } from 'lucide-react';
import { pct, usd, usdShort } from '@/utils/format';
import './profitability-table.css';

/**
 * A strip-plot profitability table over the clean hierarchy.
 *
 * Category groups down the left carry sales, share of total and profit.
 * Each subcategory row shows a sales bar and a diverging profit bar, then a
 * strip where every one of its products is a bubble placed by its margin —
 * red below break-even, amber under the 15% target, green above it. The strip
 * turns "which products drag a subcategory down" from a number into a picture.
 */

type Band = 'loss' | 'thin' | 'healthy';

interface ProductDot {
  key: number;
  label: string;
  sales: number;
  profit: number;
  margin: number;
  band: Band;
}
interface SubRow {
  key: number;
  label: string;
  sales: number;
  profit: number;
  margin: number | null;
  products: ProductDot[];
}
interface CatGroup {
  key: number;
  label: string;
  sales: number;
  profit: number;
  subs: SubRow[];
}

const MAX_DOTS = 60;
const MARGIN_DOMAIN: [number, number] = [-0.5, 0.5];
const FIXED_COLS = 150 + 168 + 132 + 132; // category + subcat + sales + profit
const ROW_H = 42;

export function CategoryProfitabilityTable({
  ds,
  rows,
  palette,
  selectedCategories,
  selectedSubcategories,
  onToggleCategory,
  onToggleSubcategory,
  onOpenProduct,
}: {
  ds: Dataset;
  rows: Int32Array;
  palette: string[];
  selectedCategories: number[];
  selectedSubcategories: number[];
  onToggleCategory: (key: number) => void;
  onToggleSubcategory: (key: number) => void;
  onOpenProduct: (key: number) => void;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();

  const data = useMemo(() => {
    const f = ds.facts;
    const nSub = ds.dims.subcategories.length;
    const subSales = new Float64Array(nSub);
    const subProfit = new Float64Array(nSub);
    // (subcategory, product) pairs — a product is scoped to the subcategory it
    // was sold under, since a product can appear under several.
    const pair = new Map<number, { sales: number; profit: number }>();
    let total = 0;

    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const s = f.subcategory[i];
      const sales = f.sales[i];
      const profit = f.profitCents[i] / 100;
      subSales[s] += sales;
      subProfit[s] += profit;
      total += sales;
      const pk = s * ds.dims.products.length + f.product[i];
      const acc = pair.get(pk);
      if (acc) {
        acc.sales += sales;
        acc.profit += profit;
      } else pair.set(pk, { sales, profit });
    }

    const subProducts = new Map<number, ProductDot[]>();
    for (const [pk, v] of pair) {
      const s = Math.floor(pk / ds.dims.products.length);
      const prod = pk % ds.dims.products.length;
      const margin = v.sales > 0 ? v.profit / v.sales : 0;
      const list = subProducts.get(s) ?? [];
      list.push({
        key: prod,
        label: ds.dims.products[prod].name,
        sales: v.sales,
        profit: v.profit,
        margin,
        band: bandOf(margin),
      });
      subProducts.set(s, list);
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
      const prods = (subProducts.get(s) ?? [])
        .sort((a, b) => b.sales - a.sales)
        .slice(0, MAX_DOTS);
      cats[c].subs.push({
        key: s,
        label: ds.dims.subcategories[s].name,
        sales: subSales[s],
        profit: subProfit[s],
        margin: subSales[s] > 0 ? subProfit[s] / subSales[s] : null,
        products: prods,
      });
      cats[c].sales += subSales[s];
      cats[c].profit += subProfit[s];
    }

    const active = cats.filter((c) => c.subs.length > 0).sort((a, b) => b.sales - a.sales);
    active.forEach((c) => c.subs.sort((a, b) => b.sales - a.sales));

    const maxSubSales = Math.max(1, ...active.flatMap((c) => c.subs.map((s) => s.sales)));
    const maxSubProfit = Math.max(
      1,
      ...active.flatMap((c) => c.subs.map((s) => Math.abs(s.profit))),
    );
    const maxDotSales = Math.max(
      1,
      ...active.flatMap((c) => c.subs.flatMap((s) => s.products.map((p) => p.sales))),
    );
    return { cats: active, total, maxSubSales, maxSubProfit, maxDotSales };
  }, [ds, rows]);

  if (data.cats.length === 0) {
    return (
      <div ref={ref}>
        <EmptyState
          icon={Table2}
          title="Nothing to profile"
          message="The current filter selects no order lines."
        />
      </div>
    );
  }

  const stripW = Math.max(240, size.width - FIXED_COLS - 24);
  const xMargin = scaleLinear().domain(MARGIN_DOMAIN).range([8, stripW - 8]).clamp(true);
  const rDot = scaleSqrt().domain([0, data.maxDotSales]).range([2.5, 9]);

  return (
    <div ref={ref} className="ptable">
      <div className="ptable__scroll">
        <table className="ptable__table">
          <thead>
            <tr>
              <th className="ptable__h ptable__h--cat">Category</th>
              <th className="ptable__h">Subcategory</th>
              <th className="ptable__h ptable__h--num">Sales</th>
              <th className="ptable__h ptable__h--num">Profit</th>
              <th className="ptable__h">
                Product profitability
                <span className="ptable__legend">
                  <span className="ptable__key ptable__key--loss">loss</span>
                  <span className="ptable__key ptable__key--thin">0–15%</span>
                  <span className="ptable__key ptable__key--healthy">15%+</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.cats.map((c) => {
              const catSel = selectedCategories.includes(c.key);
              const catColour = palette[c.key % palette.length];
              return c.subs.map((s, si) => {
                const subSel = selectedSubcategories.includes(s.key);
                return (
                  <tr key={`${c.key}-${s.key}`} className={si === 0 ? 'ptable__group' : undefined}>
                    {si === 0 ? (
                      <th
                        scope="rowgroup"
                        rowSpan={c.subs.length}
                        className={`ptable__cat ${catSel ? 'ptable__cat--sel' : ''}`}
                        onClick={() => onToggleCategory(c.key)}
                      >
                        <span className="ptable__cat-dot" style={{ background: catColour }} />
                        <span className="ptable__cat-name">{c.label}</span>
                        <span className="ptable__cat-metrics">
                          <span className="num">{usdShort(c.sales)}</span>
                          <span className="ptable__cat-share">
                            {pct(data.total ? c.sales / data.total : 0, 0)} of total
                          </span>
                          <span className={`num ${c.profit < 0 ? 'val--neg' : 'val--pos'}`}>
                            {usdShort(c.profit)} profit
                          </span>
                        </span>
                      </th>
                    ) : null}

                    <td
                      className={`ptable__sub ${subSel ? 'ptable__sub--sel' : ''}`}
                      onClick={() => onToggleSubcategory(s.key)}
                    >
                      <span className="ptable__sub-name" title={s.label}>
                        {s.label}
                      </span>
                      <span className="ptable__sub-margin num">{pct(s.margin, 0)}</span>
                    </td>

                    <td className="ptable__bars">
                      <span className="ptable__bar-track">
                        <span
                          className="ptable__bar-fill"
                          style={{ width: `${(s.sales / data.maxSubSales) * 100}%` }}
                        />
                      </span>
                      <span className="ptable__bar-val num">{usdShort(s.sales)}</span>
                    </td>

                    <td className="ptable__bars">
                      <span className="ptable__bar-track ptable__bar-track--diverge">
                        <span
                          className={`ptable__bar-fill ${s.profit < 0 ? 'ptable__bar-fill--neg' : 'ptable__bar-fill--pos'}`}
                          style={{
                            width: `${(Math.abs(s.profit) / data.maxSubProfit) * 50}%`,
                            left: s.profit < 0 ? undefined : '50%',
                            right: s.profit < 0 ? '50%' : undefined,
                          }}
                        />
                        <span className="ptable__bar-zero" />
                      </span>
                      <span className={`ptable__bar-val num ${s.profit < 0 ? 'val--neg' : 'val--pos'}`}>
                        {usdShort(s.profit)}
                      </span>
                    </td>

                    <td className="ptable__strip">
                      <svg width={stripW} height={ROW_H - 8} role="img" aria-label={`Product margins in ${s.label}`}>
                        {/* band dividers at 0 and the 15% target */}
                        {[0, BUSINESS_TARGETS.profitMargin].map((t) => (
                          <line
                            key={t}
                            x1={xMargin(t)}
                            x2={xMargin(t)}
                            y1={2}
                            y2={ROW_H - 12}
                            stroke="var(--c-rule-strong)"
                            strokeWidth={1}
                            strokeDasharray="2 3"
                          />
                        ))}
                        {s.products.map((p, pi) => {
                          const cy = (ROW_H - 8) / 2 + jitter(pi, ROW_H - 24);
                          return (
                            <circle
                              key={p.key}
                              cx={xMargin(p.margin)}
                              cy={cy}
                              r={rDot(p.sales)}
                              className={`ptable__dot ptable__dot--${p.band}`}
                              onPointerEnter={(e) => show(dotTip(p, s.label), e)}
                              onPointerMove={(e) => show(dotTip(p, s.label), e)}
                              onPointerLeave={hide}
                              onClick={() => onOpenProduct(p.key)}
                            />
                          );
                        })}
                      </svg>
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

function bandOf(margin: number): Band {
  if (margin < 0) return 'loss';
  if (margin <= BUSINESS_TARGETS.profitMargin) return 'thin';
  return 'healthy';
}

/** Deterministic vertical spread so overlapping margins do not stack. */
function jitter(i: number, span: number): number {
  const golden = (i * 0.61803398875) % 1;
  return (golden - 0.5) * span;
}

function dotTip(p: ProductDot, subLabel: string) {
  return {
    title: p.label,
    subtitle: subLabel,
    rows: [
      { label: 'Sales', value: usd(p.sales), strong: true },
      {
        label: 'Profit',
        value: usd(p.profit),
        tone: p.profit < 0 ? ('neg' as const) : ('pos' as const),
      },
      { label: 'Margin', value: pct(p.margin) },
    ],
    status: {
      level:
        p.band === 'healthy'
          ? ('on-target' as const)
          : p.band === 'thin'
            ? ('at-risk' as const)
            : ('off-target' as const),
      label:
        p.band === 'healthy'
          ? `Clears the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
          : p.band === 'thin'
            ? `Under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
            : 'Loss-making',
    },
    hint: 'Click to open product detail',
  };
}
