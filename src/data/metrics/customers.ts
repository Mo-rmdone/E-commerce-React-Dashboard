import type { Breakdown, Dataset, FilterDimension } from '@/types';
import { BUSINESS_TARGETS, type RevenueBasis } from '@/config/targets';
import type { PeriodComparison } from '@/data/transformations/filterRows';
import type { HeatmapAxis, HeatmapCell } from '@/components/charts/Heatmap';
import { buildBreakdown, margin, revenue } from './breakdowns';
import { buildDiscountImpact } from './discount';
import { int, pct, ppSigned, usd, usdShort } from '@/utils/format';

/**
 * Customer-level analytics: value/margin segmentation, segment × category
 * profitability, revenue concentration and the insights derived from them.
 *
 * Every threshold here is computed from the rows currently in view — the
 * median customer spend is recomputed on every filter change, and the only
 * fixed constant is the business's own 15% margin target, which the rest of
 * the dashboard already grades everything against.
 */

// ------------------------------------------------------------- value matrix

export type CustomerQuadrant = 'champions' | 'profitable-niche' | 'revenue-risk' | 'low-value';

export const QUADRANT_LABEL: Record<CustomerQuadrant, string> = {
  champions: 'Champions',
  'profitable-niche': 'Profitable Niche',
  'revenue-risk': 'Revenue Risk',
  'low-value': 'Low Value',
};

export type CustomerStatus = 'champion' | 'high-opportunity' | 'margin-risk' | 'at-risk' | 'stable';

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  champion: 'Champion',
  'high-opportunity': 'High Opportunity',
  'margin-risk': 'Margin Risk',
  'at-risk': 'At Risk',
  stable: 'Stable',
};

/** Semantic tone for each status — used for badges and chip colouring. */
export const STATUS_TONE: Record<CustomerStatus, 'pos' | 'accent' | 'warn' | 'neg' | 'neutral'> = {
  champion: 'pos',
  'high-opportunity': 'accent',
  'margin-risk': 'warn',
  'at-risk': 'neg',
  stable: 'neutral',
};

/**
 * The one thing to do about this customer. It follows deterministically from
 * status, so the column is a restatement of the diagnosis in the imperative —
 * never a separate judgement that could disagree with the badge beside it.
 */
export type CustomerAction = 'Expand' | 'Upsell' | 'Protect Margin' | 'Recover' | 'Monitor';

export const STATUS_ACTION: Record<CustomerStatus, CustomerAction> = {
  champion: 'Expand',
  'high-opportunity': 'Upsell',
  'margin-risk': 'Protect Margin',
  'at-risk': 'Recover',
  stable: 'Monitor',
};

/** Why that action, in one clause — the tooltip behind the action chip. */
export const ACTION_RATIONALE: Record<CustomerAction, string> = {
  Expand: 'Above-median spend at above-target margin — grow share of wallet.',
  Upsell: 'Above-target margin on below-median spend — headroom to sell more.',
  'Protect Margin': 'Above-median spend below the margin target — review discounting before volume.',
  Recover: 'Below median on both spend and margin, and shrinking — re-engage or let go.',
  Monitor: 'Small but not deteriorating — no action warranted yet.',
};

export interface CustomerPoint {
  key: number;
  id: string;
  country: string;
  countryKey: number;
  market: string;
  marketKey: number;
  segment: string;
  segmentKey: number;
  spend: number;
  profit: number;
  margin: number | null;
  orders: number;
  lines: number;
  growth: number | null;
  quadrant: CustomerQuadrant;
  status: CustomerStatus;
  action: CustomerAction;
}

export interface CustomerAnalytics {
  /** Every customer with activity in view, sorted descending by spend. */
  points: CustomerPoint[];
  /** The spend split — the median customer's spend in this view. */
  spendMedian: number;
  /** The margin split — the business's own profitability target. */
  marginTarget: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quadrantOf(
  spend: number,
  m: number | null,
  spendMedian: number,
  marginTarget: number,
): CustomerQuadrant {
  const highSpend = spend >= spendMedian;
  const highMargin = m !== null && m >= marginTarget;
  if (highSpend && highMargin) return 'champions';
  if (!highSpend && highMargin) return 'profitable-niche';
  if (highSpend && !highMargin) return 'revenue-risk';
  return 'low-value';
}

/**
 * Status adds one more signal quadrant alone can't carry: direction. A
 * low-value customer who is shrinking is a churn risk; one who is flat or new
 * is merely small, which is a different problem (or none at all).
 */
function statusOf(quadrant: CustomerQuadrant, growth: number | null): CustomerStatus {
  switch (quadrant) {
    case 'champions':
      return 'champion';
    case 'profitable-niche':
      return 'high-opportunity';
    case 'revenue-risk':
      return 'margin-risk';
    case 'low-value':
      return growth !== null && growth < 0 ? 'at-risk' : 'stable';
  }
}

export function buildCustomerAnalytics(
  ds: Dataset,
  rows: Int32Array,
  comparison: PeriodComparison | null,
  basis: RevenueBasis,
): CustomerAnalytics {
  const items = buildBreakdown(ds, rows, comparison, 'customer', {
    basis,
    distinct: true,
    dropEmpty: true,
    sort: true,
  });

  // Country and segment are stable per customer (verified in the data audit),
  // so the first row encountered describes the customer.
  const firstCountry = new Map<number, number>();
  const firstSegment = new Map<number, number>();
  const f = ds.facts;
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const c = f.customer[i];
    if (!firstCountry.has(c)) {
      firstCountry.set(c, f.country[i]);
      firstSegment.set(c, f.segment[i]);
    }
  }

  const spendMedian = median(items.map((b) => revenue(b.current, basis)));
  const marginTarget = BUSINESS_TARGETS.profitMargin;

  const points: CustomerPoint[] = items.map((b) => {
    const ck = firstCountry.get(b.key) ?? 0;
    const sk = firstSegment.get(b.key) ?? 0;
    const mk = ds.dims.countryToMarket[ck] ?? 0;
    const spend = revenue(b.current, basis);
    const m = margin(b.current, basis);
    const quadrant = quadrantOf(spend, m, spendMedian, marginTarget);
    const status = statusOf(quadrant, b.growth);
    return {
      key: b.key,
      id: b.label,
      country: ds.dims.countries[ck]?.name ?? '—',
      countryKey: ck,
      market: ds.dims.markets[mk] ?? '—',
      marketKey: mk,
      segment: ds.dims.segments[sk] ?? '—',
      segmentKey: sk,
      spend,
      profit: b.current.profit,
      margin: m,
      orders: b.current.orders,
      lines: b.current.lines,
      growth: b.growth,
      quadrant,
      status,
      action: STATUS_ACTION[status],
    };
  });

  return { points, spendMedian, marginTarget };
}

// ------------------------------------------------------ total → segment → category flow

export type FlowMetric = 'sales' | 'profit';

export interface LevelNode {
  id: string;
  level: number;
  dimension: 'total' | 'segment' | 'category';
  key: number;
  label: string;
  value: number;
}

export interface LevelLink {
  source: string;
  target: string;
  value: number;
  shareOfSource: number;
}

export interface LevelFlowGraph {
  nodes: LevelNode[];
  links: LevelLink[];
  levels: string[];
  total: number;
  /** Segment × category flows dropped because the measure was zero or negative. */
  droppedFlows: number;
  droppedValue: number;
}

/**
 * Where the money comes from, in three levels: the whole, split by customer
 * segment, split again by category.
 *
 * A flow diagram cannot draw a negative band, so on the profit measure any
 * loss-making segment × category combination is excluded and counted instead —
 * the card says how much was left out rather than quietly rescaling it away.
 */
export function buildSegmentCategoryFlow(
  ds: Dataset,
  rows: Int32Array,
  metric: FlowMetric,
): LevelFlowGraph {
  const nSeg = ds.dims.segments.length;
  const nCat = ds.dims.categories.length;
  const pair = new Float64Array(nSeg * nCat);

  const f = ds.facts;
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const s = f.segment[i];
    const c = ds.dims.subToCategory[f.subcategory[i]];
    pair[s * nCat + c] += metric === 'sales' ? f.sales[i] : f.profitCents[i] / 100;
  }

  const segTotal = new Float64Array(nSeg);
  const catTotal = new Float64Array(nCat);
  const flows: { seg: number; cat: number; value: number }[] = [];
  let droppedFlows = 0;
  let droppedValue = 0;

  for (let s = 0; s < nSeg; s++) {
    for (let c = 0; c < nCat; c++) {
      const v = pair[s * nCat + c];
      if (v <= 0) {
        if (v < 0) {
          droppedFlows += 1;
          droppedValue += v;
        }
        continue;
      }
      flows.push({ seg: s, cat: c, value: v });
      segTotal[s] += v;
      catTotal[c] += v;
    }
  }

  const total = flows.reduce((a, fl) => a + fl.value, 0);
  if (total === 0) {
    return { nodes: [], links: [], levels: [], total: 0, droppedFlows, droppedValue };
  }

  const nodes: LevelNode[] = [
    {
      id: 'total',
      level: 0,
      dimension: 'total',
      key: -1,
      label: metric === 'sales' ? 'Total sales' : 'Total profit',
      value: total,
    },
  ];
  for (let s = 0; s < nSeg; s++) {
    if (segTotal[s] <= 0) continue;
    nodes.push({
      id: `segment:${s}`,
      level: 1,
      dimension: 'segment',
      key: s,
      label: ds.dims.segments[s],
      value: segTotal[s],
    });
  }
  for (let c = 0; c < nCat; c++) {
    if (catTotal[c] <= 0) continue;
    nodes.push({
      id: `category:${c}`,
      level: 2,
      dimension: 'category',
      key: c,
      label: ds.dims.categories[c],
      value: catTotal[c],
    });
  }

  const links: LevelLink[] = [];
  for (let s = 0; s < nSeg; s++) {
    if (segTotal[s] <= 0) continue;
    links.push({
      source: 'total',
      target: `segment:${s}`,
      value: segTotal[s],
      shareOfSource: segTotal[s] / total,
    });
  }
  for (const fl of flows) {
    links.push({
      source: `segment:${fl.seg}`,
      target: `category:${fl.cat}`,
      value: fl.value,
      shareOfSource: fl.value / (segTotal[fl.seg] || 1),
    });
  }

  return {
    nodes,
    links,
    levels: [metric === 'sales' ? 'Total sales' : 'Total profit', 'Segment', 'Category'],
    total,
    droppedFlows,
    droppedValue,
  };
}

// ------------------------------------------------- segment × category matrix

export interface SegCatWorst {
  segmentKey: number;
  segmentLabel: string;
  categoryKey: number;
  categoryLabel: string;
  sales: number;
  profit: number;
  margin: number;
}

export interface SegCatMatrix {
  rows: HeatmapAxis[];
  cols: HeatmapAxis[];
  cells: HeatmapCell[];
  /** The single worst (lowest-margin) segment × category combination in view. */
  worst: SegCatWorst | null;
  target: number;
}

/**
 * Profit margin for every (category, segment) pair — categories down the rows,
 * segments across the columns. Cell values are stored as `margin - target` so
 * the diverging heat scale is anchored at the business's profitability target
 * rather than at zero: a cell exactly on target reads as neutral, and colour
 * intensity reads as distance from it either way.
 */
export function buildSegmentCategoryMatrix(ds: Dataset, rows: Int32Array): SegCatMatrix {
  const nSeg = ds.dims.segments.length;
  const nCat = ds.dims.categories.length;
  const sales = new Float64Array(nSeg * nCat);
  const profit = new Float64Array(nSeg * nCat);
  const lines = new Float64Array(nSeg * nCat);

  const f = ds.facts;
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const s = f.segment[i];
    const c = ds.dims.subToCategory[f.subcategory[i]];
    const cell = s * nCat + c;
    sales[cell] += f.sales[i];
    profit[cell] += f.profitCents[i] / 100;
    lines[cell] += 1;
  }

  const target = BUSINESS_TARGETS.profitMargin;
  const cells: HeatmapCell[] = [];
  let worst: SegCatWorst | null = null;

  for (let s = 0; s < nSeg; s++) {
    for (let c = 0; c < nCat; c++) {
      const cell = s * nCat + c;
      if (lines[cell] === 0) continue;
      const cellSales = sales[cell];
      const cellProfit = profit[cell];
      const m = cellSales > 0 ? cellProfit / cellSales : null;
      if (m === null) continue;

      if (worst === null || m < worst.margin) {
        worst = {
          segmentKey: s,
          segmentLabel: ds.dims.segments[s],
          categoryKey: c,
          categoryLabel: ds.dims.categories[c],
          sales: cellSales,
          profit: cellProfit,
          margin: m,
        };
      }

      const variance = m - target;
      cells.push({
        // Categories are the rows, segments the columns.
        row: c,
        col: s,
        value: variance,
        tooltip: {
          title: `${ds.dims.segments[s]} · ${ds.dims.categories[c]}`,
          subtitle: `${int(lines[cell])} order lines`,
          rows: [
            { label: 'Sales', value: usd(cellSales), strong: true },
            {
              label: 'Profit',
              value: usd(cellProfit),
              tone: cellProfit < 0 ? ('neg' as const) : undefined,
            },
            { label: 'Margin', value: pct(m) },
            { label: 'Target', value: pct(target, 0) },
            {
              label: 'Variance vs target',
              value: ppSigned(variance),
              tone: variance >= 0 ? ('pos' as const) : ('neg' as const),
            },
          ],
          status: {
            level:
              m >= target ? ('on-target' as const) : m >= 0 ? ('at-risk' as const) : ('off-target' as const),
            label:
              m >= target
                ? `Clears the ${pct(target, 0)} target`
                : m >= 0
                  ? `Under the ${pct(target, 0)} target`
                  : 'Loss-making',
          },
          hint: 'Click to filter',
        },
      });
    }
  }

  // Rows are categories, columns are segments.
  const rowAxis: HeatmapAxis[] = ds.dims.categories.map((label, c) => {
    let cSales = 0;
    let cProfit = 0;
    for (let s = 0; s < nSeg; s++) {
      cSales += sales[s * nCat + c];
      cProfit += profit[s * nCat + c];
    }
    const m = cSales > 0 ? cProfit / cSales : null;
    return { key: c, label, total: (m ?? target) - target };
  });

  const colAxis: HeatmapAxis[] = ds.dims.segments.map((label, s) => {
    let sSales = 0;
    let sProfit = 0;
    for (let c = 0; c < nCat; c++) {
      sSales += sales[s * nCat + c];
      sProfit += profit[s * nCat + c];
    }
    const m = sSales > 0 ? sProfit / sSales : null;
    return { key: s, label, total: (m ?? target) - target };
  });

  return { rows: rowAxis, cols: colAxis, cells, worst, target };
}

// ------------------------------------------------------------- concentration

export interface ConcentrationBin {
  startRank: number;
  endRank: number;
  sales: number;
  cumPct: number;
}

export interface ConcentrationResult {
  n: number;
  total: number;
  top10Share: number | null;
  /** Share held by the top 100 — null when the base is smaller than that. */
  top100Share: number | null;
  /** Share left to the bottom half of the ranking. */
  bottom50Share: number | null;
  thresholds: { p50: number | null; p80: number | null; p90: number | null };
  bins: ConcentrationBin[];
  rankOf: Map<number, { rank: number; cumPct: number; sales: number }>;
}

/**
 * A Pareto view of the customer base: ranked by spend, individually for the
 * bars where each bar is still legible, binned into equal-count buckets past
 * that so a base of thousands still renders as ~30 bars. The cumulative curve
 * and the 50/80/90% crossing points are always computed at full resolution —
 * only the bars are downsampled, never the thresholds or the headline share.
 */
export function buildConcentration(points: CustomerPoint[]): ConcentrationResult {
  const n = points.length;
  const total = points.reduce((s, p) => s + p.spend, 0);
  const thresholds: ConcentrationResult['thresholds'] = { p50: null, p80: null, p90: null };
  const rankOf = new Map<number, { rank: number; cumPct: number; sales: number }>();
  const cum = new Float64Array(n);

  let running = 0;
  for (let i = 0; i < n; i++) {
    running += points[i].spend;
    const p = total > 0 ? running / total : 0;
    cum[i] = p;
    rankOf.set(points[i].key, { rank: i + 1, cumPct: p, sales: points[i].spend });
    if (thresholds.p50 === null && p >= 0.5) thresholds.p50 = i + 1;
    if (thresholds.p80 === null && p >= 0.8) thresholds.p80 = i + 1;
    if (thresholds.p90 === null && p >= 0.9) thresholds.p90 = i + 1;
  }

  // Exposure bands, read straight off the cumulative curve rather than
  // re-summed: cum[i] is already the share held by ranks 1..i+1.
  const shareAt = (rank: number) => (total > 0 && n > 0 ? cum[Math.min(rank, n) - 1] : null);
  const top10Share = n > 0 ? shareAt(10) : null;
  const top100Share = n >= 100 ? shareAt(100) : null;
  const halfway = Math.floor(n / 2);
  const bottom50Share = halfway > 0 && total > 0 ? 1 - cum[halfway - 1] : null;

  const nBins = Math.max(1, Math.min(30, n));
  const binSize = Math.max(1, Math.ceil(n / nBins));
  const bins: ConcentrationBin[] = [];
  for (let start = 0; start < n; start += binSize) {
    const end = Math.min(n, start + binSize);
    let sales = 0;
    for (let i = start; i < end; i++) sales += points[i].spend;
    bins.push({ startRank: start + 1, endRank: end, sales, cumPct: cum[end - 1] });
  }

  return { n, total, top10Share, top100Share, bottom50Share, thresholds, bins, rankOf };
}

// ----------------------------------------------------------- executive takeaways

export type TakeawayKind = 'protect' | 'grow' | 'scale';

export interface Takeaway {
  id: TakeawayKind;
  /** The verb: what kind of decision this is. */
  kicker: string;
  /** The one number that sizes the decision. */
  metric: string;
  metricLabel: string;
  /** One sentence of justification — never a recommendation on its own. */
  detail: string;
  action?: { label: string; dimension: FilterDimension; value: number };
}

/**
 * The three decisions the page closes on — defend, grow, expand.
 *
 * Deliberately only three, and deliberately the *decisions* rather than the
 * findings: everything above already reports what is happening, so repeating it
 * here would be the third telling. Each one is still computed from the rows in
 * view, so a filter that removes the condition removes the card.
 */
export function buildExecutiveTakeaways(
  ds: Dataset,
  rows: Int32Array,
  matrix: SegCatMatrix,
  points: CustomerPoint[],
  segmentGrowth: Breakdown[],
): Takeaway[] {
  const out: Takeaway[] = [];
  const T = matrix.target;

  // PROTECT — profit already being destroyed by discounting past breakeven.
  const impact = buildDiscountImpact(ds, rows);
  if (impact.profitLost > 0) {
    out.push({
      id: 'protect',
      kicker: 'Protect',
      metric: usdShort(impact.profitLost),
      metricLabel: 'profit at risk',
      detail:
        matrix.worst && matrix.worst.margin < T
          ? `${pct(impact.lossShare, 0)} of order lines are discounted past their own breakeven. ${matrix.worst.categoryLabel} in ${matrix.worst.segmentLabel} is the weakest combination at ${pct(matrix.worst.margin)}.`
          : `${pct(impact.lossShare, 0)} of order lines are discounted past their own breakeven, destroying ${usd(impact.profitLost)} of margin.`,
      action: matrix.worst
        ? {
            label: `Inspect ${matrix.worst.segmentLabel}`,
            dimension: 'segment',
            value: matrix.worst.segmentKey,
          }
        : undefined,
    });
  }

  // GROW — the segment with the strongest trajectory to put effort behind.
  const growing = segmentGrowth
    .filter((s) => s.growth !== null && s.growth > 0)
    .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0));
  if (growing.length > 0) {
    const best = growing[0];
    out.push({
      id: 'grow',
      kicker: 'Grow',
      metric: `+${((best.growth ?? 0) * 100).toFixed(1)}%`,
      metricLabel: `${best.label} growth`,
      detail: `${best.label} is growing faster than any other segment year over year, on ${usdShort(
        best.current.sales,
      )} of sales — the clearest place to add commercial effort.`,
      action: { label: `View ${best.label}`, dimension: 'segment', value: best.key },
    });
  }

  // SCALE — the customers already worth more of the business's attention.
  const champions = points.filter((p) => p.quadrant === 'champions');
  if (champions.length > 0) {
    const championSales = champions.reduce((s, p) => s + p.spend, 0);
    const totalSales = points.reduce((s, p) => s + p.spend, 0);
    out.push({
      id: 'scale',
      kicker: 'Scale',
      metric: int(champions.length),
      metricLabel: champions.length === 1 ? 'champion' : 'champions',
      detail: `${int(champions.length)} customers already clear both the median spend and the ${pct(
        T,
        0,
      )} margin target, carrying ${
        totalSales > 0 ? pct(championSales / totalSales, 0) : '—'
      } of revenue — expand into this profile first.`,
    });
  }

  return out;
}
