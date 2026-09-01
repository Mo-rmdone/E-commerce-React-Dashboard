import type { Breakdown, Dataset, MeasureSummary } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import type { PeriodComparison } from '@/data/transformations/filterRows';
import { EMPTY_SUMMARY, groupBy, growth } from './aggregate';

/** Dimensions the app can break results down by. */
export type BreakdownDimension =
  | 'market'
  | 'region'
  | 'country'
  | 'segment'
  | 'category'
  | 'subcategory'
  | 'product'
  | 'customer';

interface DimensionAccess {
  size: number;
  keyOf: (i: number) => number;
  label: (k: number) => string;
}

export function dimensionAccess(ds: Dataset, d: BreakdownDimension): DimensionAccess {
  const f = ds.facts;
  const dims = ds.dims;
  switch (d) {
    case 'market':
      return { size: dims.markets.length, keyOf: (i) => f.market[i], label: (k) => dims.markets[k] };
    case 'region':
      return { size: dims.regions.length, keyOf: (i) => f.region[i], label: (k) => dims.regions[k] };
    case 'country':
      return {
        size: dims.countries.length,
        keyOf: (i) => f.country[i],
        label: (k) => dims.countries[k].name,
      };
    case 'segment':
      return {
        size: dims.segments.length,
        keyOf: (i) => f.segment[i],
        label: (k) => dims.segments[k],
      };
    case 'category':
      return {
        size: dims.categories.length,
        keyOf: (i) => dims.subToCategory[f.subcategory[i]],
        label: (k) => dims.categories[k],
      };
    case 'subcategory':
      return {
        size: dims.subcategories.length,
        keyOf: (i) => f.subcategory[i],
        label: (k) => dims.subcategories[k].name,
      };
    case 'product':
      return {
        size: dims.products.length,
        keyOf: (i) => f.product[i],
        label: (k) => dims.products[k].name,
      };
    case 'customer':
      return {
        size: dims.customers.length,
        keyOf: (i) => f.customer[i],
        label: (k) => dims.customers[k],
      };
  }
}

/**
 * Revenue on the reporting basis. Every chart routes through this rather than
 * reading `sales` directly, so the definition lives in exactly one place.
 */
export function revenue(m: MeasureSummary, _basis: RevenueBasis): number {
  return m.sales;
}

export function margin(m: MeasureSummary, _basis: RevenueBasis): number | null {
  return m.grossMargin;
}

export interface BuildBreakdownOptions {
  distinct?: boolean;
  basis?: RevenueBasis;
  /** Drop members with no activity in the current period. */
  dropEmpty?: boolean;
  /** Sort descending by revenue on the active basis. */
  sort?: boolean;
}

/**
 * Group the filtered rows by a dimension, and attach each member's annual
 * growth from the year comparison.
 *
 * `current` describes the whole filtered window; `growth` compares the latest
 * year against the one before it. Keeping those separate is what lets a card
 * show a four-year total beside an honest annual growth rate.
 */
export function buildBreakdown(
  ds: Dataset,
  rows: Int32Array,
  comparison: PeriodComparison | null,
  dimension: BreakdownDimension,
  opts: BuildBreakdownOptions = {},
): Breakdown[] {
  const { distinct = false, basis = 'gross', dropEmpty = true, sort = true } = opts;
  const access = dimensionAccess(ds, dimension);

  const current = groupBy(ds, rows, access.size, access.keyOf, { distinct });

  const canCompare = comparison?.priorRows != null;
  const growthCurrent = canCompare
    ? groupBy(ds, comparison!.currentRows, access.size, access.keyOf)
    : null;
  const growthPrior = canCompare
    ? groupBy(ds, comparison!.priorRows!, access.size, access.keyOf)
    : null;

  const out: Breakdown[] = [];
  for (let k = 0; k < access.size; k++) {
    const c = current[k];
    if (dropEmpty && c.lines === 0) continue;
    const p = growthPrior ? growthPrior[k] : null;
    out.push({
      key: k,
      label: access.label(k),
      current: c,
      latest: growthCurrent ? growthCurrent[k] : null,
      prior: p,
      growth:
        growthCurrent && p && p.lines > 0
          ? growth(revenue(growthCurrent[k], basis), revenue(p, basis))
          : null,
    });
  }

  if (sort) out.sort((a, b) => revenue(b.current, basis) - revenue(a.current, basis));
  return out;
}

/** Rank lookup by dimension key, for "#3 of 164" style context in tooltips. */
export function rankMap(items: Breakdown[]): Map<number, number> {
  const m = new Map<number, number>();
  items.forEach((b, i) => m.set(b.key, i + 1));
  return m;
}

export function findBreakdown(items: Breakdown[], key: number): Breakdown | undefined {
  return items.find((b) => b.key === key);
}

export const EMPTY_BREAKDOWN: Breakdown = {
  key: -1,
  label: '',
  current: EMPTY_SUMMARY,
  latest: null,
  prior: null,
  growth: null,
};
