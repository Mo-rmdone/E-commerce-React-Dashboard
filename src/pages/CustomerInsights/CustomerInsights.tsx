import { useMemo, useState } from 'react';
import { SlidersHorizontal, Users } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS, type RevenueBasis } from '@/config/targets';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useFilters } from '@/hooks/useFilters';
import type { DrillthroughEntity } from '@/hooks/useDrilldown';
import type { PeriodComparison } from '@/data/transformations/filterRows';
import { buildBreakdown, margin, revenue } from '@/data/metrics/breakdowns';
import {
  buildTimeSeries,
  trimEmptyEdges,
  TIME_GRAIN_LABEL,
  type TimeGrain,
} from '@/data/metrics/timeseries';
import { buildAlerts, buildHealthScore } from '@/data/metrics/alerts';
import { Card, EmptyState, MicroBar, Segmented } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { TrajectoryChart, type TrajectoryMetric } from '@/components/charts/TrajectoryChart';
import { AlertGrid } from '@/components/alerts/AlertGrid';
import { int, pct, pctSigned, truncate, usd } from '@/utils/format';
import '../pages.css';

interface CustomerRow {
  key: number;
  id: string;
  country: string;
  countryKey: number;
  segment: string;
  spend: number;
  orders: number;
  profit: number;
  margin: number | null;
  growth: number | null;
  lines: number;
}

/**
 * Page 3 — Customer Insights & Market Deep-Dive.
 *
 * Answers: who are the highest-value customers, and how are their markets
 * evolving?
 */
export function CustomerInsights({
  ds,
  onOpenDetail,
}: {
  ds: Dataset;
  onOpenDetail: (e: DrillthroughEntity) => void;
}) {
  const data = useDashboardData(ds);
  const { filters, toggle, basis, setDimension } = useFilters();
  const [grain, setGrain] = useState<TimeGrain>('quarter');

  const customers = useMemo(
    () => buildCustomerRows(ds, data.rows, data.comparison, basis),
    [ds, data.rows, data.comparison, basis],
  );

  const series = useMemo(
    () => trimEmptyEdges(buildTimeSeries(ds, data.rows, grain, basis)),
    [ds, data.rows, grain, basis],
  );

  const alerts = useMemo(
    () => buildAlerts(data.kpiContext, basis),
    [data.kpiContext, basis],
  );
  const health = useMemo(
    () => buildHealthScore(data.kpiContext, basis),
    [data.kpiContext, basis],
  );

  const maxSpend = customers[0]?.spend ?? 1;
  const maxProfit = Math.max(...customers.slice(0, 20).map((c) => Math.abs(c.profit)), 1);

  const visible = new Set<TrajectoryMetric>(['revenue', 'profit']);

  const scopeLabel = describeScope(ds, filters);

  const columns: Column<CustomerRow>[] = [
    {
      id: 'rank',
      header: '#',
      width: '34px',
      render: (_r, i) => <span className="num dim">{i + 1}</span>,
    },
    {
      id: 'customer',
      header: 'Customer',
      sortValue: (r) => r.id,
      render: (r) => (
        <div className="cust">
          <span className="cust__id num">{r.id}</span>
          <span className="cust__meta">
            {r.country} · {r.segment}
          </span>
        </div>
      ),
    },
    {
      id: 'spend',
      header: 'Spend',
      align: 'right',
      sortValue: (r) => r.spend,
      width: '132px',
      render: (r) => (
        <div className="cell-bar">
          <span className="num">{usd(r.spend)}</span>
          <MicroBar value={r.spend} max={maxSpend} tone="accent" />
        </div>
      ),
    },
    {
      id: 'orders',
      header: 'Orders',
      align: 'right',
      sortValue: (r) => r.orders,
      width: '62px',
      hideBelow: 1280,
      render: (r) => <span className="num">{int(r.orders)}</span>,
    },
    {
      id: 'profit',
      header: 'Profit',
      align: 'right',
      sortValue: (r) => r.profit,
      width: '132px',
      render: (r) => (
        <div className="cell-bar">
          <span className={`num ${r.profit < 0 ? 'val--neg' : ''}`}>{usd(r.profit)}</span>
          <MicroBar
            value={Math.abs(r.profit)}
            max={maxProfit}
            tone={r.profit < 0 ? 'neg' : 'pos'}
          />
        </div>
      ),
    },
    {
      id: 'margin',
      header: 'Margin',
      align: 'right',
      sortValue: (r) => r.margin ?? -99,
      width: '72px',
      hideBelow: 1440,
      render: (r) => (
        <span
          className={`num ${
            r.margin !== null && r.margin >= BUSINESS_TARGETS.profitMargin
              ? 'val--pos'
              : 'val--neg'
          }`}
        >
          {pct(r.margin)}
        </span>
      ),
    },
    {
      id: 'growth',
      header: 'YoY',
      align: 'right',
      sortValue: (r) => r.growth ?? -99,
      width: '74px',
      render: (r) => (
        <span className={`num ${r.growth === null ? 'dim' : r.growth >= 0 ? 'val--pos' : 'val--neg'}`}>
          {r.growth === null ? 'new' : pctSigned(r.growth, 0)}
        </span>
      ),
    },
  ];

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
        <Card
          title="High-value customers"
          span="table"
          subtitle={scopeLabel}
          info={
            <InfoDot label="About this table">
              The workbook carries customer IDs but no names. US customer IDs were de-duplicated
              on import — their 9th digit encodes a US sub-region, not a customer, and left as
              supplied it inflated the US customer count roughly 3.2×. Ranked by spend on the
              active revenue basis; click a row to filter the page to that customer's country.
            </InfoDot>
          }
        >
          <DataTable
            rows={customers}
            columns={columns}
            rowKey={(r) => r.key}
            maxRows={10}
            searchText={(r) => `${r.id} ${r.country} ${r.segment}`}
            searchPlaceholder="Search customer, country or segment…"
            initialSort={{ column: 'spend', direction: 'desc' }}
            isSelected={(r) => filters.country.includes(r.countryKey)}
            onSelect={(r) => toggle('country', r.countryKey, 'Customer table')}
            onOpen={(r) => onOpenDetail({ kind: 'customer', key: r.key })}
            emptyTitle="No customers in view"
            emptyMessage="No order lines match the current filter."
          />
          <CustomerDepthNote ds={ds} rows={data.rows} count={customers.length} />
        </Card>

        <Card
          title="Market trend"
          span="trend"
          subtitle={scopeLabel}
          info={
            <InfoDot label="About this chart">
              Follows whatever the rest of the dashboard is filtered to — pick a market or country
              anywhere and this chart re-scopes. Year, quarter and month are all sound in this
              data; day-of-week is not offered, because the synthesised order dates leave a
              degenerate weekday distribution.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Time grain"
              value={grain}
              onChange={setGrain}
              options={(['year', 'quarter', 'month'] as TimeGrain[]).map((g) => ({
                value: g,
                label: TIME_GRAIN_LABEL[g],
              }))}
            />
          }
        >
          <TrajectoryChart points={series} basis={basis} visible={visible} height={228} />
        </Card>

        <Card
          title="Strategic recommendations"
          span="alerts"
          subtitle={`${alerts.length} generated from this view`}
          info={
            <InfoDot label="About these recommendations">
              Every card is derived from the currently filtered data against the four business
              targets. Change a filter and the set changes; a condition that does not hold
              produces no card.
            </InfoDot>
          }
        >
          <AlertGrid
            alerts={alerts}
            health={health}
            onAct={(dimension, value) => setDimension(dimension, [value], 'Recommendation')}
          />
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function buildCustomerRows(
  ds: Dataset,
  rows: Int32Array,
  comparison: PeriodComparison | null,
  basis: RevenueBasis,
): CustomerRow[] {
  const items = buildBreakdown(ds, rows, comparison, 'customer', {
    basis,
    distinct: true,
  });

  // Country and segment are stable per customer in this workbook (verified in
  // the audit), so the first row's values describe the customer.
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

  return items.slice(0, 400).map((b) => {
    const ck = firstCountry.get(b.key) ?? 0;
    return {
      key: b.key,
      id: b.label,
      country: ds.dims.countries[ck]?.name ?? '—',
      countryKey: ck,
      segment: ds.dims.segments[firstSegment.get(b.key) ?? 0] ?? '—',
      spend: revenue(b.current, basis),
      orders: b.current.orders,
      profit: b.current.profit,
      margin: margin(b.current, basis),
      growth: b.growth,
      lines: b.current.lines,
    };
  });
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
  return parts.length ? truncate(parts.join(' · '), 48) : 'All markets, all years';
}

/**
 * Honest note about ranking depth.
 *
 * The brief asks for a top-10 per country per year, but roughly half of all
 * country-year cells in this workbook hold fewer than 10 distinct customers.
 * Rather than render a short list as though it were a full ranking, the table
 * says how deep the pool actually is.
 */
function CustomerDepthNote({
  ds,
  rows,
  count,
}: {
  ds: Dataset;
  rows: Int32Array;
  count: number;
}) {
  const distinct = useMemo(() => {
    const seen = new Uint8Array(ds.dims.customers.length);
    let n = 0;
    for (let j = 0; j < rows.length; j++) {
      const c = ds.facts.customer[rows[j]];
      if (!seen[c]) {
        seen[c] = 1;
        n++;
      }
    }
    return n;
  }, [ds, rows]);

  const thin = distinct < 10;

  return (
    <p className={`depthnote ${thin ? 'depthnote--thin' : ''}`}>
      <Users size={12} aria-hidden />
      <span>
        <strong className="num">{int(distinct)}</strong> distinct customers in this view
        {thin ? (
          <> — too few for a meaningful top-10 ranking. Widen the filter for a fuller picture.</>
        ) : (
          <> · showing the top {Math.min(10, count)} by spend</>
        )}
      </span>
    </p>
  );
}
