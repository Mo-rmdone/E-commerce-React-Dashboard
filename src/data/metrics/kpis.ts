import type { Breakdown, Dataset, MeasureSummary } from '@/types';
import {
  BUSINESS_TARGETS,
  gradeAgainstTarget,
  type RevenueBasis,
  type StatusLevel,
} from '@/config/targets';
import { rowsForYear, type PeriodComparison } from '@/data/transformations/filterRows';
import { growth, summarize } from './aggregate';
import { buildBreakdown, margin, revenue } from './breakdowns';

export interface Kpi {
  id: 'revenue' | 'margin' | 'corporate' | 'markets';
  label: string;
  /** Formatted by the presentation layer — metrics stay numeric. */
  value: number | null;
  /** Secondary figure shown under the value (e.g. YoY for revenue). */
  delta: number | null;
  deltaLabel: string | null;
  target: number;
  targetLabel: string;
  /** Signed distance from target, in the same unit as `target`. */
  variance: number | null;
  status: StatusLevel;
  /** One line explaining what the number means, shown on the card's info. */
  help: string;
  /** Sparkline series, one value per year in the filtered window. */
  spark: number[];
}

export interface KpiContext {
  ds: Dataset;
  rows: Int32Array;
  /** The annual comparison every growth figure is measured on. */
  comparison: PeriodComparison | null;
  basis: RevenueBasis;
  /** Measures across the whole filtered window. */
  summary: MeasureSummary;
  /** Measures for the latest year in the window — the growth numerator. */
  latestYearSummary: MeasureSummary | null;
  /** Measures for the year before it — the growth denominator. */
  priorYearSummary: MeasureSummary | null;
  yearSeries: { year: number; measures: MeasureSummary }[];
  markets: Breakdown[];
  segments: Breakdown[];
  /** Sales per market per year, used for the $400K viability test. */
  marketYear: { market: number; year: number; sales: number }[];
}

/** The Corporate segment index, resolved by name rather than assumed position. */
export function corporateSegmentIndex(ds: Dataset): number {
  return ds.dims.segments.findIndex((s) => s.toLowerCase() === 'corporate');
}

/**
 * Markets clearing the annual sales threshold.
 *
 * Measured per market per year, then reported for the most recent year in the
 * filtered window — an annual target is meaningless against a multi-year total.
 */
export function marketsOnTarget(
  ctx: KpiContext,
): { year: number | null; onTarget: number; total: number; priorOnTarget: number | null } {
  const years = [...new Set(ctx.marketYear.map((m) => m.year))].sort((a, b) => a - b);
  if (years.length === 0) return { year: null, onTarget: 0, total: 0, priorOnTarget: null };

  const latest = years[years.length - 1];
  const prior = years.length > 1 ? years[years.length - 2] : null;
  const inYear = (y: number) => ctx.marketYear.filter((m) => m.year === y);

  const cur = inYear(latest);
  return {
    year: latest,
    onTarget: cur.filter((m) => m.sales >= BUSINESS_TARGETS.marketSalesThreshold).length,
    total: cur.length,
    priorOnTarget: prior
      ? inYear(prior).filter((m) => m.sales >= BUSINESS_TARGETS.marketSalesThreshold).length
      : null,
  };
}

/**
 * Build the executive KPI row.
 *
 * Growth KPIs need a full prior year to compare against. When the filter leaves
 * none, the KPI returns null rather than inventing a baseline.
 */
export function buildKpis(ctx: KpiContext): Kpi[] {
  const { basis, summary, latestYearSummary, priorYearSummary, yearSeries, comparison } = ctx;
  const T = BUSINESS_TARGETS;

  // Growth is annual by definition, so it compares the latest year in the
  // window against the one before it rather than the window against itself.
  const yoy =
    latestYearSummary && priorYearSummary
      ? growth(revenue(latestYearSummary, basis), revenue(priorYearSummary, basis))
      : null;
  const compareLabel =
    comparison?.priorYear != null
      ? `${comparison.latestYear} vs ${comparison.priorYear}`
      : null;
  const marginNow = margin(summary, basis);
  const latestMargin = latestYearSummary ? margin(latestYearSummary, basis) : null;
  const priorMargin = priorYearSummary ? margin(priorYearSummary, basis) : null;

  const corp = corporateSegmentIndex(ctx.ds);
  const corpRow = ctx.segments.find((s) => s.key === corp) ?? null;
  const corpGrowth = corpRow?.growth ?? null;

  const mk = marketsOnTarget(ctx);
  const marketShare = mk.total > 0 ? mk.onTarget / mk.total : null;

  const sparkRevenue = yearSeries.map((y) => revenue(y.measures, basis));
  const sparkMargin = yearSeries.map((y) => margin(y.measures, basis) ?? 0);

  return [
    {
      id: 'revenue',
      label: 'Revenue',
      value: revenue(summary, basis),
      delta: yoy,
      deltaLabel: compareLabel,
      target: T.revenueGrowth,
      targetLabel: `Growth target ${pct(T.revenueGrowth)}`,
      variance: yoy === null ? null : yoy - T.revenueGrowth,
      status: gradeAgainstTarget(yoy, T.revenueGrowth),
      help:
        yoy === null
          ? 'Growth needs two consecutive years inside the current filter. Widen the year filter to compare.'
          : `Total ${basis} revenue in view. Growth is annual: ${compareLabel}, against the ${pct(T.revenueGrowth)} target.`,
      spark: sparkRevenue,
    },
    {
      id: 'margin',
      label: 'Profit margin',
      value: marginNow,
      delta:
        latestMargin !== null && priorMargin !== null ? latestMargin - priorMargin : null,
      deltaLabel: compareLabel,
      target: T.profitMargin,
      targetLabel: `Target ${pct(T.profitMargin)}`,
      variance: marginNow === null ? null : marginNow - T.profitMargin,
      status: gradeAgainstTarget(marginNow, T.profitMargin),
      help: `Profit divided by ${basis} revenue across the whole window. The change shown is annual (${
        compareLabel ?? 'no prior year'
      }). The workbook carries no cost field, so margin moves only with discount and mix.`,
      spark: sparkMargin,
    },
    {
      id: 'corporate',
      label: 'Corporate growth',
      value: corpGrowth,
      // The value already is the growth rate, so there is no second delta to
      // show — only the label saying which years it compares.
      delta: null,
      deltaLabel: corpGrowth === null ? null : compareLabel,
      target: T.corporateGrowth,
      targetLabel: `Target ${pct(T.corporateGrowth)}`,
      variance: corpGrowth === null ? null : corpGrowth - T.corporateGrowth,
      status: gradeAgainstTarget(corpGrowth, T.corporateGrowth),
      help:
        corp < 0
          ? 'No Corporate segment exists in the filtered data.'
          : `Annual ${basis} revenue growth for the Corporate segment (${
              compareLabel ?? 'no prior year'
            }) against its ${pct(T.corporateGrowth)} target.`,
      spark: [],
    },
    {
      id: 'markets',
      label: 'Markets on target',
      value: marketShare,
      delta:
        mk.priorOnTarget === null ? null : mk.onTarget - mk.priorOnTarget,
      deltaLabel: mk.priorOnTarget === null ? null : 'vs prior year',
      target: 1,
      targetLabel: `${fmtUsdShort(T.marketSalesThreshold)} each`,
      variance: marketShare === null ? null : marketShare - 1,
      status:
        mk.total === 0
          ? 'neutral'
          : mk.onTarget === mk.total
            ? 'on-target'
            : mk.onTarget >= mk.total * 0.6
              ? 'at-risk'
              : 'off-target',
      help: mk.year
        ? `Markets clearing ${fmtUsdShort(T.marketSalesThreshold)} of annual sales in ${mk.year}, the latest full year in view.`
        : 'No market activity in the current filter.',
      spark: [],
    },
  ];
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtUsdShort(v: number): string {
  return v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`;
}

/**
 * Assemble everything the KPI row and the alert engine need, in one pass over
 * the filtered rows. Pages call this once and share the result.
 */
export function buildKpiContext(
  ds: Dataset,
  rows: Int32Array,
  comparison: PeriodComparison | null,
  basis: RevenueBasis,
): KpiContext {
  const summary = summarize(ds, rows, { distinct: true });
  const latestYearSummary = comparison ? summarize(ds, comparison.currentRows) : null;
  const priorYearSummary = comparison?.priorRows
    ? summarize(ds, comparison.priorRows)
    : null;

  const markets = buildBreakdown(ds, rows, comparison, 'market', { basis });
  const segments = buildBreakdown(ds, rows, comparison, 'segment', { basis });

  // Sales per market per year — the $400K test is annual by definition, and it
  // follows the active revenue basis so the whole page speaks one language. On
  // net revenue a market clears the bar only on what customers actually paid.
  const marketYear: { market: number; year: number; sales: number }[] = [];
  const yearIndex = new Map(ds.dims.years.map((y, i) => [y, i]));
  const nY = ds.dims.years.length;
  const nM = ds.dims.markets.length;
  const grid = new Float64Array(nM * nY);
  const touched = new Uint8Array(nM * nY);
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const yi = yearIndex.get(ds.facts.year[i]);
    if (yi === undefined) continue;
    const cell = ds.facts.market[i] * nY + yi;
    grid[cell] += ds.facts.sales[i];
    touched[cell] = 1;
  }
  for (let m = 0; m < nM; m++) {
    for (let y = 0; y < nY; y++) {
      if (touched[m * nY + y]) {
        marketYear.push({ market: m, year: ds.dims.years[y], sales: grid[m * nY + y] });
      }
    }
  }

  const yearSeries = ds.dims.years
    .map((year) => {
      const yr = rowsForYear(ds, rows, year);
      return { year, measures: summarize(ds, yr) };
    })
    .filter((y) => y.measures.lines > 0);

  return {
    ds,
    rows,
    comparison,
    basis,
    summary,
    latestYearSummary,
    priorYearSummary,
    yearSeries,
    markets,
    segments,
    marketYear,
  };
}
