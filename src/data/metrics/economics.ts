import type { Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';

/**
 * Profitability economics: what a product is worth once the order and the
 * customer around it are counted.
 *
 * Product margin alone answers "does this line pay for itself". It cannot
 * answer "is this line worth carrying", because a product bought below its own
 * breakeven may still sit inside orders and customer relationships that pay.
 * Every measure here therefore exists at three widths:
 *
 *   product  — the lines of that product alone
 *   basket   — every order containing it, whole
 *   customer — every customer who ever bought it, whole
 *
 * The basket and customer figures deliberately include revenue the product did
 * not earn. That is the point: they are the value the product sits inside, not
 * the value it generated, and the gap between the three is the finding.
 */

/** Orders below this are too few to read a basket margin from. */
export const MIN_ORDERS = 25;

export type EconomicClass = 'winner' | 'loss-leader' | 'underdeveloped' | 'margin-problem';

export const CLASS_LABEL: Record<EconomicClass, string> = {
  winner: 'Healthy profit driver',
  'loss-leader': 'Strategic loss leader',
  underdeveloped: 'Underdeveloped',
  'margin-problem': 'True margin problem',
};

export const CLASS_SHORT: Record<EconomicClass, string> = {
  winner: 'Winners',
  'loss-leader': 'Strategic loss leaders',
  underdeveloped: 'Underdeveloped',
  'margin-problem': 'True margin problems',
};

export const CLASS_TONE: Record<EconomicClass, 'pos' | 'accent' | 'warn' | 'neg'> = {
  winner: 'pos',
  'loss-leader': 'accent',
  underdeveloped: 'warn',
  'margin-problem': 'neg',
};

export interface ProductEconomics {
  key: number;
  label: string;
  subcategory: string;
  category: string;
  unitPrice: number;
  /** Revenue of this product's own lines. */
  revenue: number;
  profit: number;
  productMargin: number;
  /** Margin of every order containing it, counted whole. */
  basketMargin: number;
  basketRevenue: number;
  /** Revenue in those orders that this product did not earn. */
  crossSell: number;
  /** Margin of every customer who bought it, across their whole history. */
  customerMargin: number;
  orders: number;
  customers: number;
  lines: number;
  avgDiscount: number;
  /** Basket revenue per order containing the product. */
  avgBasket: number;
  contributionPerOrder: number;
  klass: EconomicClass;
}

export interface EconomicBenchmarks {
  /** The business's own margin target — the vertical split. */
  marginTarget: number;
  /**
   * Portfolio margin in this view — the horizontal split. A basket only counts
   * as valuable if it beats the average order, not if it merely clears zero.
   */
  basketBenchmark: number;
  totalRevenue: number;
  totalProfit: number;
  orders: number;
  customers: number;
}

export interface ProductEconomicsResult {
  items: ProductEconomics[];
  benchmarks: EconomicBenchmarks;
  counts: Record<EconomicClass, number>;
  revenueByClass: Record<EconomicClass, number>;
  /** Products excluded for having too few orders to read. */
  thin: number;
}

const EMPTY_COUNTS = (): Record<EconomicClass, number> => ({
  winner: 0,
  'loss-leader': 0,
  underdeveloped: 0,
  'margin-problem': 0,
});

function classify(
  productMargin: number,
  basketMargin: number,
  b: EconomicBenchmarks,
): EconomicClass {
  const rich = productMargin >= b.marginTarget;
  const carries = basketMargin >= b.basketBenchmark;
  if (rich && carries) return 'winner';
  if (!rich && carries) return 'loss-leader';
  if (rich && !carries) return 'underdeveloped';
  return 'margin-problem';
}

/**
 * One pass to total every order and customer, then one pass per product over
 * the distinct orders and customers it appears in. The de-duplication matters:
 * a product on three lines of one order must count that order's value once.
 */
export function buildProductEconomics(
  ds: Dataset,
  rows: Int32Array,
  minOrders = MIN_ORDERS,
): ProductEconomicsResult {
  const f = ds.facts;
  const nOrders = ds.dims.orderCount;
  const nCustomers = ds.dims.customers.length;

  const orderSales = new Float64Array(nOrders);
  const orderProfit = new Float64Array(nOrders);
  const custSales = new Float64Array(nCustomers);
  const custProfit = new Float64Array(nCustomers);

  let totalRevenue = 0;
  let totalProfit = 0;
  const seenOrder = new Uint8Array(nOrders);
  const seenCustomer = new Uint8Array(nCustomers);
  let orderCount = 0;
  let customerCount = 0;

  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const sales = f.sales[i];
    const profit = f.profitCents[i] / 100;
    const o = f.order[i];
    const c = f.customer[i];
    orderSales[o] += sales;
    orderProfit[o] += profit;
    custSales[c] += sales;
    custProfit[c] += profit;
    totalRevenue += sales;
    totalProfit += profit;
    if (!seenOrder[o]) {
      seenOrder[o] = 1;
      orderCount += 1;
    }
    if (!seenCustomer[c]) {
      seenCustomer[c] = 1;
      customerCount += 1;
    }
  }

  const benchmarks: EconomicBenchmarks = {
    marginTarget: BUSINESS_TARGETS.profitMargin,
    basketBenchmark: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
    totalRevenue,
    totalProfit,
    orders: orderCount,
    customers: customerCount,
  };

  // Per product: own totals, plus the distinct orders and customers it touches.
  interface Acc {
    revenue: number;
    profit: number;
    lines: number;
    discountWeighted: number;
    orders: Set<number>;
    customers: Set<number>;
  }
  const acc = new Map<number, Acc>();
  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const p = f.product[i];
    let a = acc.get(p);
    if (a === undefined) {
      a = {
        revenue: 0,
        profit: 0,
        lines: 0,
        discountWeighted: 0,
        orders: new Set<number>(),
        customers: new Set<number>(),
      };
      acc.set(p, a);
    }
    const sales = f.sales[i];
    a.revenue += sales;
    a.profit += f.profitCents[i] / 100;
    a.lines += 1;
    a.discountWeighted += (f.discountBp[i] / 10000) * sales;
    a.orders.add(f.order[i]);
    a.customers.add(f.customer[i]);
  }

  const items: ProductEconomics[] = [];
  const counts = EMPTY_COUNTS();
  const revenueByClass = { winner: 0, 'loss-leader': 0, underdeveloped: 0, 'margin-problem': 0 };
  let thin = 0;

  for (const [key, a] of acc) {
    if (a.orders.size < minOrders) {
      thin += 1;
      continue;
    }
    let bSales = 0;
    let bProfit = 0;
    for (const o of a.orders) {
      bSales += orderSales[o];
      bProfit += orderProfit[o];
    }
    let cSales = 0;
    let cProfit = 0;
    for (const c of a.customers) {
      cSales += custSales[c];
      cProfit += custProfit[c];
    }
    if (a.revenue <= 0 || bSales <= 0) continue;

    const productMargin = a.profit / a.revenue;
    const basketMargin = bProfit / bSales;
    const customerMargin = cSales > 0 ? cProfit / cSales : 0;
    const klass = classify(productMargin, basketMargin, benchmarks);

    const raw = ds.dims.products[key];
    const subKey = subcategoryOf(ds, rows, key);
    items.push({
      key,
      label: raw?.name ?? '—',
      subcategory: subKey === null ? '—' : (ds.dims.subcategories[subKey]?.name ?? '—'),
      category:
        subKey === null
          ? '—'
          : (ds.dims.categories[ds.dims.subToCategory[subKey]] ?? '—'),
      unitPrice: raw?.unitPrice ?? 0,
      revenue: a.revenue,
      profit: a.profit,
      productMargin,
      basketMargin,
      basketRevenue: bSales,
      crossSell: Math.max(0, bSales - a.revenue),
      customerMargin,
      orders: a.orders.size,
      customers: a.customers.size,
      lines: a.lines,
      avgDiscount: a.revenue > 0 ? a.discountWeighted / a.revenue : 0,
      avgBasket: bSales / a.orders.size,
      contributionPerOrder: bProfit / a.orders.size,
      klass,
    });
    counts[klass] += 1;
    revenueByClass[klass] += a.revenue;
  }

  items.sort((x, y) => y.revenue - x.revenue);
  return { items, benchmarks, counts, revenueByClass, thin };
}

/**
 * The subcategory a product belongs to. The packed fact table carries
 * subcategory per line rather than per product, so it is read from the first
 * line of that product in view.
 */
const subcategoryCache = new WeakMap<Dataset, Map<number, number>>();
function subcategoryOf(ds: Dataset, rows: Int32Array, product: number): number | null {
  let cache = subcategoryCache.get(ds);
  if (!cache) {
    cache = new Map<number, number>();
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const p = ds.facts.product[i];
      if (!cache.has(p)) cache.set(p, ds.facts.subcategory[i]);
    }
    subcategoryCache.set(ds, cache);
  }
  if (!cache.has(product)) {
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      if (ds.facts.product[i] === product) {
        cache.set(product, ds.facts.subcategory[i]);
        break;
      }
    }
  }
  return cache.get(product) ?? null;
}

// --------------------------------------------------------------- the ladder

export interface ValueLadder {
  /** Products below the margin target — the population in question. */
  products: number;
  revenue: number;
  productMargin: number;
  basketMargin: number;
  customerMargin: number;
  /** Percentage points the basket adds to the product's own margin. */
  basketLift: number;
  customerLift: number;
  crossSell: number;
  avgBasket: number;
}

/**
 * What the order and the customer add to products that do not clear the margin
 * target on their own. This is the page's central claim, reduced to one row.
 */
export function buildValueLadder(result: ProductEconomicsResult): ValueLadder | null {
  const weak = result.items.filter((p) => p.productMargin < result.benchmarks.marginTarget);
  if (weak.length === 0) return null;

  const revenue = weak.reduce((s, p) => s + p.revenue, 0);
  const profit = weak.reduce((s, p) => s + p.profit, 0);
  const bSales = weak.reduce((s, p) => s + p.basketRevenue, 0);
  const bProfit = weak.reduce((s, p) => s + p.basketMargin * p.basketRevenue, 0);
  // Customer margin is weighted by basket revenue rather than re-derived: the
  // per-product customer totals overlap, so they cannot simply be summed.
  const cMargin =
    bSales > 0 ? weak.reduce((s, p) => s + p.customerMargin * p.basketRevenue, 0) / bSales : 0;

  const productMargin = revenue > 0 ? profit / revenue : 0;
  const basketMargin = bSales > 0 ? bProfit / bSales : 0;
  return {
    products: weak.length,
    revenue,
    productMargin,
    basketMargin,
    customerMargin: cMargin,
    basketLift: basketMargin - productMargin,
    customerLift: cMargin - productMargin,
    crossSell: weak.reduce((s, p) => s + p.crossSell, 0),
    avgBasket: weak.length > 0 ? bSales / weak.reduce((s, p) => s + p.orders, 0) : 0,
  };
}

// ------------------------------------------------------------ discount bands

export type DiscountVerdict = 'creating' | 'neutral' | 'destructive';

export interface DiscountBand {
  /** Lower edge of the band, as a rate. */
  from: number;
  to: number;
  label: string;
  revenue: number;
  lines: number;
  orders: number;
  productMargin: number;
  basketMargin: number;
  customerMargin: number;
  avgBasket: number;
  /** Profit the lines themselves made or lost. */
  productProfit: number;
  /** Profit of the orders those lines sit in, whole. */
  basketProfit: number;
  verdict: DiscountVerdict;
}

const BANDS: { from: number; to: number; label: string }[] = [
  { from: 0, to: 0.0001, label: 'No discount' },
  { from: 0.0001, to: 0.1, label: 'Up to 10%' },
  { from: 0.1, to: 0.2, label: '10–20%' },
  { from: 0.2, to: 0.3, label: '20–30%' },
  { from: 0.3, to: 1, label: '30%+' },
];

/**
 * Discount depth against what the discount actually bought.
 *
 * A band is only destructive when the orders it sits in lose money, not when
 * the discounted line alone does. That distinction is the whole argument: a
 * line sold under its own breakeven inside an order that clears the portfolio
 * benchmark has been paid for by the basket.
 */
export function buildDiscountEconomics(ds: Dataset, rows: Int32Array): DiscountBand[] {
  const f = ds.facts;
  const nOrders = ds.dims.orderCount;
  const nCustomers = ds.dims.customers.length;
  const orderSales = new Float64Array(nOrders);
  const orderProfit = new Float64Array(nOrders);
  const custSales = new Float64Array(nCustomers);
  const custProfit = new Float64Array(nCustomers);
  let totalRevenue = 0;
  let totalProfit = 0;

  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const sales = f.sales[i];
    const profit = f.profitCents[i] / 100;
    orderSales[f.order[i]] += sales;
    orderProfit[f.order[i]] += profit;
    custSales[f.customer[i]] += sales;
    custProfit[f.customer[i]] += profit;
    totalRevenue += sales;
    totalProfit += profit;
  }
  const benchmark = totalRevenue > 0 ? totalProfit / totalRevenue : 0;

  const acc = BANDS.map(() => ({
    revenue: 0,
    profit: 0,
    lines: 0,
    orders: new Set<number>(),
    customers: new Set<number>(),
  }));

  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const d = f.discountBp[i] / 10000;
    let b = BANDS.length - 1;
    for (let k = 0; k < BANDS.length; k++) {
      if (d >= BANDS[k].from && d < BANDS[k].to) {
        b = k;
        break;
      }
    }
    const a = acc[b];
    a.revenue += f.sales[i];
    a.profit += f.profitCents[i] / 100;
    a.lines += 1;
    a.orders.add(f.order[i]);
    a.customers.add(f.customer[i]);
  }

  return BANDS.map((band, k) => {
    const a = acc[k];
    let bSales = 0;
    let bProfit = 0;
    for (const o of a.orders) {
      bSales += orderSales[o];
      bProfit += orderProfit[o];
    }
    let cSales = 0;
    let cProfit = 0;
    for (const c of a.customers) {
      cSales += custSales[c];
      cProfit += custProfit[c];
    }
    const basketMargin = bSales > 0 ? bProfit / bSales : 0;
    const productMargin = a.revenue > 0 ? a.profit / a.revenue : 0;
    const verdict: DiscountVerdict =
      bProfit <= 0 ? 'destructive' : basketMargin >= benchmark ? 'creating' : 'neutral';
    return {
      ...band,
      revenue: a.revenue,
      lines: a.lines,
      orders: a.orders.size,
      productMargin,
      basketMargin,
      customerMargin: cSales > 0 ? cProfit / cSales : 0,
      avgBasket: a.orders.size > 0 ? bSales / a.orders.size : 0,
      productProfit: a.profit,
      basketProfit: bProfit,
      verdict,
    };
  }).filter((b) => b.lines > 0);
}

// ----------------------------------------------------------- price position

export interface PricePoint {
  key: number;
  label: string;
  category: string;
  unitPrice: number;
  /** Unit price as a share of the category's median unit price. */
  priceIndex: number;
  avgDiscount: number;
  /** Realised price after discount, relative to the category median. */
  netIndex: number;
  productMargin: number;
  basketMargin: number;
  orders: number;
  revenue: number;
}

/**
 * Where a product sits against the rest of the assortment on price.
 *
 * This is an internal comparison, not a market one: the dataset holds no
 * competitor prices, no traffic and no conversion, so it can say a product is
 * cheap relative to its own category and what that coincides with. It cannot
 * say whether the price is competitively necessary. The page states that limit
 * rather than implying the stronger reading.
 */
export function buildPricePosition(
  economics: ProductEconomics[],
): { points: PricePoint[]; medians: Map<string, number> } {
  const byCategory = new Map<string, number[]>();
  for (const p of economics) {
    if (p.unitPrice <= 0) continue;
    const list = byCategory.get(p.category);
    if (list) list.push(p.unitPrice);
    else byCategory.set(p.category, [p.unitPrice]);
  }
  const medians = new Map<string, number>();
  for (const [cat, list] of byCategory) {
    const s = [...list].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    medians.set(cat, s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
  }

  const points: PricePoint[] = [];
  for (const p of economics) {
    const med = medians.get(p.category);
    if (!med || p.unitPrice <= 0) continue;
    points.push({
      key: p.key,
      label: p.label,
      category: p.category,
      unitPrice: p.unitPrice,
      priceIndex: p.unitPrice / med,
      avgDiscount: p.avgDiscount,
      netIndex: (p.unitPrice * (1 - p.avgDiscount)) / med,
      productMargin: p.productMargin,
      basketMargin: p.basketMargin,
      orders: p.orders,
      revenue: p.revenue,
    });
  }
  return { points, medians };
}

// ------------------------------------------------------- decision framework

export interface DecisionRow {
  id: string;
  signal: string;
  context: string;
  diagnosis: string;
  action: 'Protect' | 'Optimize' | 'Investigate' | 'Assess' | 'Monitor';
  tone: 'pos' | 'accent' | 'warn' | 'neg' | 'neutral';
  /** Population the row is drawn from, so no row is hypothetical. */
  count: number;
  revenue: number;
}

/**
 * Rows are generated from the populations that exist in the current view. A
 * class with no members produces no row, so the table never recommends action
 * on an empty set.
 */
export function buildDecisions(
  result: ProductEconomicsResult,
  bands: DiscountBand[],
): DecisionRow[] {
  const out: DecisionRow[] = [];
  const { counts, revenueByClass, benchmarks } = result;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  if (counts['margin-problem'] > 0) {
    out.push({
      id: 'margin-problem',
      signal: 'Low product margin, weak basket',
      context: `Orders containing them return under the ${pct(benchmarks.basketBenchmark)} portfolio average`,
      diagnosis: 'True profitability problem. The basket is not paying for the line.',
      action: 'Investigate',
      tone: 'neg',
      count: counts['margin-problem'],
      revenue: revenueByClass['margin-problem'],
    });
  }
  if (counts['loss-leader'] > 0) {
    out.push({
      id: 'loss-leader',
      signal: 'Low product margin, strong basket',
      context: `Their orders beat the portfolio average despite the line missing the ${pct(benchmarks.marginTarget)} target`,
      diagnosis: 'Strategic loss leader. The margin is bought back downstream.',
      action: 'Protect',
      tone: 'accent',
      count: counts['loss-leader'],
      revenue: revenueByClass['loss-leader'],
    });
  }
  if (counts.underdeveloped > 0) {
    out.push({
      id: 'underdeveloped',
      signal: 'Healthy product margin, weak basket',
      context: 'The line earns its target but the orders around it do not',
      diagnosis: 'Underdeveloped. The product sells alone rather than leading a basket.',
      action: 'Optimize',
      tone: 'warn',
      count: counts.underdeveloped,
      revenue: revenueByClass.underdeveloped,
    });
  }
  if (counts.winner > 0) {
    out.push({
      id: 'winner',
      signal: 'Healthy margin, strong basket',
      context: 'Clears the margin target and pulls above-average orders',
      diagnosis: 'Healthy profit driver.',
      action: 'Monitor',
      tone: 'pos',
      count: counts.winner,
      revenue: revenueByClass.winner,
    });
  }

  const destructive = bands.filter((b) => b.verdict === 'destructive');
  if (destructive.length > 0) {
    const rev = destructive.reduce((s, b) => s + b.revenue, 0);
    out.push({
      id: 'discount-destructive',
      signal: `Discount band with negative downstream economics`,
      context: `${destructive.map((b) => b.label).join(', ')} — the orders themselves lose money`,
      diagnosis: 'Value destruction. The discount is not being recovered anywhere.',
      action: 'Investigate',
      tone: 'neg',
      count: destructive.reduce((s, b) => s + b.orders, 0),
      revenue: rev,
    });
  }
  const creating = bands.filter((b) => b.verdict === 'creating' && b.from > 0);
  if (creating.length > 0) {
    out.push({
      id: 'discount-creating',
      signal: 'Discounted orders beating the portfolio average',
      context: `${creating.map((b) => b.label).join(', ')} return above ${pct(benchmarks.basketBenchmark)} at order level`,
      diagnosis: 'The discount is buying a basket that pays for it.',
      action: 'Assess',
      tone: 'pos',
      count: creating.reduce((s, b) => s + b.orders, 0),
      revenue: creating.reduce((s, b) => s + b.revenue, 0),
    });
  }

  return out;
}
