import type { Dataset, FilterDimension, FilterState } from '@/types';

export const FILTER_DIMENSIONS: FilterDimension[] = [
  'year',
  'market',
  'region',
  'country',
  'segment',
  'category',
  'subcategory',
  'product',
];

export function emptyFilters(): FilterState {
  return {
    year: [],
    market: [],
    region: [],
    country: [],
    segment: [],
    category: [],
    subcategory: [],
    product: [],
  };
}

export function countActiveFilters(f: FilterState): number {
  return FILTER_DIMENSIONS.reduce((n, d) => n + (f[d].length > 0 ? 1 : 0), 0);
}

export function hasAnyFilter(f: FilterState): boolean {
  return FILTER_DIMENSIONS.some((d) => f[d].length > 0);
}

/** Build a 0/1 lookup so membership tests are an array read, not an includes(). */
function maskOf(values: number[], size: number): Uint8Array | null {
  if (values.length === 0) return null;
  const m = new Uint8Array(size);
  for (const v of values) if (v >= 0 && v < size) m[v] = 1;
  return m;
}

/**
 * Reduce the fact table to the rows matching every active filter.
 *
 * Filters combine as AND across dimensions and OR within a dimension, which is
 * what a BI user expects: picking two markets widens, adding a segment narrows.
 *
 * Returns row indices rather than copied rows — nothing is duplicated, and the
 * result feeds straight into the aggregation pass.
 */
export function filterRows(ds: Dataset, f: FilterState): Int32Array {
  const { facts, dims, rowCount } = ds;

  const yearSet = f.year.length ? new Set(f.year) : null;
  const mMarket = maskOf(f.market, dims.markets.length);
  const mRegion = maskOf(f.region, dims.regions.length);
  const mCountry = maskOf(f.country, dims.countries.length);
  const mSegment = maskOf(f.segment, dims.segments.length);
  const mSub = maskOf(f.subcategory, dims.subcategories.length);
  const mProduct = maskOf(f.product, dims.products.length);

  // Category is not stored on the fact row; it resolves through subcategory,
  // the one product-hierarchy edge the audit found to be clean.
  let mSubFromCategory: Uint8Array | null = null;
  if (f.category.length) {
    const cats = new Set(f.category);
    mSubFromCategory = new Uint8Array(dims.subcategories.length);
    for (let s = 0; s < dims.subcategories.length; s++) {
      if (cats.has(dims.subToCategory[s])) mSubFromCategory[s] = 1;
    }
  }

  const out = new Int32Array(rowCount);
  let k = 0;

  for (let i = 0; i < rowCount; i++) {
    if (yearSet && !yearSet.has(facts.year[i])) continue;
    if (mMarket && !mMarket[facts.market[i]]) continue;
    if (mRegion && !mRegion[facts.region[i]]) continue;
    if (mCountry && !mCountry[facts.country[i]]) continue;
    if (mSegment && !mSegment[facts.segment[i]]) continue;
    if (mSub && !mSub[facts.subcategory[i]]) continue;
    if (mSubFromCategory && !mSubFromCategory[facts.subcategory[i]]) continue;
    if (mProduct && !mProduct[facts.product[i]]) continue;
    out[k++] = i;
  }

  return out.subarray(0, k);
}

/**
 * The year-over-year comparison every growth figure in the app is measured on.
 *
 * All four business targets are annual, so growth is anchored to the latest
 * year that actually has data inside the filter, against the year before it —
 * holding every other filter constant. Comparing a whole multi-year window
 * against an equivalent earlier window would leave the default "all years" view
 * with nothing to compare against, and comparing a 4-year total to a 1-year
 * total would be worse: it would produce a number that looks like growth and
 * is not.
 *
 * `currentRows` is therefore a subset of `rows`, not the whole window, and the
 * UI labels every growth figure with the two years being compared.
 */
export interface PeriodComparison {
  latestYear: number;
  priorYear: number | null;
  /** Rows for `latestYear` inside the active filter. */
  currentRows: Int32Array;
  /** Rows for `priorYear` inside the active filter, or null if it has none. */
  priorRows: Int32Array | null;
}

export function yearComparison(
  ds: Dataset,
  f: FilterState,
  rows: Int32Array,
): PeriodComparison | null {
  if (rows.length === 0) return null;

  let latestYear = -Infinity;
  for (let k = 0; k < rows.length; k++) {
    const y = ds.facts.year[rows[k]];
    if (y > latestYear) latestYear = y;
  }
  if (!Number.isFinite(latestYear)) return null;

  const currentRows = rowsForYear(ds, rows, latestYear);
  const priorYear = latestYear - 1;
  if (!ds.dims.years.includes(priorYear)) {
    return { latestYear, priorYear: null, currentRows, priorRows: null };
  }

  const priorRows = filterRows(ds, { ...f, year: [priorYear] });
  return {
    latestYear,
    priorYear: priorRows.length > 0 ? priorYear : null,
    currentRows,
    priorRows: priorRows.length > 0 ? priorRows : null,
  };
}

export function rowsForYear(ds: Dataset, rows: Int32Array, year: number): Int32Array {
  const out = new Int32Array(rows.length);
  let k = 0;
  for (let j = 0; j < rows.length; j++) {
    if (ds.facts.year[rows[j]] === year) out[k++] = rows[j];
  }
  return out.subarray(0, k);
}

/** Toggle one member of a dimension, preserving everything else. */
export function toggleFilter(
  f: FilterState,
  dimension: FilterDimension,
  value: number,
  mode: 'toggle' | 'replace' = 'toggle',
): FilterState {
  const current = f[dimension];
  if (mode === 'replace') {
    const only = current.length === 1 && current[0] === value;
    return { ...f, [dimension]: only ? [] : [value] };
  }
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return { ...f, [dimension]: next };
}

export function clearDimension(f: FilterState, dimension: FilterDimension): FilterState {
  return { ...f, [dimension]: [] };
}
