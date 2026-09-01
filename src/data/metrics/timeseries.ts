import type { Dataset, MeasureSummary } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import { groupBy, growth } from './aggregate';
import { revenue } from './breakdowns';

/**
 * Time grains the workbook genuinely supports.
 *
 * Day-of-week is deliberately absent: order dates were synthesised and the
 * weekday distribution is degenerate (990 Thursdays against 9,348 Tuesdays),
 * so a weekday visual would show an artefact, not a business pattern.
 */
export type TimeGrain = 'year' | 'quarter' | 'month';

export const TIME_GRAIN_LABEL: Record<TimeGrain, string> = {
  year: 'Year',
  quarter: 'Quarter',
  month: 'Month',
};

export interface TimePoint {
  /** Sortable bucket key, e.g. "2023", "2023-Q2", "2023-05". */
  key: string;
  label: string;
  /** Midpoint timestamp, for a real time scale rather than an ordinal one. */
  t: number;
  measures: MeasureSummary;
  /** Growth against the equivalent bucket one year earlier. */
  yoy: number | null;
}

interface Bucket {
  key: string;
  label: string;
  t: number;
}

const QUARTER_MONTH: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 };
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Build the bucket universe for a grain across the dataset's whole span, so a
 * filtered view still renders an unbroken axis with genuine zero periods rather
 * than silently closing the gap.
 */
function buildBuckets(ds: Dataset, grain: TimeGrain): {
  buckets: Bucket[];
  indexOf: (rowIndex: number) => number;
} {
  const f = ds.facts;
  const years = ds.dims.years;

  if (grain === 'year') {
    const buckets = years.map((y) => ({
      key: String(y),
      label: String(y),
      t: Date.UTC(y, 6, 1),
    }));
    const pos = new Map(years.map((y, i) => [y, i]));
    return { buckets, indexOf: (i) => pos.get(f.year[i]) ?? -1 };
  }

  if (grain === 'quarter') {
    const buckets: Bucket[] = [];
    const pos = new Map<number, number>();
    for (const y of years) {
      for (let q = 1; q <= 4; q++) {
        pos.set(y * 10 + q, buckets.length);
        buckets.push({
          key: `${y}-Q${q}`,
          label: `Q${q} ${y}`,
          t: Date.UTC(y, QUARTER_MONTH[q] + 0, 15),
        });
      }
    }
    return {
      buckets,
      indexOf: (i) => pos.get(f.year[i] * 10 + f.quarter[i]) ?? -1,
    };
  }

  const buckets = ds.dims.months.map((key) => {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    return {
      key,
      label: `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`,
      t: Date.UTC(y, m - 1, 15),
    };
  });
  return { buckets, indexOf: (i) => f.monthIndex[i] };
}

/** How many buckets back sits the same period one year earlier. */
const YOY_OFFSET: Record<TimeGrain, number> = { year: 1, quarter: 4, month: 12 };

/**
 * Aggregate filtered rows into an evenly spaced series.
 * `rows` must already be filtered — the series never applies filters itself.
 */
export function buildTimeSeries(
  ds: Dataset,
  rows: Int32Array,
  grain: TimeGrain,
  basis: RevenueBasis = 'gross',
  opts: { distinct?: boolean } = {},
): TimePoint[] {
  const { buckets, indexOf } = buildBuckets(ds, grain);
  const grouped = groupBy(ds, rows, buckets.length, indexOf, {
    distinct: opts.distinct ?? false,
  });

  const offset = YOY_OFFSET[grain];
  return buckets.map((b, i) => {
    const prior = i - offset >= 0 ? grouped[i - offset] : null;
    return {
      key: b.key,
      label: b.label,
      t: b.t,
      measures: grouped[i],
      yoy:
        prior && prior.lines > 0
          ? growth(revenue(grouped[i], basis), revenue(prior, basis))
          : null,
    };
  });
}

/**
 * Trim leading and trailing empty buckets. A filtered market that only traded
 * from 2022 should start its axis there rather than showing two flat years,
 * but interior gaps are kept — a zero month inside a market's life is a fact.
 */
export function trimEmptyEdges(points: TimePoint[]): TimePoint[] {
  let start = 0;
  let end = points.length - 1;
  while (start <= end && points[start].measures.lines === 0) start++;
  while (end >= start && points[end].measures.lines === 0) end--;
  return start > end ? [] : points.slice(start, end + 1);
}
