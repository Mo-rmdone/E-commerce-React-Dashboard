import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { Breakdown, Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { useDashboardData, useBreakdown } from '@/hooks/useDashboardData';
import { useFilters } from '@/hooks/useFilters';
import { useDrilldown, type DrillthroughEntity } from '@/hooks/useDrilldown';
import { dimensionAccess, margin, revenue } from '@/data/metrics/breakdowns';
import {
  buildDiscountImpact,
  buildDiscountScatter,
  buildMarginTiers,
} from '@/data/metrics/discount';
import { Card, EmptyState, Segmented } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { SankeyFlow } from '@/components/charts/SankeyFlow';
import { buildFlowGraph, type FlowNode } from '@/data/metrics/flows';
import { DiscountScatter } from '@/components/charts/DiscountScatter';
import { RankedBars, type RankedDatum } from '@/components/charts/RankedBars';
import { Heatmap, type HeatmapAxis, type HeatmapCell } from '@/components/charts/Heatmap';
import { categorical } from '@/config/theme';
import { int, pct, usd, usdShort } from '@/utils/format';
import '../pages.css';

type RankMode = 'top' | 'under';
type ScatterUnit = 'subcategory' | 'product' | 'country';

const SCATTER_LABEL: Record<ScatterUnit, string> = {
  subcategory: 'Subcategories',
  product: 'Products',
  country: 'Countries',
};

/**
 * Page 2 — Product & Category Intelligence.
 *
 * Answers: which products and categories drive profitable growth, and where is
 * discounting damaging margin?
 */
export function ProductIntelligence({
  ds,
  onOpenDetail,
}: {
  ds: Dataset;
  onOpenDetail: (e: DrillthroughEntity) => void;
}) {
  const data = useDashboardData(ds);
  const { filters, toggle, basis } = useFilters();

  const [rankMode, setRankMode] = useState<RankMode>('top');
  const [scatterUnit, setScatterUnit] = useState<ScatterUnit>('subcategory');

  // The flow shows two tiers at once, so two views cover all three levels:
  // Category -> Subcategory at the root, and Subcategory -> Product once a
  // category is chosen. There is no SKU tier in the workbook.
  const drill = useDrilldown(['category', 'subcategory'] as const);

  const scoped = useMemo(
    () => scopeToDrill(ds, data.rows, drill.path),
    [ds, data.rows, drill.path],
  );


  const palette = categorical();
  const categories = useBreakdown(ds, data, 'category');
  const countries = useBreakdown(ds, data, 'country');

  // Root: revenue flowing from each Category into its Subcategories.
  // Drilled: from each Subcategory of the chosen category into Products.
  const flowDims = drill.depth === 0
    ? ({ source: 'category', target: 'subcategory' } as const)
    : ({ source: 'subcategory', target: 'product' } as const);

  const flow = useMemo(
    () =>
      buildFlowGraph(ds, scoped, flowDims.source, flowDims.target, {
        basis,
        maxTargets: drill.depth === 0 ? 17 : 12,
      }),
    [ds, scoped, flowDims.source, flowDims.target, basis, drill.depth],
  );

  const flowNodeTooltip = useCallback(
    (n: FlowNode) => ({
      title: n.label,
      subtitle: n.aggregate
        ? 'Every remaining target, combined'
        : `${pct(n.value / (flow.total || 1), 1)} of revenue in view`,
      rows: [
        { label: 'Revenue', value: usd(n.value), strong: true },
        { label: 'Share', value: pct(n.value / (flow.total || 1), 1) },
      ],
      hint: n.aggregate
        ? 'Combined bucket — not selectable'
        : n.side === 'source' && drill.depth === 0
          ? 'Click to filter · double-click to open its subcategories'
          : 'Click to filter',
    }),
    [flow.total, drill.depth],
  );

  const flowLinkTooltip = useCallback(
    (source: FlowNode, target: FlowNode, value: number, shareOfSource: number) => ({
      title: `${source.label} → ${target.label}`,
      subtitle: `${pct(shareOfSource, 1)} of ${source.label}`,
      rows: [
        { label: 'Revenue', value: usd(value), strong: true },
        { label: 'Share of total', value: pct(value / (flow.total || 1), 1) },
      ],
    }),
    [flow.total],
  );

  const scatter = useMemo(() => {
    const access = dimensionAccess(ds, scatterUnit);
    const minLines = scatterUnit === 'product' ? 20 : scatterUnit === 'country' ? 40 : 1;
    return buildDiscountScatter(
      ds,
      data.rows,
      access.size,
      access.keyOf,
      access.label,
      minLines,
    ).slice(0, 220);
  }, [ds, data.rows, scatterUnit]);

  const products = useBreakdown(ds, data, 'product');

  const ranked = useMemo<RankedDatum[]>(() => {
    const pool = products.filter((p) => p.current.lines >= 3);
    const sorted =
      rankMode === 'top'
        ? [...pool].sort((a, b) => revenue(b.current, basis) - revenue(a.current, basis))
        : [...pool].sort((a, b) => a.current.profit - b.current.profit);

    return sorted.slice(0, 8).map((p) => {
      const m = margin(p.current, basis);
      return {
        key: p.key,
        label: p.label,
        value: rankMode === 'top' ? revenue(p.current, basis) : p.current.profit,
        secondary: `${pct(m)} margin · ${int(p.current.lines)} lines`,
        tone:
          rankMode === 'under'
            ? 'neg'
            : m !== null && m >= BUSINESS_TARGETS.profitMargin
              ? 'accent'
              : 'neutral',
        tooltip: {
          title: p.label,
          subtitle: `Unit price ${usd(ds.dims.products[p.key].unitPrice)} · ${int(
            p.current.quantity,
          )} units sold`,
          rows: [
            { label: 'Revenue', value: usd(revenue(p.current, basis)), strong: true },
            {
              label: 'Profit',
              value: usd(p.current.profit),
              tone: p.current.profit < 0 ? ('neg' as const) : ('pos' as const),
            },
            { label: 'Margin', value: pct(m) },
            { label: 'Avg discount', value: pct(p.current.avgDiscount) },
            { label: 'Lines at a loss', value: pct(p.current.lossShare, 0) },
          ],
          hint: 'Click to filter · double-click for product detail',
        },
      };
    });
  }, [products, rankMode, basis, ds]);

  const { rows: heatRows, cols: heatCols, cells: heatCells } = useMemo(
    () => buildProfitMatrix(ds, data.rows, countries, categories),
    [ds, data.rows, countries, categories],
  );

  const tiers = useMemo(() => buildMarginTiers(ds, data.rows), [ds, data.rows]);
  const impact = useMemo(() => buildDiscountImpact(ds, data.rows), [ds, data.rows]);

  if (data.isEmpty) {
    return (
      <div className="page">
        <Card>
          <EmptyState
            icon={SlidersHorizontal}
            title="No data for the selected filters"
            message="Nothing in the workbook matches this combination. Remove a filter to bring results back."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">

      <div className="grid grid--prod">
        <Card
          title={drill.depth === 0 ? 'Revenue flow: category to subcategory' : 'Revenue flow: subcategory to product'}
          span="tree"
          subtitle={
            flow.foldedTargets > 0
              ? `top ${drill.depth === 0 ? 17 : 12}, rest combined`
              : `${flow.nodes.filter((n) => n.side === 'target').length} on the right`
          }
          info={
            <InfoDot label="About this flow">
              Band thickness is revenue. A flow, not a tree, because that is what the workbook
              supports: Category and Subcategory are attributes of the order line, and 3,576
              products appear under more than one subcategory — so a product does not belong to a
              category. Reading it as flow states only what is true. Click a node to filter;
              double-click a category to open its subcategories.
            </InfoDot>
          }
          tools={
            drill.canDrillUp ? (
              <button type="button" className="btn" onClick={drill.drillUp}>
                <ChevronLeft size={13} />
                Back
              </button>
            ) : null
          }
        >
          <Breadcrumb
            path={drill.path.map((p) => p.label)}
            onJump={drill.jumpTo}
            onReset={drill.reset}
            rootLabel="All categories"
          />
          <SankeyFlow
            graph={flow}
            height={drill.depth === 0 ? 320 : 300}
            colorOf={(_, i) => palette[i % palette.length]}
            nodeTooltip={flowNodeTooltip}
            linkTooltip={flowLinkTooltip}
            selectedSources={drill.depth === 0 ? filters.category : filters.subcategory}
            selectedTargets={drill.depth === 0 ? filters.subcategory : filters.product}
            onSelectSource={(k) =>
              toggle(drill.depth === 0 ? 'category' : 'subcategory', k, 'Revenue flow')
            }
            onSelectTarget={(k) => {
              if (k < 0) return; // the combined "Other" bucket is not a real member
              toggle(drill.depth === 0 ? 'subcategory' : 'product', k, 'Revenue flow');
            }}
            onDrillSource={
              drill.depth === 0
                ? (n) => drill.drillTo({ level: 'category', key: n.key, label: n.label })
                : undefined
            }
          />
        </Card>

        <Card
          title="Discount vs margin"
          span="scatter"
          info={
            <InfoDot label="About this chart">
              Profit reconstructs exactly as Sales × (base margin − discount) on every row in this
              workbook, so discount is the only lever on margin. The dashed diagonal is breakeven:
              anything in the shaded region is losing money by construction. Points are aggregated
              groups — plotting 51,288 raw lines would draw a straight line and say nothing.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Scatter unit"
              value={scatterUnit}
              onChange={setScatterUnit}
              options={(['subcategory', 'product', 'country'] as ScatterUnit[]).map((u) => ({
                value: u,
                label: SCATTER_LABEL[u],
              }))}
            />
          }
        >
          <DiscountScatter
            points={scatter}
            height={236}
            unitLabel={SCATTER_LABEL[scatterUnit].toLowerCase()}
            selected={
              scatterUnit === 'subcategory'
                ? filters.subcategory
                : scatterUnit === 'product'
                  ? filters.product
                  : filters.country
            }
            onSelect={(k) => toggle(scatterUnit, k, 'Discount scatter')}
          />
          <DiscountImpactStrip tiers={tiers} impact={impact} />
        </Card>

        <Card
          title={rankMode === 'top' ? 'Best sellers' : 'Underperformers'}
          span="rank"
          subtitle="3+ order lines"
          info={
            <InfoDot label="About this ranking">
              Best sellers rank by revenue; underperformers rank by profit, ascending, so the
              biggest losses surface first. Products with fewer than 3 order lines are excluded —
              the median product in this workbook has only 10 lines, and singletons make a
              meaningless ranking.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Ranking"
              value={rankMode}
              onChange={setRankMode}
              options={[
                { value: 'top', label: 'Top sellers' },
                { value: 'under', label: 'Underperformers' },
              ]}
            />
          }
        >
          <RankedBars
            data={ranked}
            formatValue={usdShort}
            selected={filters.product}
            onSelect={(k) => toggle('product', k, 'Product ranking')}
            onOpenDetail={(k) => onOpenDetail({ kind: 'product', key: k })}
            emptyMessage="No product in this filter has enough order lines to rank."
          />
        </Card>

        <Card
          title="Profit by country and category"
          span="heat"
          subtitle={`Top ${heatRows.length} countries`}
          info={
            <InfoDot label="About this matrix">
              Profit contribution, coloured on a diverging scale anchored at zero so losses read
              as losses rather than as weaker gains. Click a country or category to filter; use
              the sort control in a column header to rank countries by that category.
            </InfoDot>
          }
        >
          <Heatmap
            rows={heatRows}
            cols={heatCols}
            cells={heatCells}
            formatValue={usdShort}
            selectedRows={filters.country}
            selectedCols={filters.category}
            onSelectRow={(k) => toggle('country', k, 'Profit matrix')}
            onSelectCol={(k) => toggle('category', k, 'Profit matrix')}
            onSelectCell={(r) => onOpenDetail({ kind: 'country', key: r })}
          />
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function scopeToDrill(
  ds: Dataset,
  rows: Int32Array,
  path: { level: string; key: number }[],
): Int32Array {
  if (path.length === 0) return rows;
  const f = ds.facts;
  const out = new Int32Array(rows.length);
  let k = 0;
  outer: for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    for (const step of path) {
      if (step.level === 'category') {
        if (ds.dims.subToCategory[f.subcategory[i]] !== step.key) continue outer;
      } else if (step.level === 'subcategory') {
        if (f.subcategory[i] !== step.key) continue outer;
      } else if (f.product[i] !== step.key) continue outer;
    }
    out[k++] = i;
  }
  return out.subarray(0, k);
}

/**
 * Top countries by absolute profit contribution against every category.
 * Limited to what fits a readable matrix — 164 countries would be a wall.
 */
function buildProfitMatrix(
  ds: Dataset,
  rows: Int32Array,
  countries: Breakdown[],
  categories: Breakdown[],
): { rows: HeatmapAxis[]; cols: HeatmapAxis[]; cells: HeatmapCell[] } {
  const top = [...countries]
    .sort((a, b) => Math.abs(b.current.profit) - Math.abs(a.current.profit))
    .slice(0, 12);
  const topKeys = new Set(top.map((c) => c.key));

  const nCat = ds.dims.categories.length;
  const idx = new Map(top.map((c, i) => [c.key, i]));
  const grid = new Float64Array(top.length * nCat);
  const salesGrid = new Float64Array(top.length * nCat);
  const lineGrid = new Float64Array(top.length * nCat);

  const f = ds.facts;
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    if (!topKeys.has(f.country[i])) continue;
    const r = idx.get(f.country[i]);
    if (r === undefined) continue;
    const c = ds.dims.subToCategory[f.subcategory[i]];
    const cell = r * nCat + c;
    grid[cell] += f.profitCents[i] / 100;
    salesGrid[cell] += f.sales[i];
    lineGrid[cell] += 1;
  }

  const cells: HeatmapCell[] = [];
  for (const [key, r] of idx) {
    for (let c = 0; c < nCat; c++) {
      const cell = r * nCat + c;
      if (lineGrid[cell] === 0) continue;
      const profit = grid[cell];
      const sales = salesGrid[cell];
      cells.push({
        row: key,
        col: c,
        value: profit,
        tooltip: {
          title: `${ds.dims.countries[key].name} · ${ds.dims.categories[c]}`,
          subtitle: `${int(lineGrid[cell])} order lines`,
          rows: [
            { label: 'Profit', value: usd(profit), strong: true },
            { label: 'Revenue', value: usd(sales) },
            { label: 'Margin', value: pct(sales > 0 ? profit / sales : null) },
          ],
          status: {
            level:
              sales > 0 && profit / sales >= BUSINESS_TARGETS.profitMargin
                ? ('on-target' as const)
                : profit >= 0
                  ? ('at-risk' as const)
                  : ('off-target' as const),
            label:
              profit < 0
                ? 'Loss-making in this country'
                : sales > 0 && profit / sales >= BUSINESS_TARGETS.profitMargin
                  ? `Clears the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
                  : `Under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`,
          },
          hint: 'Click for country detail',
        },
      });
    }
  }

  return {
    rows: top.map((c) => ({ key: c.key, label: c.label, total: c.current.profit })),
    cols: categories.map((c) => ({ key: c.key, label: c.label, total: c.current.profit })),
    cells,
  };
}

function DiscountImpactStrip({
  tiers,
  impact,
}: {
  tiers: ReturnType<typeof buildMarginTiers>;
  impact: ReturnType<typeof buildDiscountImpact>;
}) {
  if (tiers.length === 0) return null;
  const worst = [...tiers].sort((a, b) => (a.headroom ?? 0) - (b.headroom ?? 0))[0];
  return (
    <div className="impact">
      <div className="impact__tiers">
        {tiers.map((t) => {
          const negative = (t.headroom ?? 0) < 0;
          return (
            <div key={t.tier} className="impact__tier">
              <span className="impact__tier-label num">{pct(t.tier, 0)}</span>
              <span className="label impact__tier-cap">breakeven</span>
              <span className={`impact__tier-val num ${negative ? 'val--neg' : 'val--pos'}`}>
                {pct(t.headroom)}
              </span>
              <span className="impact__tier-cap">headroom</span>
            </div>
          );
        })}
      </div>
      <p className="impact__note">
        <TriangleAlert size={12} aria-hidden />
        <span>
          <strong className="num">{usd(impact.profitLost)}</strong> of profit destroyed on{' '}
          <span className="num">{int(impact.lossLines)}</span> lines discounted past breakeven
          {worst && (worst.headroom ?? 0) < 0.08 ? (
            <>
              {' '}
              — the {pct(worst.tier, 0)} tier is thinnest, carrying {pct(worst.avgDiscount)} average
              discount
            </>
          ) : null}
          .
        </span>
      </p>
    </div>
  );
}

function Breadcrumb({
  path,
  onJump,
  onReset,
  rootLabel,
}: {
  path: string[];
  onJump: (i: number) => void;
  onReset: () => void;
  rootLabel: string;
}) {
  return (
    <nav className="crumbs" aria-label="Drill path">
      <button type="button" className="crumbs__item" onClick={onReset}>
        {rootLabel}
      </button>
      {path.map((label, i) => (
        <span key={`${label}-${i}`} className="crumbs__seg">
          <span className="crumbs__sep" aria-hidden>
            ›
          </span>
          <button
            type="button"
            className="crumbs__item"
            onClick={() => onJump(i)}
            aria-current={i === path.length - 1 ? 'true' : undefined}
          >
            {label}
          </button>
        </span>
      ))}
    </nav>
  );
}

