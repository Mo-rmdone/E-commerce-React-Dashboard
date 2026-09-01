/**
 * Every threshold the product measures against lives here. Components read
 * these — no component defines its own idea of "on target".
 */

export const BUSINESS_TARGETS = {
  /** Year-over-year revenue growth the business commits to. */
  revenueGrowth: 0.2,
  /** Minimum acceptable profit margin, applied to every product group. */
  profitMargin: 0.15,
  /** Year-over-year growth target specific to the Corporate segment. */
  corporateGrowth: 0.3,
  /** A market must clear this in annual sales to count as commercially viable. */
  marketSalesThreshold: 400_000,
} as const;

export type BusinessTargetKey = keyof typeof BUSINESS_TARGETS;

/**
 * Revenue basis.
 *
 * The application reports on **gross** revenue throughout: quantity x list
 * price, exactly the `Sales` column as the workbook supplies it. That is the
 * figure the brief's targets are written against, so every KPI, chart and
 * threshold speaks the same language and no card can silently disagree with
 * another.
 *
 * The type is kept because the metric layer takes it as a parameter, and the
 * net figures are still computed — a net view can be reinstated by widening
 * this union again without touching the aggregation code.
 */
export type RevenueBasis = 'gross';

/** How far past a target still counts as "close" rather than a miss. */
export const STATUS_TOLERANCE = 0.02;

export type StatusLevel = 'on-target' | 'at-risk' | 'off-target' | 'neutral';

export const STATUS_LABEL: Record<StatusLevel, string> = {
  'on-target': 'On target',
  'at-risk': 'At risk',
  'off-target': 'Below target',
  neutral: 'No target',
};

/**
 * Grade a value against a target it should meet or exceed.
 * Used by KPIs, tables, alerts and map encodings so "on target" means one thing.
 */
export function gradeAgainstTarget(
  value: number | null,
  target: number,
  tolerance = STATUS_TOLERANCE,
): StatusLevel {
  if (value === null || !Number.isFinite(value)) return 'neutral';
  if (value >= target) return 'on-target';
  if (value >= target - Math.abs(target) * tolerance - Number.EPSILON) return 'at-risk';
  return 'off-target';
}
