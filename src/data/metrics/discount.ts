import type { Dataset, MeasureSummary } from '@/types';
import { groupBy } from './aggregate';

/**
 * Discount analysis.
 *
 * Profit reconstructs exactly as Sales x (BaseMargin - Discount) on every row,
 * with BaseMargin one of four tiers carried by the order line. Discount is
 * therefore the only lever on margin, and every loss-making line is a line
 * discounted past its own breakeven. That makes this the sharpest analysis the
 * dataset supports — and none of it is estimated.
 */

export interface DiscountBand {
  key: number;
  label: string;
  lower: number;
  upper: number;
  measures: MeasureSummary;
}

/** Bands chosen to match how discounts actually cluster in the data. */
const BAND_EDGES = [0, 0.0001, 0.1, 0.2, 0.3, 0.4, 0.5, 1.01];
const BAND_LABELS = ['None', '0–10%', '10–20%', '20–30%', '30–40%', '40–50%', '50%+'];

export function discountBandOf(discount: number): number {
  for (let i = 1; i < BAND_EDGES.length; i++) {
    if (discount < BAND_EDGES[i]) return i - 1;
  }
  return BAND_EDGES.length - 2;
}

export function buildDiscountBands(ds: Dataset, rows: Int32Array): DiscountBand[] {
  const grouped = groupBy(ds, rows, BAND_LABELS.length, (i) =>
    discountBandOf(ds.facts.discountBp[i] / 10000),
  );
  return BAND_LABELS.map((label, k) => ({
    key: k,
    label,
    lower: BAND_EDGES[k],
    upper: BAND_EDGES[k + 1],
    measures: grouped[k],
  })).filter((b) => b.measures.lines > 0);
}

export interface MarginTier {
  /** Base margin as a rate, e.g. 0.4. This is also the breakeven discount. */
  tier: number;
  measures: MeasureSummary;
  /** Revenue-weighted discount actually applied to this tier. */
  avgDiscount: number | null;
  /** Headroom before the tier starts losing money. */
  headroom: number | null;
}

/**
 * Performance by margin tier. The gap between a tier's breakeven and the
 * discount applied to it is the single number that explains the loss book.
 */
export function buildMarginTiers(ds: Dataset, rows: Int32Array): MarginTier[] {
  const tiers = ds.dims.baseMarginTiers;
  const index = new Map(tiers.map((t, i) => [Math.round(t * 10000), i]));
  const grouped = groupBy(ds, rows, tiers.length, (i) => {
    const k = index.get(ds.facts.baseMarginBp[i]);
    return k === undefined ? -1 : k;
  });

  return tiers
    .map((tier, i) => {
      const m = grouped[i];
      return {
        tier,
        measures: m,
        avgDiscount: m.avgDiscount,
        headroom: m.avgDiscount === null ? null : tier - m.avgDiscount,
      };
    })
    .filter((t) => t.measures.lines > 0);
}

export interface ScatterPoint {
  key: number;
  label: string;
  /** Revenue-weighted discount rate. */
  discount: number;
  /** Profit margin on gross revenue. */
  margin: number;
  sales: number;
  profit: number;
  lines: number;
  /** Revenue-weighted breakeven discount for the group. */
  breakeven: number;
  lossShare: number;
}

/**
 * Discount-vs-margin points for the scatter.
 *
 * Points are aggregated groups rather than raw order lines: 51,288 individual
 * points would be a cloud, and every line's margin is exactly
 * `breakeven - discount` by construction, so the raw plot is a straight line
 * carrying no information. Aggregating to a real business unit — subcategory,
 * product, country — is what exposes where discounting is misaligned.
 */
export function buildDiscountScatter(
  ds: Dataset,
  rows: Int32Array,
  size: number,
  keyOf: (i: number) => number,
  label: (k: number) => string,
  minLines = 1,
): ScatterPoint[] {
  const grouped = groupBy(ds, rows, size, keyOf);
  const out: ScatterPoint[] = [];
  for (let k = 0; k < size; k++) {
    const m = grouped[k];
    if (m.lines < minLines || m.sales <= 0) continue;
    if (m.avgDiscount === null || m.grossMargin === null) continue;
    out.push({
      key: k,
      label: label(k),
      discount: m.avgDiscount,
      margin: m.grossMargin,
      sales: m.sales,
      profit: m.profit,
      lines: m.lines,
      breakeven: m.avgBreakeven ?? 0,
      lossShare: m.lossShare ?? 0,
    });
  }
  return out.sort((a, b) => b.sales - a.sales);
}

export interface DiscountImpact {
  /** Profit destroyed by lines discounted past breakeven (positive number). */
  profitLost: number;
  /** Profit earned by lines that stayed inside breakeven. */
  profitEarned: number;
  lossLines: number;
  totalLines: number;
  lossShare: number;
  /** Revenue sitting on loss-making lines. */
  salesAtLoss: number;
}

export function buildDiscountImpact(ds: Dataset, rows: Int32Array): DiscountImpact {
  const f = ds.facts;
  let lost = 0;
  let earned = 0;
  let lossLines = 0;
  let salesAtLoss = 0;

  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    const p = f.profitCents[i] / 100;
    if (p < 0) {
      lost -= p;
      lossLines++;
      salesAtLoss += f.sales[i];
    } else {
      earned += p;
    }
  }

  return {
    profitLost: lost,
    profitEarned: earned,
    lossLines,
    totalLines: rows.length,
    lossShare: rows.length ? lossLines / rows.length : 0,
    salesAtLoss,
  };
}
