import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { Breakdown, Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { useDashboardData, useBreakdown } from '@/hooks/useDashboardData';
import { filterRows } from '@/data/transformations/filterRows';
import { useFilters } from '@/hooks/useFilters';
import type { DrillthroughEntity } from '@/hooks/useDrilldown';
import { dimensionAccess, margin, revenue } from '@/data/metrics/breakdowns';
import {
  buildDiscountImpact,
  buildDiscountScatter,
  buildMarginTiers,
} from '@/data/metrics/discount';
import { Card, EmptyState, Segmented } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import type { TreeMetric } from '@/components/charts/DecompositionTree';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { DiscountScatter } from '@/components/charts/DiscountScatter';
import { LeaderboardTable, type LeaderRow } from '@/components/tables/LeaderboardTable';
import { Heatmap, type HeatmapAxis, type HeatmapCell } from '@/components/charts/Heatmap';
import { categorical } from '@/config/theme';
import { int, pct, pctSigned, usd, usdShort } from '@/utils/format';
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

  const [treeMetric, setTreeMetric] = useState<TreeMetric>('sales');
  const [rankMode, setRankMode] = useState<RankMode>('top');
  const [scatterUnit, setScatterUnit] = useState<ScatterUnit>('subcategory');
  const [countryMode, setCountryMode] = useState<'top' | 'bottom'>('top');
  const [countryPage, setCountryPage] = useState(0);

  const palette = categorical();
  const categories = useBreakdown(ds, data, 'category');
  const countries = useBreakdown(ds, data, 'country');

  // The tree reads rows filtered by every dimension EXCEPT its own three, so a
  // click that filters the page to one category still leaves the other
  // categories standing in the tree rather than collapsing it to a single row.
  const treeRows = useMemo(
    () => filterRows(ds, { ...filters, category: [], subcategory: [], product: [] }),
    [ds, filters],
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

  const leaders = useMemo<LeaderRow[]>(() => {
    const pool = products.filter((p) => p.current.lines >= 3);
    const sorted =
      rankMode === 'top'
        ? [...pool].sort((a, b) => revenue(b.current, basis) - revenue(a.current, basis))
        : [...pool].sort((a, b) => a.current.profit - b.current.profit);

    // Top mode ranks and sizes on revenue; underperformers on the size of the
    // loss, so the worst offender leads and the bar reads as "how bad". The
    // whole ranked pool is returned so the card's search can reach any product;
    // the table caps the view at the top eight of whatever the search leaves.
    const magnitude = (p: (typeof sorted)[number]) =>
      rankMode === 'top' ? revenue(p.current, basis) : Math.abs(Math.min(0, p.current.profit));
    const maxMag = Math.max(1, ...sorted.map(magnitude));

    return sorted.map((p) => {
      const m = margin(p.current, basis);
      const marginTxt =
        m === null
          ? '—'
          : `${pct(m)} margin${m < BUSINESS_TARGETS.profitMargin ? ' · below target' : ''}`;
      return {
        key: p.key,
        name: p.label,
        initials: initialsOf(p.label),
        subtitle: `${marginTxt} · ${int(p.current.lines)} lines`,
        valueLabel: rankMode === 'top' ? usdShort(revenue(p.current, basis)) : usdShort(p.current.profit),
        valueNegative: rankMode === 'under' && p.current.profit < 0,
        barPct: magnitude(p) / maxMag,
        delta: p.growth,
        deltaLabel: p.growth === null ? '' : pctSigned(p.growth, 1),
      };
    });
  }, [products, rankMode, basis]);

  const matrix = useMemo(
    () => buildProfitMatrix(ds, data.rows, countries, categories),
    [ds, data.rows, countries, categories],
  );

  // Ten countries a page. "Top" reads the profit ranking as built (descending);
  // "bottom" reverses it so the biggest losses lead. The colour scale stays
  // fixed across pages because every cell is handed to the heatmap — only the
  // visible rows change.
  const COUNTRIES_PER_PAGE = 10;
  const sortedHeatRows = useMemo(
    () => (countryMode === 'top' ? matrix.rows : [...matrix.rows].reverse()),
    [matrix.rows, countryMode],
  );
  const heatPageCount = Math.max(1, Math.ceil(sortedHeatRows.length / COUNTRIES_PER_PAGE));

  // Reset to the first page whenever the ranking or the filtered data changes.
  useEffect(() => {
    setCountryPage(0);
  }, [countryMode, matrix.rows]);
  const heatPage = Math.min(countryPage, heatPageCount - 1);

  const heatRows = sortedHeatRows.slice(
    heatPage * COUNTRIES_PER_PAGE,
    heatPage * COUNTRIES_PER_PAGE + COUNTRIES_PER_PAGE,
  );
  const heatCols = matrix.cols;
  const heatCells = matrix.cells;
  const heatRangeLabel =
    sortedHeatRows.length === 0
      ? ''
      : `${heatPage * COUNTRIES_PER_PAGE + 1}–${Math.min(
          sortedHeatRows.length,
          (heatPage + 1) * COUNTRIES_PER_PAGE,
        )} of ${sortedHeatRows.length}`;

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
          title="Category ranking"
          span="tree"
          subtitle="All subcategories, ranked within each category"
          info={
            <InfoDot label="About this chart">
              Every subcategory at once, banded by category and ranked within, on one shared axis
              so a bar in one category compares directly to another. The value past each bar is
              its share of the total, so you read the ranking and the part-to-whole together. On
              Sales bars run from zero, coloured by category; on Profit they diverge from a zero
              line — green right for a gain, red left for a loss. Click a category or subcategory
              to filter the page.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Metric"
              value={treeMetric}
              onChange={setTreeMetric}
              options={[
                { value: 'sales', label: 'Sales' },
                { value: 'profit', label: 'Profit' },
              ]}
            />
          }
        >
          <CategoryBars
            ds={ds}
            rows={treeRows}
            metric={treeMetric}
            palette={palette}
            selectedCategories={filters.category}
            selectedSubcategories={filters.subcategory}
            onToggleCategory={(k) => toggle('category', k, 'Category bars')}
            onToggleSubcategory={(k) => toggle('subcategory', k, 'Category bars')}
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
          <LeaderboardTable
            rows={leaders}
            headerRight="vs prior year"
            selected={filters.product}
            onSelect={(k) => toggle('product', k, 'Product leaderboard')}
            onOpen={(k) => onOpenDetail({ kind: 'product', key: k })}
            emptyMessage="No product in this filter has enough order lines to rank."
            search={(r) => r.name}
            searchPlaceholder="Search products…"
            maxRows={8}
          />
        </Card>

        <Card
          title="Profit by country and category"
          span="heat"
          subtitle="Profit contribution · 10 per page"
          info={
            <InfoDot label="About this matrix">
              Profit contribution, coloured on a diverging scale anchored at zero so losses read
              as losses rather than as weaker gains. Countries are ranked by total profit, ten to
              a page; switch to Bottom 10 to lead with the biggest losses. Click a country or
              category to filter; use the sort control in a column header to rank the visible page
              by that category.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Country ranking"
              value={countryMode}
              onChange={(m) => setCountryMode(m)}
              options={[
                { value: 'top', label: 'Top 10' },
                { value: 'bottom', label: 'Bottom 10' },
              ]}
            />
          }
        >
          <Heatmap
            rows={heatRows}
            cols={heatCols}
            cells={heatCells}
            page={heatPage}
            pageCount={heatPageCount}
            rangeLabel={heatRangeLabel}
            onPage={setCountryPage}
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


/** Two-letter monogram from a product name for the leaderboard chip. */
function initialsOf(name: string): string {
  const words = name.split(/[\s-]+/).filter(Boolean);
  const a = words[0]?.[0] ?? '?';
  const b = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return (a + b).toUpperCase();
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
  // Every trading country, ranked by total profit. Paging happens in the page;
  // the whole matrix is built once so the colour scale is stable across pages.
  const ranked = [...countries].sort((a, b) => b.current.profit - a.current.profit);
  const nCat = ds.dims.categories.length;
  const idx = new Map(ranked.map((c, i) => [c.key, i]));
  const grid = new Float64Array(ranked.length * nCat);
  const salesGrid = new Float64Array(ranked.length * nCat);
  const lineGrid = new Float64Array(ranked.length * nCat);

  const f = ds.facts;
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
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
    rows: ranked.map((c) => ({ key: c.key, label: c.label, total: c.current.profit })),
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


