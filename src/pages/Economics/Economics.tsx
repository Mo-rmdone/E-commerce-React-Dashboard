import { useMemo, useState } from 'react';
import { Info, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useFilters } from '@/hooks/useFilters';
import type { DrillthroughEntity } from '@/hooks/useDrilldown';
import {
  buildProductEconomics,
  buildValueLadder,
  buildDiscountEconomics,
  buildPricePosition,
  buildDecisions,
  CLASS_LABEL,
  CLASS_SHORT,
  CLASS_TONE,
  MIN_ORDERS,
  type EconomicClass,
  type ProductEconomics,
} from '@/data/metrics/economics';
import { buildCustomerAnalytics, STATUS_LABEL, STATUS_TONE } from '@/data/metrics/customers';
import { Card, EmptyState, Segmented, Delta } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { QuadrantScatter, type ScatterPoint } from '@/components/charts/QuadrantScatter';
import { int, pct, ppSigned, usd, usdShort } from '@/utils/format';
import './economics.css';
import '../pages.css';

type MatrixMeasure = 'basket' | 'customer';

/**
 * Page 4 — Profitability & Growth Economics.
 *
 * The question the other pages cannot answer: a product losing money on its own
 * line may still be worth carrying, because the order and the customer around
 * it pay. So every measure here is read at three widths — the product, the
 * basket it sits in, and the customer who bought it — and the page classifies
 * on the gap between them rather than on product margin alone.
 */
export function Economics({
  ds,
  onOpenDetail,
}: {
  ds: Dataset;
  onOpenDetail: (e: DrillthroughEntity) => void;
}) {
  const data = useDashboardData(ds);
  const { basis } = useFilters();
  const [measure, setMeasure] = useState<MatrixMeasure>('basket');
  const [picked, setPicked] = useState<number | null>(null);

  const econ = useMemo(() => buildProductEconomics(ds, data.rows), [ds, data.rows]);
  const prior = useMemo(
    () =>
      data.comparison?.priorRows && data.comparison.priorRows.length > 0
        ? buildProductEconomics(ds, data.comparison.priorRows)
        : null,
    [ds, data.comparison],
  );
  const ladder = useMemo(() => buildValueLadder(econ), [econ]);
  const priorLadder = useMemo(() => (prior ? buildValueLadder(prior) : null), [prior]);
  const bands = useMemo(() => buildDiscountEconomics(ds, data.rows), [ds, data.rows]);
  const pricing = useMemo(() => buildPricePosition(econ.items), [econ.items]);
  const decisions = useMemo(() => buildDecisions(econ, bands), [econ, bands]);
  const customers = useMemo(
    () => buildCustomerAnalytics(ds, data.rows, data.comparison, basis),
    [ds, data.rows, data.comparison, basis],
  );

  const selected = picked === null ? null : (econ.items.find((p) => p.key === picked) ?? null);

  if (data.isEmpty) {
    return (
      <div className="page">
        <Card>
          <EmptyState
            icon={SlidersHorizontal}
            title="No data for the selected filters"
            message="Nothing in the workbook matches this combination. Remove a filter to bring results back."
          />
        </Card>
      </div>
    );
  }

  const B = econ.benchmarks;

  return (
    <div className="page">
      <div className="grid grid--econ">
        {/* 1 ------------------------------------------- executive economics */}
        <section className="econ-kpis">
          <Kpi
            label="Product margin"
            value={pct(B.basketBenchmark)}
            note={`${ppSigned(B.basketBenchmark - B.marginTarget)} vs ${pct(B.marginTarget, 0)} target`}
            delta={prior ? B.basketBenchmark - prior.benchmarks.basketBenchmark : null}
            help="Profit as a share of sales across every line in view. This is also the benchmark a basket has to beat to count as valuable."
          />
          <Kpi
            label="Basket contribution"
            value={ladder ? pct(ladder.basketMargin) : '—'}
            note={
              ladder
                ? `${ppSigned(ladder.basketLift)} on ${pct(ladder.productMargin)} product margin`
                : 'No below-target products'
            }
            delta={ladder && priorLadder ? ladder.basketMargin - priorLadder.basketMargin : null}
            help="Margin of the orders containing below-target products, counted whole. The gap against their own product margin is what the basket adds."
          />
          <Kpi
            label="Customer contribution"
            value={ladder ? pct(ladder.customerMargin) : '—'}
            note={ladder ? `${ppSigned(ladder.customerLift)} on product margin` : '—'}
            delta={ladder && priorLadder ? ladder.customerMargin - priorLadder.customerMargin : null}
            help="Margin of every customer who bought a below-target product, across their whole history in view."
          />
          <Kpi
            label="Discount exposure"
            value={pct(exposure(bands).share)}
            note={`${usdShort(exposure(bands).revenue)} sold below breakeven`}
            delta={null}
            help="Share of revenue on lines discounted past their own breakeven. Exposure, not loss: the basket may still pay for it."
          />
          <Kpi
            label="Loss-leader revenue"
            value={usdShort(econ.revenueByClass['loss-leader'])}
            note={`${int(econ.counts['loss-leader'])} products carried by their baskets`}
            delta={null}
            help="Revenue from products that miss the margin target on their own line but sit in orders beating the portfolio average."
            tone="accent"
          />
        </section>

        {/* 2 ------------------------------------------------ value matrix */}
        <Card
          title="Loss leader vs. value creation"
          span="matrix"
          subtitle="Low product margin does not necessarily mean low commercial value"
          info={
            <InfoDot label="About this matrix">
              Every product with at least {MIN_ORDERS} orders, placed by its own margin against the
              margin of the orders or customers around it. The vertical rule is the{' '}
              {pct(B.marginTarget, 0)} margin target. The horizontal rule is the{' '}
              {pct(B.basketBenchmark)} portfolio margin, so a basket only counts as valuable when it
              beats the average order rather than merely clearing zero. Bubble size is revenue.
              Click a product to read it through the rest of the page.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Value measure"
              value={measure}
              onChange={setMeasure}
              options={[
                { value: 'basket', label: 'Basket' },
                { value: 'customer', label: 'Customer' },
              ]}
            />
          }
        >
          <QuadrantScatter
            points={econ.items.map((p) => scatterPoint(p, measure, B.basketBenchmark))}
            xThreshold={B.marginTarget}
            yThreshold={B.basketBenchmark}
            xLabel="Product margin"
            yLabel={measure === 'basket' ? 'Basket contribution' : 'Customer contribution'}
            formatX={(v) => pct(v, 0)}
            formatY={(v) => pct(v, 0)}
            quadrants={{
              topLeft: 'Strategic loss leaders',
              topRight: 'Winners',
              bottomLeft: 'True margin problems',
              bottomRight: 'Underdeveloped',
            }}
            selected={picked}
            onSelect={(k) => setPicked((cur) => (cur === k ? null : k))}
            height={392}
            xClamp={0.02}
          />
          <div className="econ-legend">
            {(Object.keys(CLASS_SHORT) as EconomicClass[]).map((k) => (
              <span key={k} className="econ-legend__item">
                <span className={`econ-legend__dot econ-legend__dot--${CLASS_TONE[k]}`} />
                {CLASS_SHORT[k]}
                <strong className="num">{int(econ.counts[k])}</strong>
              </span>
            ))}
          </div>
          {econ.thin > 0 ? (
            <p className="narrative">
              <Info size={12} aria-hidden />
              <span>
                <strong className="num">{int(econ.thin)}</strong> products have fewer than{' '}
                <strong className="num">{MIN_ORDERS}</strong> orders in this view and are left out —
                a basket margin read off a handful of orders is noise, not a signal.
              </span>
            </p>
          ) : null}
        </Card>

        {/* 3 -------------------------------------------- basket economics */}
        <Card
          title="From entry product to basket value"
          span="ladder"
          subtitle={selected ? selected.label : 'Products below the margin target'}
          info={
            <InfoDot label="About this ladder">
              The same money read at three widths. Product is the line itself. Basket is every order
              containing it, counted whole, including what other products earned in those orders.
              Customer is every buyer's entire history in view. A rising ladder means the product is
              bought alongside things that pay for it.
            </InfoDot>
          }
        >
          {selected ? (
            <Ladder
              rows={[
                { label: 'Product', margin: selected.productMargin, note: usdShort(selected.revenue) },
                {
                  label: 'Basket',
                  margin: selected.basketMargin,
                  note: `${int(selected.orders)} orders`,
                },
                {
                  label: 'Customer',
                  margin: selected.customerMargin,
                  note: `${int(selected.customers)} customers`,
                },
              ]}
              benchmark={B.basketBenchmark}
              facts={[
                ['Cross-sell revenue', usdShort(selected.crossSell)],
                ['Average basket', usd(selected.avgBasket)],
                ['Contribution per order', usd(selected.contributionPerOrder)],
                ['Average discount', pct(selected.avgDiscount)],
              ]}
              verdict={CLASS_LABEL[selected.klass]}
              tone={CLASS_TONE[selected.klass]}
            />
          ) : ladder ? (
            <Ladder
              rows={[
                { label: 'Product', margin: ladder.productMargin, note: `${int(ladder.products)} products` },
                { label: 'Basket', margin: ladder.basketMargin, note: usdShort(ladder.revenue) },
                { label: 'Customer', margin: ladder.customerMargin, note: 'whole history' },
              ]}
              benchmark={B.basketBenchmark}
              facts={[
                ['Cross-sell revenue', usdShort(ladder.crossSell)],
                ['Average basket', usd(ladder.avgBasket)],
                ['Basket lift', ppSigned(ladder.basketLift)],
                ['Customer lift', ppSigned(ladder.customerLift)],
              ]}
              verdict={
                ladder.basketMargin >= B.basketBenchmark
                  ? 'Baskets carry these products'
                  : 'Baskets lift them, but not to the average'
              }
              tone={ladder.basketMargin >= B.basketBenchmark ? 'pos' : 'warn'}
            />
          ) : (
            <EmptyState
              icon={Info}
              title="Nothing below target"
              message="Every product in this view clears the margin target on its own line."
            />
          )}
        </Card>

        {/* 4 ------------------------------------------ customer economics */}
        <Card
          title="Customer profitability"
          span="cust"
          subtitle={`${int(customers.points.length)} customers · spend against margin`}
          info={
            <InfoDot label="About this chart">
              Every customer placed by annual spend against their own margin. The vertical rule is
              the median spend in this view, recomputed on every filter change; the horizontal rule
              is the {pct(BUSINESS_TARGETS.profitMargin, 0)} margin target. Bubble size is order
              count.
            </InfoDot>
          }
        >
          <QuadrantScatter
            points={customers.points.slice(0, 600).map((c) => ({
              key: c.key,
              label: c.id,
              x: c.spend,
              y: c.margin ?? 0,
              size: c.orders,
              tone: scatterTone(STATUS_TONE[c.status]),
              tooltip: {
                title: c.id,
                subtitle: `${c.segment} · ${c.market}`,
                rows: [
                  { label: 'Revenue', value: usd(c.spend), strong: true },
                  { label: 'Margin', value: pct(c.margin) },
                  { label: 'Orders', value: int(c.orders) },
                  { label: 'Growth', value: c.growth === null ? 'new' : pct(c.growth, 0) },
                ],
                status: {
                  level:
                    c.status === 'champion'
                      ? 'on-target'
                      : c.status === 'at-risk'
                        ? 'off-target'
                        : 'at-risk',
                  label: STATUS_LABEL[c.status],
                },
                hint: 'Double-click the watchlist to open a customer',
              },
            }))}
            xThreshold={customers.spendMedian}
            yThreshold={customers.marginTarget}
            xLabel="Customer revenue"
            yLabel="Customer margin"
            formatX={(v) => usdShort(v)}
            formatY={(v) => pct(v, 0)}
            quadrants={{
              topLeft: 'Growth',
              topRight: 'Champions',
              bottomLeft: 'At risk',
              bottomRight: 'Margin risk',
            }}
            onSelect={(k) => onOpenDetail({ kind: 'customer', key: k })}
            height={340}
            xClamp={0.01}
          />
          <p className="narrative">
            <Info size={12} aria-hidden />
            <span>
              Showing the <strong className="num">600</strong> highest-spending customers of{' '}
              <strong className="num">{int(customers.points.length)}</strong>. Beyond that the marks
              overplot into a single band at the origin and stop being readable.
            </span>
          </p>
        </Card>

        {/* 5 ------------------------------------------ discount economics */}
        <Card
          title="Discount impact"
          span="disc"
          subtitle="What the discount bought, not just what it cost"
          info={
            <InfoDot label="About this table">
              Each band shows the margin of the discounted lines themselves, then the margin of the
              orders and customers they sit in. A band counts as destructive only when those orders
              lose money outright, not when the line alone does — a line sold under its own
              breakeven inside an order that beats the {pct(B.basketBenchmark)} portfolio average
              has been paid for by the basket.
            </InfoDot>
          }
        >
          <div className="dtable">
            <div className="dtable__head">
              <span>Band</span>
              <span className="n">Revenue</span>
              <span className="n">Product</span>
              <span className="n">Basket</span>
              <span className="n">Customer</span>
              <span className="n">Avg basket</span>
              <span>Verdict</span>
            </div>
            {bands.map((b) => (
              <div key={b.label} className="dtable__row">
                <span className="dtable__band">{b.label}</span>
                <span className="n num">{usdShort(b.revenue)}</span>
                <span className={`n num ${b.productMargin < 0 ? 'val--neg' : ''}`}>
                  {pct(b.productMargin)}
                </span>
                <span className={`n num ${b.basketMargin < B.basketBenchmark ? 'val--neg' : 'val--pos'}`}>
                  {pct(b.basketMargin)}
                </span>
                <span className="n num">{pct(b.customerMargin)}</span>
                <span className="n num">{usd(b.avgBasket)}</span>
                <span>
                  <span className={`chip chip--${verdictTone(b.verdict)}`}>
                    {verdictWord(b.verdict)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* 6 --------------------------------------------- price position */}
        <Card
          title="Price position vs. assortment"
          span="price"
          subtitle="Internal positioning only — see the note"
          info={
            <InfoDot label="About this chart">
              Each product's unit price as a share of its category's median unit price, against the
              margin it returns. It answers "is this priced below its peers, and what happens when
              it is". It cannot answer whether the price is competitively necessary.
            </InfoDot>
          }
        >
          <QuadrantScatter
            points={pricing.points.map((p) => ({
              key: p.key,
              label: p.label,
              x: p.priceIndex,
              y: p.productMargin,
              size: p.revenue,
              tone: p.productMargin >= B.marginTarget ? 'pos' : p.priceIndex < 1 ? 'accent' : 'neg',
              tooltip: {
                title: p.label,
                subtitle: p.category,
                rows: [
                  { label: 'Unit price', value: usd(p.unitPrice), strong: true },
                  { label: 'Category median', value: usd(p.unitPrice / (p.priceIndex || 1)) },
                  { label: 'Price index', value: `${(p.priceIndex * 100).toFixed(0)}%` },
                  { label: 'Avg discount', value: pct(p.avgDiscount) },
                  { label: 'Net of discount', value: `${(p.netIndex * 100).toFixed(0)}%` },
                  { label: 'Product margin', value: pct(p.productMargin) },
                  { label: 'Basket margin', value: pct(p.basketMargin) },
                ],
              },
            }))}
            xThreshold={1}
            yThreshold={B.marginTarget}
            xLabel="Unit price vs category median"
            yLabel="Product margin"
            formatX={(v) => `${(v * 100).toFixed(0)}%`}
            formatY={(v) => pct(v, 0)}
            quadrants={{
              topLeft: 'Cheap and profitable',
              topRight: 'Premium and profitable',
              bottomLeft: 'Cheap and thin',
              bottomRight: 'Premium and thin',
            }}
            selected={picked}
            onSelect={(k) => setPicked((cur) => (cur === k ? null : k))}
            height={300}
            xClamp={0.02}
          />
          <p className="narrative depthnote--thin">
            <TriangleAlert size={12} aria-hidden />
            <span>
              This workbook holds no competitor prices, no traffic and no conversion, so nothing
              here can say whether a low price is a discipline failure or a competitive
              requirement. Answering that needs market pricing and session data the dataset does
              not contain.
            </span>
          </p>
        </Card>

        {/* 7 ------------------------------------------ decision framework */}
        <Card
          title="Commercial decision"
          span="decide"
          subtitle="Signal → context → diagnosis → action"
          info={
            <InfoDot label="About these decisions">
              Each row is generated from a population that exists in the current view, with the
              count and revenue it covers. A class with no members produces no row, so the table
              never recommends acting on an empty set.
            </InfoDot>
          }
        >
          <div className="decide">
            <div className="decide__head">
              <span>Signal</span>
              <span>Context</span>
              <span>Diagnosis</span>
              <span className="n">Scope</span>
              <span>Action</span>
            </div>
            {decisions.map((d) => (
              <div key={d.id} className="decide__row">
                <span className="decide__signal">{d.signal}</span>
                <span className="decide__ctx">{d.context}</span>
                <span className="decide__diag">{d.diagnosis}</span>
                <span className="n decide__scope">
                  <strong className="num">{int(d.count)}</strong>
                  <span className="num">{usdShort(d.revenue)}</span>
                </span>
                <span>
                  <span className={`chip chip--${d.tone}`}>{d.action}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function Kpi({
  label,
  value,
  note,
  delta,
  help,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  delta: number | null;
  help: string;
  tone?: 'accent';
}) {
  return (
    <article className={`ekpi${tone ? ` ekpi--${tone}` : ''}`}>
      <header className="ekpi__head">
        <span className="label">{label}</span>
        <InfoDot label={`About ${label}`}>{help}</InfoDot>
      </header>
      <p className="ekpi__value num">{value}</p>
      <div className="ekpi__foot">
        {delta !== null ? <Delta value={delta} format={(v) => ppSigned(v)} suffix="YoY" /> : null}
        <span className="ekpi__note">{note}</span>
      </div>
    </article>
  );
}

function Ladder({
  rows,
  benchmark,
  facts,
  verdict,
  tone,
}: {
  rows: { label: string; margin: number; note: string }[];
  benchmark: number;
  facts: [string, string][];
  verdict: string;
  tone: 'pos' | 'accent' | 'warn' | 'neg';
}) {
  const span = Math.max(benchmark, ...rows.map((r) => Math.abs(r.margin))) * 1.15 || 0.3;
  return (
    <div className="ladder">
      <div className="ladder__rows">
        {rows.map((r) => {
          const w = Math.min(100, (Math.abs(r.margin) / span) * 100);
          const neg = r.margin < 0;
          return (
            <div key={r.label} className="ladder__row">
              <span className="ladder__label">{r.label}</span>
              <span className="ladder__track">
                <span
                  className={`ladder__fill ladder__fill--${neg ? 'neg' : 'pos'}`}
                  style={{ transform: `scaleX(${w / 100})` }}
                />
                <span
                  className="ladder__bench"
                  style={{ left: `${Math.min(100, (benchmark / span) * 100)}%` }}
                  aria-hidden
                />
              </span>
              <span className={`ladder__val num ${neg ? 'val--neg' : ''}`}>{pct(r.margin)}</span>
              <span className="ladder__note">{r.note}</span>
            </div>
          );
        })}
      </div>
      <p className={`ladder__verdict ladder__verdict--${tone}`}>{verdict}</p>
      <dl className="ladder__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function scatterPoint(
  p: ProductEconomics,
  measure: MatrixMeasure,
  benchmark: number,
): ScatterPoint {
  return {
    key: p.key,
    label: p.label,
    x: p.productMargin,
    y: measure === 'basket' ? p.basketMargin : p.customerMargin,
    size: p.revenue,
    tone: CLASS_TONE[p.klass],
    tooltip: {
      title: p.label,
      subtitle: `${p.subcategory} · ${p.category}`,
      rows: [
        { label: 'Revenue', value: usd(p.revenue), strong: true },
        { label: 'Discount', value: pct(p.avgDiscount) },
        { label: 'Product margin', value: pct(p.productMargin), tone: p.productMargin < 0 ? 'neg' : undefined },
        { label: 'Basket margin', value: pct(p.basketMargin) },
        { label: 'Customer margin', value: pct(p.customerMargin) },
        { label: 'Orders', value: int(p.orders) },
        { label: 'Customers', value: int(p.customers) },
      ],
      status: {
        level:
          p.klass === 'winner'
            ? 'on-target'
            : p.klass === 'margin-problem'
              ? 'off-target'
              : 'at-risk',
        label: `${CLASS_LABEL[p.klass]} · basket ${p.basketMargin >= benchmark ? 'beats' : 'misses'} average`,
      },
      hint: 'Click to read through the page',
    },
  };
}

function exposure(bands: ReturnType<typeof buildDiscountEconomics>) {
  const total = bands.reduce((s, b) => s + b.revenue, 0);
  const under = bands.filter((b) => b.productMargin < 0);
  const revenue = under.reduce((s, b) => s + b.revenue, 0);
  return { revenue, share: total > 0 ? revenue / total : 0 };
}

/** The status palette carries a neutral the scatter has no mark for. */
function scatterTone(tone: 'pos' | 'accent' | 'warn' | 'neg' | 'neutral'): ScatterPoint['tone'] {
  return tone === 'neutral' ? 'warn' : tone;
}

function verdictWord(v: 'creating' | 'neutral' | 'destructive') {
  return v === 'creating' ? 'Value creating' : v === 'neutral' ? 'Neutral' : 'Destructive';
}
function verdictTone(v: 'creating' | 'neutral' | 'destructive') {
  return v === 'creating' ? 'pos' : v === 'neutral' ? 'warn' : 'neg';
}
