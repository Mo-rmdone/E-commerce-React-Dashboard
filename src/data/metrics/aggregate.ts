import type { Dataset, MeasureSummary, Measures } from '@/types';

/**
 * All roll-ups in the application funnel through this file, so a metric means
 * exactly one thing everywhere it appears. Nothing here reads React state.
 */

export function emptyMeasures(): Measures {
  return {
    sales: 0,
    netSales: 0,
    profit: 0,
    quantity: 0,
    lines: 0,
    orders: 0,
    customers: 0,
    discountValue: 0,
    breakevenValue: 0,
    lossProfit: 0,
    lossLines: 0,
  };
}

/** Ratios are derived once, at the end, from summed numerators/denominators. */
export function finalize(m: Measures): MeasureSummary {
  return {
    ...m,
    grossMargin: m.sales > 0 ? m.profit / m.sales : null,
    netMargin: m.netSales > 0 ? m.profit / m.netSales : null,
    avgDiscount: m.sales > 0 ? m.discountValue / m.sales : null,
    avgBreakeven: m.sales > 0 ? m.breakevenValue / m.sales : null,
    avgOrderValue: m.orders > 0 ? m.sales / m.orders : null,
    lossShare: m.lines > 0 ? m.lossLines / m.lines : null,
  };
}

export const EMPTY_SUMMARY: MeasureSummary = finalize(emptyMeasures());

interface SummarizeOptions {
  /** Distinct order and customer counts require extra passes; opt in. */
  distinct?: boolean;
}

/** Roll a set of row indices into a single measure summary. */
export function summarize(
  ds: Dataset,
  rows: Int32Array,
  opts: SummarizeOptions = {},
): MeasureSummary {
  const f = ds.facts;
  const m = emptyMeasures();

  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const sales = f.sales[i];
    const disc = f.discountBp[i] / 10000;
    const profit = f.profitCents[i] / 100;

    m.sales += sales;
    m.netSales += sales * (1 - disc);
    m.profit += profit;
    m.quantity += f.quantity[i];
    m.discountValue += disc * sales;
    m.breakevenValue += (f.baseMarginBp[i] / 10000) * sales;
    if (profit < 0) {
      m.lossProfit += profit;
      m.lossLines++;
    }
  }
  m.lines = rows.length;

  if (opts.distinct) {
    m.orders = distinctCount(f.order, rows, ds.dims.orderCount);
    m.customers = distinctCount(f.customer, rows, ds.dims.customers.length);
  }

  return finalize(m);
}

function distinctCount(
  col: Int32Array | Int16Array,
  rows: Int32Array,
  domain: number,
): number {
  const seen = new Uint8Array(domain);
  let n = 0;
  for (let k = 0; k < rows.length; k++) {
    const v = col[rows[k]];
    if (!seen[v]) {
      seen[v] = 1;
      n++;
    }
  }
  return n;
}

/**
 * Group rows by an integer key column into `size` buckets.
 * `keyOf` lets callers group by something derived (a category via its
 * subcategory, a year, a discount band) without materialising a new column.
 */
export function groupBy(
  ds: Dataset,
  rows: Int32Array,
  size: number,
  keyOf: (rowIndex: number) => number,
  opts: SummarizeOptions = {},
): MeasureSummary[] {
  const f = ds.facts;

  const sales = new Float64Array(size);
  const netSales = new Float64Array(size);
  const profit = new Float64Array(size);
  const quantity = new Float64Array(size);
  const lines = new Float64Array(size);
  const discountValue = new Float64Array(size);
  const breakevenValue = new Float64Array(size);
  const lossProfit = new Float64Array(size);
  const lossLines = new Float64Array(size);

  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const g = keyOf(i);
    if (g < 0 || g >= size) continue;

    const s = f.sales[i];
    const d = f.discountBp[i] / 10000;
    const p = f.profitCents[i] / 100;

    sales[g] += s;
    netSales[g] += s * (1 - d);
    profit[g] += p;
    quantity[g] += f.quantity[i];
    lines[g] += 1;
    discountValue[g] += d * s;
    breakevenValue[g] += (f.baseMarginBp[i] / 10000) * s;
    if (p < 0) {
      lossProfit[g] += p;
      lossLines[g] += 1;
    }
  }

  const orders = new Float64Array(size);
  const customers = new Float64Array(size);
  if (opts.distinct) {
    countDistinctPerGroup(f.order, rows, size, keyOf, ds.dims.orderCount, orders);
    countDistinctPerGroup(
      f.customer,
      rows,
      size,
      keyOf,
      ds.dims.customers.length,
      customers,
    );
  }

  const out: MeasureSummary[] = new Array(size);
  for (let g = 0; g < size; g++) {
    out[g] = finalize({
      sales: sales[g],
      netSales: netSales[g],
      profit: profit[g],
      quantity: quantity[g],
      lines: lines[g],
      orders: orders[g],
      customers: customers[g],
      discountValue: discountValue[g],
      breakevenValue: breakevenValue[g],
      lossProfit: lossProfit[g],
      lossLines: lossLines[g],
    });
  }
  return out;
}

/**
 * Distinct-per-group without a Set per group.
 *
 * Rows are first bucketed so each group's rows sit contiguously, then a single
 * stamp array marks values as the group is walked. Bucketing is what makes the
 * stamp sound: without it, a value alternating between two groups would be
 * counted once per visit instead of once per group.
 */
function countDistinctPerGroup(
  col: Int32Array | Int16Array,
  rows: Int32Array,
  size: number,
  keyOf: (rowIndex: number) => number,
  domain: number,
  out: Float64Array,
): void {
  // Bucket offsets via a counting sort on the group key.
  const counts = new Int32Array(size + 1);
  for (let k = 0; k < rows.length; k++) {
    const g = keyOf(rows[k]);
    if (g >= 0 && g < size) counts[g + 1]++;
  }
  for (let g = 0; g < size; g++) counts[g + 1] += counts[g];

  const cursor = counts.slice(0, size);
  const ordered = new Int32Array(counts[size]);
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const g = keyOf(i);
    if (g >= 0 && g < size) ordered[cursor[g]++] = i;
  }

  const stamp = new Int32Array(domain).fill(-1);
  for (let g = 0; g < size; g++) {
    for (let p = counts[g]; p < counts[g + 1]; p++) {
      const v = col[ordered[p]];
      if (stamp[v] !== g) {
        stamp[v] = g;
        out[g] += 1;
      }
    }
  }
}

/** Sum a single measure across rows — for cheap one-number lookups. */
export function sumSales(ds: Dataset, rows: Int32Array): number {
  let t = 0;
  for (let k = 0; k < rows.length; k++) t += ds.facts.sales[rows[k]];
  return t;
}

/** Growth between two comparable periods. Null when there is no base to grow from. */
export function growth(current: number, prior: number | null | undefined): number | null {
  if (prior === null || prior === undefined || prior === 0 || !Number.isFinite(prior)) {
    return null;
  }
  return (current - prior) / Math.abs(prior);
}
