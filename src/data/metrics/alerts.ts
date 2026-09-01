import type { Breakdown, FilterDimension } from '@/types';
import { BUSINESS_TARGETS, type RevenueBasis } from '@/config/targets';
import { buildBreakdown, margin, revenue } from './breakdowns';
import { buildDiscountImpact, buildMarginTiers } from './discount';
import { marketsOnTarget, type KpiContext } from './kpis';
import { pct, pctSigned, usd, usdShort } from '@/utils/format';

/**
 * Recommendations are derived from the filtered data on every render. Nothing
 * here is a fixed string: if a condition does not hold, its card does not exist.
 */

export type AlertSeverity = 'critical' | 'warning' | 'opportunity' | 'positive';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** The finding, in one sentence, with the numbers that triggered it. */
  detail: string;
  /** Headline figure for the card. */
  metric: string;
  metricLabel: string;
  /** Where the user should go to act on it. */
  action?: {
    label: string;
    dimension: FilterDimension;
    value: number;
  };
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  positive: 3,
};

export function buildAlerts(ctx: KpiContext, basis: RevenueBasis): Alert[] {
  const { ds, rows, comparison, summary } = ctx;
  const T = BUSINESS_TARGETS;
  const out: Alert[] = [];

  // --- 1. Categories below the margin floor --------------------------------
  const categories = buildBreakdown(ds, rows, comparison, 'category', { basis });
  const belowMargin = categories.filter((c) => {
    const m = margin(c.current, basis);
    return m !== null && m < T.profitMargin;
  });
  if (belowMargin.length > 0) {
    const worst = [...belowMargin].sort(
      (a, b) => (margin(a.current, basis) ?? 0) - (margin(b.current, basis) ?? 0),
    )[0];
    out.push({
      id: 'margin-below-target',
      severity: 'critical',
      title: 'Categories below the margin floor',
      metric: String(belowMargin.length),
      metricLabel: belowMargin.length === 1 ? 'category' : 'categories',
      detail: `${listNames(belowMargin.map((c) => c.label))} ${
        belowMargin.length === 1 ? 'sits' : 'sit'
      } under the ${pct(T.profitMargin, 0)} margin target. ${worst.label} is worst at ${pct(
        margin(worst.current, basis),
      )}, on ${usdShort(revenue(worst.current, basis))} of revenue.`,
      action: { label: `Inspect ${worst.label}`, dimension: 'category', value: worst.key },
    });
  }

  // --- 2. Markets under the annual sales threshold -------------------------
  const mk = marketsOnTarget(ctx);
  const below = mk.total - mk.onTarget;
  if (below > 0 && mk.year !== null) {
    const shortfalls = ctx.marketYear
      .filter((m) => m.year === mk.year && m.sales < T.marketSalesThreshold)
      .sort((a, b) => a.sales - b.sales);
    const worst = shortfalls[0];
    out.push({
      id: 'markets-below-threshold',
      severity: 'warning',
      title: 'Markets below the viability threshold',
      metric: String(below),
      metricLabel: below === 1 ? 'market' : 'markets',
      detail: `${below} of ${mk.total} markets did not reach ${usdShort(
        T.marketSalesThreshold,
      )} in ${mk.year}. ${ds.dims.markets[worst.market]} is furthest away at ${usd(
        worst.sales,
      )}, a shortfall of ${usd(T.marketSalesThreshold - worst.sales)}.`,
      action: {
        label: `Inspect ${ds.dims.markets[worst.market]}`,
        dimension: 'market',
        value: worst.market,
      },
    });
  }

  // --- 3. Corporate growth against its own target --------------------------
  const corpIdx = ds.dims.segments.findIndex((s) => s.toLowerCase() === 'corporate');
  const corp = ctx.segments.find((s) => s.key === corpIdx);
  if (corp && corp.growth !== null && corp.growth < T.corporateGrowth) {
    // Which segment is actually hitting the pace? That is the useful half.
    const best = [...ctx.segments]
      .filter((s) => s.growth !== null)
      .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0];
    const beaten = best && best.key !== corpIdx && (best.growth ?? 0) > (corp.growth ?? 0);
    out.push({
      id: 'corporate-growth-gap',
      severity: 'opportunity',
      title: 'Corporate growth behind target',
      metric: pctSigned(corp.growth),
      metricLabel: `against ${pct(T.corporateGrowth, 0)} target`,
      detail: `Corporate grew ${pctSigned(corp.growth)} on ${usdShort(
        revenue(corp.current, basis),
      )} of revenue — ${pct(T.corporateGrowth - corp.growth, 1)} short of its target.${
        beaten
          ? ` ${best.label} is the segment actually growing at pace, at ${pctSigned(best.growth)}.`
          : ''
      }`,
      action: { label: 'Inspect Corporate', dimension: 'segment', value: corpIdx },
    });
  }

  // --- 4. Overall revenue growth ------------------------------------------
  // Annual, matching the KPI row: latest year against the one before it.
  const yoy =
    ctx.latestYearSummary && ctx.priorYearSummary && revenue(ctx.priorYearSummary, basis) > 0
      ? (revenue(ctx.latestYearSummary, basis) - revenue(ctx.priorYearSummary, basis)) /
        revenue(ctx.priorYearSummary, basis)
      : null;
  if (yoy !== null) {
    if (yoy < T.revenueGrowth) {
      out.push({
        id: 'revenue-growth-gap',
        severity: 'warning',
        title: 'Revenue growth below target',
        metric: pctSigned(yoy),
        metricLabel: `against ${pct(T.revenueGrowth, 0)} target`,
        detail: `Revenue grew ${pctSigned(yoy)} year over year, ${pct(
          T.revenueGrowth - yoy,
        )} short of the ${pct(T.revenueGrowth, 0)} commitment.`,
      });
    } else {
      out.push({
        id: 'revenue-growth-ok',
        severity: 'positive',
        title: 'Revenue growth ahead of target',
        metric: pctSigned(yoy),
        metricLabel: `against ${pct(T.revenueGrowth, 0)} target`,
        detail: `Revenue grew ${pctSigned(yoy)} year over year on ${usdShort(
          revenue(summary, basis),
        )}, clearing the ${pct(T.revenueGrowth, 0)} target by ${pct(yoy - T.revenueGrowth)}.`,
      });
    }
  }

  // --- 5. Margin destroyed by over-discounting -----------------------------
  const impact = buildDiscountImpact(ds, rows);
  if (impact.profitLost > 0) {
    const tiers = buildMarginTiers(ds, rows).filter(
      (t) => t.headroom !== null && t.headroom < 0.08,
    );
    const worstTier = tiers.sort((a, b) => (a.headroom ?? 0) - (b.headroom ?? 0))[0];
    out.push({
      id: 'discount-erosion',
      severity: 'critical',
      title: 'Profit lost to over-discounting',
      metric: usdShort(impact.profitLost),
      metricLabel: `across ${impact.lossLines.toLocaleString()} order lines`,
      detail: `${pct(impact.lossShare, 1)} of order lines were discounted past their own breakeven, destroying ${usd(
        impact.profitLost,
      )} against ${usd(impact.profitEarned)} earned.${
        worstTier
          ? ` The ${pct(worstTier.tier, 0)} margin tier is worst: it carries ${pct(
              worstTier.avgDiscount,
            )} average discount against a ${pct(worstTier.tier, 0)} breakeven.`
          : ''
      }`,
    });
  }

  // --- 6. Concentration risk ------------------------------------------------
  const countries = buildBreakdown(ds, rows, comparison, 'country', { basis });
  if (countries.length > 4) {
    const total = countries.reduce((s, c) => s + revenue(c.current, basis), 0);
    const top = countries[0];
    const share = total > 0 ? revenue(top.current, basis) / total : 0;
    if (share > 0.15) {
      out.push({
        id: 'country-concentration',
        severity: 'warning',
        title: 'Revenue concentration',
        metric: pct(share, 0),
        metricLabel: `of revenue in ${top.label}`,
        detail: `${top.label} alone carries ${pct(share, 1)} of revenue in this view (${usdShort(
          revenue(top.current, basis),
        )} of ${usdShort(total)}), across ${countries.length} trading countries.`,
        action: { label: `Inspect ${top.label}`, dimension: 'country', value: top.key },
      });
    }
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A single composite health score, so the executive read is one glance.
 * Four equally weighted components, each the share of its target achieved,
 * capped at 100% so an over-performing target cannot mask a failing one.
 */
export function buildHealthScore(
  ctx: KpiContext,
  basis: RevenueBasis,
): { score: number; components: { label: string; achieved: number; weight: number }[] } | null {
  const T = BUSINESS_TARGETS;
  const parts: { label: string; achieved: number; weight: number }[] = [];

  const m = margin(ctx.summary, basis);
  if (m !== null) {
    parts.push({ label: 'Margin', achieved: clamp01(m / T.profitMargin), weight: 1 });
  }

  if (ctx.latestYearSummary && ctx.priorYearSummary && revenue(ctx.priorYearSummary, basis) > 0) {
    const g =
      (revenue(ctx.latestYearSummary, basis) - revenue(ctx.priorYearSummary, basis)) /
      revenue(ctx.priorYearSummary, basis);
    parts.push({ label: 'Growth', achieved: clamp01(g / T.revenueGrowth), weight: 1 });
  }

  const corpIdx = ctx.ds.dims.segments.findIndex((s) => s.toLowerCase() === 'corporate');
  const corp = ctx.segments.find((s) => s.key === corpIdx);
  if (corp?.growth != null) {
    parts.push({
      label: 'Corporate',
      achieved: clamp01(corp.growth / T.corporateGrowth),
      weight: 1,
    });
  }

  const mk = marketsOnTarget(ctx);
  if (mk.total > 0) {
    parts.push({ label: 'Markets', achieved: mk.onTarget / mk.total, weight: 1 });
  }

  if (parts.length === 0) return null;
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.achieved * p.weight, 0) / total;
  return { score: Math.round(score * 100), components: parts };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export type { Breakdown };
