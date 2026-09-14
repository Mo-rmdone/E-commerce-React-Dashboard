import { useMemo, useState } from 'react';
import { Download, Info, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { useDashboardData, useBreakdown } from '@/hooks/useDashboardData';
import { useFilters } from '@/hooks/useFilters';
import type { DrillthroughEntity } from '@/hooks/useDrilldown';
import {
  ACTION_RATIONALE,
  buildCustomerAnalytics,
  buildConcentration,
  buildExecutiveTakeaways,
  buildSegmentCategoryFlow,
  buildSegmentCategoryMatrix,
  QUADRANT_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type CustomerPoint,
  type CustomerStatus,
  type FlowMetric,
  type LevelNode,
} from '@/data/metrics/customers';
import { buildAlerts, buildHealthScore } from '@/data/metrics/alerts';
import { Card, EmptyState, MicroBar, Segmented, Delta } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Heatmap } from '@/components/charts/Heatmap';
import { LevelSankey } from '@/components/charts/LevelSankey';
import { CustomerConcentration } from '@/components/charts/CustomerConcentration';
import { HealthDial } from '@/components/cards/HealthDial';
import { SignalPanel } from './SignalPanel';
import { categorical } from '@/config/theme';
import { int, pct, pctSigned, ppSigned, truncate, usd, usdShort } from '@/utils/format';
import { downloadCsv, type CsvColumn } from '@/utils/csv';
import './customer-insights.css';
import '../pages.css';

type WatchTab = 'all' | 'high-opportunity' | 'margin-risk' | 'at-risk';

const WATCH_TABS: { value: WatchTab; label: string }[] = [
  { value: 'all', label: 'All Customers' },
  { value: 'high-opportunity', label: 'High Opportunity' },
  { value: 'margin-risk', label: 'Margin Risk' },
  { value: 'at-risk', label: 'At Risk' },
];

const TAB_STATUS: Record<Exclude<WatchTab, 'all'>, CustomerStatus> = {
  'high-opportunity': 'high-opportunity',
  'margin-risk': 'margin-risk',
  'at-risk': 'at-risk',
};

/** How far below the margin target still reads as "near" on the matrix. */
const NEAR_BAND = 0.05;

/**
 * Page 3 — Commercial Performance & Value Drivers.
 *
 * Read in pairs, top to bottom: how healthy is the business and what is it made
 * of; who needs action and what should be decided; where does value flow and
 * where is profitability under pressure; and finally how exposed the revenue
 * base is. Each pair shares a grid row and every card states its own title, so
 * the page scans as a grid of answers rather than a scroll of charts.
 */
export function CustomerInsights({
  ds,
  onOpenDetail,
}: {
  ds: Dataset;
  onOpenDetail: (e: DrillthroughEntity) => void;
}) {
  const data = useDashboardData(ds);
  const { filters, toggle, setDimension, basis } = useFilters();
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [watchTab, setWatchTab] = useState<WatchTab>('all');
  const [flowMetric, setFlowMetric] = useState<FlowMetric>('sales');

  const palette = categorical();
  const segments = useBreakdown(ds, data, 'segment', { distinct: true });

  const analytics = useMemo(
    () => buildCustomerAnalytics(ds, data.rows, data.comparison, basis),
    [ds, data.rows, data.comparison, basis],
  );
  const flow = useMemo(
    () => buildSegmentCategoryFlow(ds, data.rows, flowMetric),
    [ds, data.rows, flowMetric],
  );
  const segCat = useMemo(() => buildSegmentCategoryMatrix(ds, data.rows), [ds, data.rows]);
  const signals = useMemo(() => buildAlerts(data.kpiContext, basis), [data.kpiContext, basis]);
  const health = useMemo(() => buildHealthScore(data.kpiContext, basis), [data.kpiContext, basis]);
  const concentration = useMemo(() => buildConcentration(analytics.points), [analytics.points]);
  const takeaways = useMemo(
    () => buildExecutiveTakeaways(ds, data.rows, segCat, analytics.points, segments),
    [ds, data.rows, segCat, analytics.points, segments],
  );

  // Selecting a customer anywhere highlights it everywhere else that shows
  // customers — it never touches the global filter, so picking one person never
  // silently narrows unrelated cards.
  const selectedPoint = useMemo(
    () =>
      selectedCustomer !== null
        ? (analytics.points.find((p) => p.key === selectedCustomer) ?? null)
        : null,
    [analytics.points, selectedCustomer],
  );
  const selectedRank =
    selectedCustomer !== null ? (concentration.rankOf.get(selectedCustomer) ?? null) : null;
  const toggleSelect = (key: number) => setSelectedCustomer((cur) => (cur === key ? null : key));

  const watchRows = useMemo(() => {
    if (watchTab === 'all') return analytics.points;
    const status = TAB_STATUS[watchTab];
    return analytics.points.filter((p) => p.status === status);
  }, [analytics.points, watchTab]);

  const maxSpend = Math.max(1, ...analytics.points.map((p) => p.spend));
  const scopeLabel = describeScope(ds, filters);

  const columns: Column<CustomerPoint>[] = [
    {
      id: 'rank',
      header: '#',
      width: '32px',
      render: (_r, i) => <span className="num dim">{i + 1}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      sortValue: (r) => r.id,
      render: (r) => (
        <span className="cust__id num" title={r.id}>
          {r.id}
        </span>
      ),
    },
    {
      id: 'market',
      header: 'Market',
      sortValue: (r) => r.market,
      hideBelow: 1440,
      render: (r) => (
        <span title={r.country}>
          {r.market}
          <span className="cust__sub">{r.country}</span>
        </span>
      ),
    },
    {
      id: 'segment',
      header: 'Segment',
      sortValue: (r) => r.segment,
      hideBelow: 1600,
      render: (r) => <span>{r.segment}</span>,
    },
    {
      id: 'sales',
      header: 'Revenue',
      align: 'right',
      width: '136px',
      sortValue: (r) => r.spend,
      render: (r) => (
        <div className="cell-bar">
          <span className="num">{usd(r.spend)}</span>
          <MicroBar value={r.spend} max={maxSpend} tone="accent" />
        </div>
      ),
    },
    {
      id: 'margin',
      header: 'Margin',
      align: 'right',
      width: '76px',
      sortValue: (r) => r.margin ?? -99,
      render: (r) => (
        <span
          className={`num ${
            r.margin !== null && r.margin >= BUSINESS_TARGETS.profitMargin ? 'val--pos' : 'val--neg'
          }`}
        >
          {pct(r.margin)}
        </span>
      ),
    },
    {
      id: 'growth',
      header: 'Growth',
      align: 'right',
      width: '78px',
      hideBelow: 1280,
      sortValue: (r) => r.growth ?? -99,
      render: (r) =>
        r.growth === null ? (
          <span className="num dim">new</span>
        ) : (
          <Delta value={r.growth} format={(v) => pctSigned(v, 0)} />
        ),
    },
    {
      id: 'status',
      header: 'Risk / Status',
      align: 'right',
      width: '128px',
      sortValue: (r) => r.status,
      render: (r) => (
        <span className={`chip chip--${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      ),
    },
    {
      id: 'action',
      header: 'Recommended action',
      align: 'right',
      width: '124px',
      sortValue: (r) => r.action,
      render: (r) => (
        <span className="cust__action" title={ACTION_RATIONALE[r.action]}>
          {r.action}
        </span>
      ),
    },
  ];

  const csvColumns: CsvColumn<CustomerPoint>[] = [
    { header: 'Rank', value: (_r) => 0 },
    { header: 'Customer ID', value: (r) => r.id },
    { header: 'Market', value: (r) => r.market },
    { header: 'Country', value: (r) => r.country },
    { header: 'Segment', value: (r) => r.segment },
    { header: 'Revenue (USD)', value: (r) => Math.round(r.spend) },
    { header: 'Profit (USD)', value: (r) => Math.round(r.profit) },
    { header: 'Margin', value: (r) => (r.margin === null ? '' : (r.margin * 100).toFixed(1)) },
    { header: 'Orders', value: (r) => r.orders },
    { header: 'YoY growth %', value: (r) => (r.growth === null ? '' : (r.growth * 100).toFixed(1)) },
    { header: 'Quadrant', value: (r) => QUADRANT_LABEL[r.quadrant] },
    { header: 'Status', value: (r) => STATUS_LABEL[r.status] },
    { header: 'Recommended action', value: (r) => r.action },
    { header: 'Order lines', value: (r) => r.lines },
  ];
  const exportAll = () => {
    // Every customer in the current filter, fully ranked by spend — not just
    // the ten on screen, so the file is always the complete picture.
    const ranked = analytics.points.map((r, i) => ({ ...r, rank: i + 1 }));
    const cols = csvColumns.map((c) =>
      c.header === 'Rank' ? { ...c, value: (r: CustomerPoint & { rank: number }) => r.rank } : c,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`customer_watchlist_${stamp}`, ranked, cols as CsvColumn<CustomerPoint>[]);
  };

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

  return (
    <div className="page">
      <div className="grid grid--cust">
        {/* ---------------------------------------------- watchlist · signals */}
        <Card
          title="Customer opportunity & risk"
          span="watch"
          // Rows share the spare height only when there are enough of them to
          // do it without each becoming a band.
          className={watchRows.length >= 8 ? 'card--fill-table' : ''}
          subtitle={
            watchTab === 'all'
              ? `Top 10 by revenue · ${scopeLabel}`
              : `${STATUS_LABEL[TAB_STATUS[watchTab]]} · ${int(watchRows.length)} customers`
          }
          tools={
            <>
              <Segmented
                label="Watchlist filter"
                value={watchTab}
                onChange={setWatchTab}
                options={WATCH_TABS}
              />
              <button
                type="button"
                className="btn"
                onClick={exportAll}
                disabled={analytics.points.length === 0}
                title="Download every customer in the current filter as a CSV, fully ranked"
              >
                <Download size={13} />
                Export all
              </button>
            </>
          }
          info={
            <InfoDot label="About this table">
              The ten highest-revenue customers in the current filter; Export all writes every one
              of them to CSV. Status is calculated from each customer&rsquo;s own spend, margin and
              growth — not assigned by hand — and the recommended action follows from the status, so
              the two can never disagree. Champion / High Opportunity / Margin Risk come from spend
              and margin against the median and the {pct(BUSINESS_TARGETS.profitMargin, 0)} target;
              At Risk adds one more signal, a customer below the median on both whose spend is
              declining year over year. Click a row to select it (it highlights in the concentration
              chart); double-click to open the full detail.
            </InfoDot>
          }
        >
          <DataTable
            rows={watchRows}
            columns={columns}
            rowKey={(r) => r.key}
            maxRows={10}
            searchText={(r) => `${r.id} ${r.market} ${r.country} ${r.segment}`}
            searchPlaceholder="Search customer, market or segment…"
            initialSort={{ column: 'sales', direction: 'desc' }}
            isSelected={(r) => r.key === selectedCustomer}
            onSelect={(r) => toggleSelect(r.key)}
            onOpen={(r) => onOpenDetail({ kind: 'customer', key: r.key })}
            emptyTitle="No customers in this tab"
            emptyMessage="No customer in the current filter matches this status."
          />
        </Card>

        <Card
          title="Strategic signals"
          span="signals"
          subtitle="Score, findings, decisions"
          info={
            <InfoDot label="About this panel">
              Three readings of the same filtered rows, in the order you would ask for them. The
              composite scores the four business targets — margin, revenue growth, Corporate growth
              and market viability — each contributing the share of its own target achieved, capped
              at 100% so an over-performing target cannot mask a failing one. The signals below it
              are the findings that composite is made of, sorted by severity; Inspect jumps the
              whole page to that slice. The decisions at the foot are the conclusion: protect what
              is leaking, grow what is working, scale what already works.
            </InfoDot>
          }
        >
          <SignalPanel
            signals={signals}
            onAct={(dimension, value) => setDimension(dimension, [value], 'Strategic signal')}
            header={health ? <HealthDial health={health} /> : null}
            footer={
              takeaways.length > 0 ? (
                <div className="decisions">
                  <p className="decisions__label label">Decisions</p>
                  <div className="decisions__list">
                    {takeaways.map((t) => (
                      <article key={t.id} className={`decision decision--${t.id}`}>
                        <span className="decision__kicker">{t.kicker}</span>
                        <p className="decision__metric">
                          <span className="num">{t.metric}</span>
                          <span className="decision__unit">{t.metricLabel}</span>
                        </p>
                        <p className="decision__detail" title={t.detail}>
                          {t.detail}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null
            }
          />
        </Card>

        {/* --------------------------------------------------- flow · matrix */}
        <Card
          title="Revenue flow"
          span="flow"
          subtitle="Total → segment → category"
          info={
            <InfoDot label="About this chart">
              Where the money comes from, decomposed twice: the whole on the left, split by customer
              segment, split again by category. Band thickness is the measure, so the eye compares
              thicknesses directly. Click a segment or category to filter the page.
              {flow.droppedFlows > 0 ? (
                <>
                  {' '}
                  On Profit, {flow.droppedFlows} loss-making segment × category{' '}
                  {flow.droppedFlows === 1 ? 'flow is' : 'flows are'} left out (
                  {usdShort(flow.droppedValue)}) — a flow band cannot be drawn negative.
                </>
              ) : null}
            </InfoDot>
          }
          tools={
            <Segmented
              label="Flow measure"
              value={flowMetric}
              onChange={setFlowMetric}
              options={[
                { value: 'sales', label: 'Sales' },
                { value: 'profit', label: 'Profit' },
              ]}
            />
          }
        >
          <LevelSankey
            graph={flow}
            height={404}
            formatValue={usdShort}
            colorOf={(n: LevelNode) =>
              n.dimension === 'total'
                ? 'var(--c-accent)'
                : n.dimension === 'segment'
                  ? palette[n.key % palette.length]
                  : palette[(n.key + 3) % palette.length]
            }
            isSelected={(n: LevelNode) =>
              n.dimension === 'segment'
                ? filters.segment.includes(n.key)
                : n.dimension === 'category'
                  ? filters.category.includes(n.key)
                  : false
            }
            onSelectNode={(n: LevelNode) =>
              toggle(n.dimension === 'segment' ? 'segment' : 'category', n.key, 'Value flow')
            }
          />
          {flow.droppedFlows > 0 ? (
            <p className="narrative">
              <TriangleAlert size={12} aria-hidden />
              <span>
                <strong className="num">{flow.droppedFlows}</strong> loss-making segment × category{' '}
                {flow.droppedFlows === 1 ? 'flow' : 'flows'} (
                <strong className="num">{usdShort(flow.droppedValue)}</strong>) are not drawn — a
                flow band has no negative width.
              </span>
            </p>
          ) : null}
        </Card>

        <Card
          title="Where is profitability under pressure?"
          span="matrix"
          subtitle="Margin % by segment and category"
          info={
            <InfoDot label="About this matrix">
              Profit margin for every category × segment pair, graded against the{' '}
              {pct(BUSINESS_TARGETS.profitMargin, 0)} target: green clears it, amber is within{' '}
              {ppSigned(-NEAR_BAND)} of it, red is clearly below. Click a category, segment or cell
              to filter the page; use a column&rsquo;s sort control to rank categories by that
              segment&rsquo;s margin.
            </InfoDot>
          }
        >
          <Heatmap
            rows={segCat.rows}
            cols={segCat.cols}
            cells={segCat.cells}
            formatValue={(v) => pct(v + segCat.target)}
            scale="semantic"
            nearBand={NEAR_BAND}
            size="lg"
            fill
            cornerLabel="Category"
            rowNoun="categories"
            rowLabelWidth={150}
            rowLabelChars={22}
            selectedRows={filters.category}
            selectedCols={filters.segment}
            onSelectRow={(k) => toggle('category', k, 'Profitability matrix')}
            onSelectCol={(k) => toggle('segment', k, 'Profitability matrix')}
            onSelectCell={(r, c) => {
              toggle('category', r, 'Profitability matrix');
              toggle('segment', c, 'Profitability matrix');
            }}
          />
          <div className="matlegend">
            <span className="matlegend__item">
              <span className="matlegend__swatch matlegend__swatch--pos" />
              At or above {pct(BUSINESS_TARGETS.profitMargin, 0)} target
            </span>
            <span className="matlegend__item">
              <span className="matlegend__swatch matlegend__swatch--warn" />
              Near target
            </span>
            <span className="matlegend__item">
              <span className="matlegend__swatch matlegend__swatch--neg" />
              Below target
            </span>
          </div>
        </Card>

        {/* ------------------------------------------------------- exposure */}
        <Card
          title="Revenue concentration"
          span="conc"
          subtitle="How dependent is revenue on a small number of customers?"
          info={
            <InfoDot label="About this chart">
              Every customer ranked by annual sales, grouped into equal-sized bands so a base of
              thousands still draws as legible bars. The line is the running share of total revenue;
              the 50/80/90% guides are labelled with the exact number of customers that cross them,
              computed from the full, unbinned ranking.
            </InfoDot>
          }
        >
          <ExposureStrip concentration={concentration} />
          <CustomerConcentration
            data={concentration}
            selectedCustomerRank={selectedRank}
            selectedCustomerLabel={selectedPoint?.id}
            height={252}
          />
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

/** The three exposure bands, stated before the chart that proves them. */
function ExposureStrip({
  concentration,
}: {
  concentration: ReturnType<typeof buildConcentration>;
}) {
  if (concentration.n === 0) return null;
  const { p80, p90 } = concentration.thresholds;
  const bands: { label: string; value: string; note: string }[] = [
    {
      label: 'Top 10 customers',
      value: concentration.top10Share === null ? '—' : pct(concentration.top10Share, 1),
      note: 'of revenue',
    },
    {
      label: 'Top 100 customers',
      value: concentration.top100Share === null ? '—' : pct(concentration.top100Share, 1),
      note: concentration.top100Share === null ? 'base under 100' : 'of revenue',
    },
    {
      label: 'Bottom 50%',
      value: concentration.bottom50Share === null ? '—' : pct(concentration.bottom50Share, 1),
      // The band is everyone past the halfway rank, so on an odd base it holds
      // one more customer than the half it is named for.
      note: `${int(concentration.n - Math.floor(concentration.n / 2))} customers`,
    },
  ];

  return (
    <div className="exposure">
      <div className="exposure__bands">
        {bands.map((b) => (
          <div key={b.label} className="exposure__band">
            <span className="label">{b.label}</span>
            <span className="exposure__value num">{b.value}</span>
            <span className="exposure__note">{b.note}</span>
          </div>
        ))}
      </div>
      <p className="exposure__read">
        <Info size={12} aria-hidden />
        <span>
          {p80 ? (
            <>
              <strong className="num">{int(p80)}</strong> of{' '}
              <strong className="num">{int(concentration.n)}</strong> customers carry 80% of revenue
              {p90 ? (
                <>
                  , and <strong className="num">{int(p90)}</strong> carry 90%
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              Revenue is spread across <strong className="num">{int(concentration.n)}</strong>{' '}
              customers with no dominant few.
            </>
          )}
        </span>
      </p>
    </div>
  );
}

function describeScope(ds: Dataset, filters: ReturnType<typeof useFilters>['filters']): string {
  const parts: string[] = [];
  if (filters.country.length === 1) parts.push(ds.dims.countries[filters.country[0]].name);
  else if (filters.country.length > 1) parts.push(`${filters.country.length} countries`);
  if (filters.market.length === 1) parts.push(ds.dims.markets[filters.market[0]]);
  else if (filters.market.length > 1) parts.push(`${filters.market.length} markets`);
  if (filters.segment.length === 1) parts.push(ds.dims.segments[filters.segment[0]]);
  if (filters.year.length === 1) parts.push(String(filters.year[0]));
  else if (filters.year.length > 1) parts.push(`${filters.year.length} years`);
  return parts.length ? truncate(parts.join(' · '), 40) : 'All markets, all years';
}

