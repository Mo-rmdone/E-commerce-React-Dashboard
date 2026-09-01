import { useMemo, useState } from 'react';
import { ChevronLeft, Info, SlidersHorizontal } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS, gradeAgainstTarget, type RevenueBasis } from '@/config/targets';
import { useDashboardData, useBreakdown } from '@/hooks/useDashboardData';
import { useFilters } from '@/hooks/useFilters';
import { useDrilldown, type DrillthroughEntity } from '@/hooks/useDrilldown';
import { buildTimeSeries, trimEmptyEdges, TIME_GRAIN_LABEL, type TimeGrain } from '@/data/metrics/timeseries';
import { buildBreakdown, margin, revenue } from '@/data/metrics/breakdowns';
import { KpiCard } from '@/components/cards/KpiCard';
import { Card, EmptyState, Segmented, StatusChip } from '@/components/primitives';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { WorldMap, MAP_METRIC_LABEL, type MapMetric } from '@/components/charts/WorldMap';
import { TrajectoryChart, type TrajectoryMetric } from '@/components/charts/TrajectoryChart';
import { SegmentDonut } from '@/components/charts/SegmentDonut';
import { ThresholdBars, type ThresholdBarDatum } from '@/components/charts/ThresholdBars';
import { categorical } from '@/config/theme';
import { int, pct, pctSigned, usd, usdShort } from '@/utils/format';
import '../pages.css';

/**
 * Page 1 — Executive Overview & Geographic Performance.
 *
 * Answers: is the global business healthy, profitable and growing against the
 * targets we committed to?
 */
export function ExecutiveOverview({
  ds,
  onOpenDetail,
}: {
  ds: Dataset;
  onOpenDetail: (e: DrillthroughEntity) => void;
}) {
  const data = useDashboardData(ds);
  const { filters, toggle, basis } = useFilters();

  const [mapMetric, setMapMetric] = useState<MapMetric>('sales');
  const [grain, setGrain] = useState<TimeGrain>('year');
  const [trajectory, setTrajectory] = useState<Set<TrajectoryMetric>>(
    () => new Set<TrajectoryMetric>(['revenue', 'profit', 'growth']),
  );

  const countries = useBreakdown(ds, data, 'country');
  const segments = useBreakdown(ds, data, 'segment', { distinct: true });

  const series = useMemo(
    () => trimEmptyEdges(buildTimeSeries(ds, data.rows, grain, basis)),
    [ds, data.rows, grain, basis],
  );

  // Segment -> Market -> Country -> Customer. The workbook has no sub-segment
  // column, so the drill descends through geography, which it does support.
  const segmentDrill = useDrilldown(['segment', 'market', 'country', 'customer'] as const);

  const drillItems = useMemo(() => {
    const dim = segmentDrill.level;
    if (dim === 'segment') return segments;
    // Each drill step narrows to the selected member without touching the
    // page-level filter, so the rest of the dashboard stays where the user left it.
    const scoped = scopeRows(ds, data.rows, segmentDrill.path);
    const scopedComparison = data.comparison
      ? {
          ...data.comparison,
          currentRows: scopeRows(ds, data.comparison.currentRows, segmentDrill.path),
          priorRows: data.comparison.priorRows
            ? scopeRows(ds, data.comparison.priorRows, segmentDrill.path)
            : null,
        }
      : null;
    return buildBreakdown(ds, scoped, scopedComparison, dim, {
      basis,
      distinct: dim === 'customer',
    });
  }, [ds, data.rows, data.comparison, segments, segmentDrill.level, segmentDrill.path, basis]);

  const drillTotal = useMemo(
    () => drillItems.reduce((s, d) => s + revenue(d.current, basis), 0),
    [drillItems, basis],
  );

  const palette = categorical();

  // The $400K bar is annual, so the map grades countries on the latest full
  // year inside the filter — not on the multi-year total its bubbles size by.
  // It follows the active revenue basis, so the map, the watchlist and the KPI
  // all judge viability on the same number.
  const latestYearSales = useMemo(() => {
    const m = new Map<number, number>();
    const rows = data.comparison?.currentRows;
    if (!rows) return m;
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const c = ds.facts.country[i];
      m.set(c, (m.get(c) ?? 0) + ds.facts.sales[i]);
    }
    return m;
  }, [ds, data.comparison, basis]);

  const watchlist = useMemo<ThresholdBarDatum[]>(() => {
    const latest = latestYear(data.kpiContext.marketYear);
    // Bars rank on the whole window; the arrow judges the latest year against
    // the annual bar. Two questions, answered separately.
    return data.kpiContext.markets
      .map((mk) => {
        const total = revenue(mk.current, basis);
        const inLatest =
          latest === null
            ? 0
            : (data.kpiContext.marketYear.find(
                (m) => m.market === mk.key && m.year === latest,
              )?.sales ?? 0);
        const meets = inLatest >= BUSINESS_TARGETS.marketSalesThreshold;
        const variance = inLatest - BUSINESS_TARGETS.marketSalesThreshold;
        return {
          key: mk.key,
          label: mk.label,
          value: total,
          latest: inLatest,
          variance,
          growth: mk.growth,
          growthStatus: gradeGrowth(mk.growth),
          meets,
          tooltip: {
            title: mk.label,
            subtitle: `${int(mk.current.lines)} order lines in view`,
            rows: [
              { label: 'Total revenue', value: usd(total), strong: true },
              ...(latest ? [{ label: `Revenue, ${latest}`, value: usd(inLatest) }] : []),
              {
                label: meets ? 'Above the bar by' : 'Short of the bar by',
                value: usd(Math.abs(variance)),
                tone: meets ? ('pos' as const) : ('neg' as const),
              },
              { label: 'Margin', value: pct(margin(mk.current, basis)) },
              {
                label: 'YoY growth',
                value: mk.growth === null ? 'no prior year' : pctSigned(mk.growth),
                tone:
                  mk.growth === null
                    ? ('muted' as const)
                    : mk.growth >= 0
                      ? ('pos' as const)
                      : ('neg' as const),
              },
            ],
            status: {
              level: meets ? ('on-target' as const) : ('off-target' as const),
              label: latest
                ? meets
                  ? `Cleared ${usdShort(BUSINESS_TARGETS.marketSalesThreshold)} in ${latest}`
                  : `Below ${usdShort(BUSINESS_TARGETS.marketSalesThreshold)} in ${latest}`
                : 'No full year in view',
            },
            hint: 'Click to filter to this market',
          },
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [data.kpiContext, basis]);

  const latest = latestYear(data.kpiContext.marketYear);

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

      <div className="grid grid--kpi">
        {data.kpis.map((k, i) => (
          <KpiCard key={k.id} kpi={k} index={i} />
        ))}
      </div>

      <div className="grid grid--exec">
        <Card
          title="Global performance by country"
          span="map"
          info={
            <InfoDot label="About this map">
              Position is each country's own latitude and longitude as supplied in the workbook.
              Area encodes magnitude — revenue, or profit when that metric is selected. Colour
              encodes status against whichever target the metric is governed by: the{' '}
              {usdShort(BUSINESS_TARGETS.marketSalesThreshold)} annual sales bar for Revenue, the{' '}
              {pct(BUSINESS_TARGETS.profitMargin, 0)} margin target for Profit and Margin, and the{' '}
              {pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target for Growth. Note the brief
              sets the {usdShort(BUSINESS_TARGETS.marketSalesThreshold)} bar per market, not per
              country — applying it to each of the {ds.dims.countries.length} trading countries is
              an extension, and it is measured on the latest full year in view.
            </InfoDot>
          }
          tools={
            <Segmented
              label="Map metric"
              value={mapMetric}
              onChange={setMapMetric}
              options={(['sales', 'profit', 'margin', 'growth'] as MapMetric[]).map((m) => ({
                value: m,
                label: MAP_METRIC_LABEL[m],
              }))}
            />
          }
        >
          <WorldMap
            ds={ds}
            items={countries}
            metric={mapMetric}
            basis={basis}
            selected={filters.country}
            onSelect={(k) => toggle('country', k, 'Map selection')}
            onOpenDetail={(k) => onOpenDetail({ kind: 'country', key: k })}
            latestYear={data.comparison?.latestYear ?? null}
            latestYearSales={latestYearSales}
            height={318}
          />
        </Card>

        <Card
          title="Composition"
          span="donut"
          subtitle={
            segmentDrill.depth > 0 ? undefined : `${segments.length} segments`
          }
          info={
            <InfoDot label="About this breakdown">
              The workbook has no sub-segment column, so this drills Segment → Market → Country →
              Customer, which the data does support. Double-click a slice to go deeper; drilling
              here does not change the page filter.
            </InfoDot>
          }
          tools={
            segmentDrill.canDrillUp ? (
              <button type="button" className="btn" onClick={segmentDrill.drillUp}>
                <ChevronLeft size={13} />
                Back
              </button>
            ) : null
          }
        >
          {segmentDrill.depth > 0 ? (
            <Breadcrumb
              path={segmentDrill.path.map((p) => p.label)}
              onJump={segmentDrill.jumpTo}
              onReset={segmentDrill.reset}
              rootLabel="All segments"
            />
          ) : null}

          <SegmentDonut
            items={drillItems.slice(0, 12)}
            basis={basis}
            total={drillTotal}
            centreLabel={PLURAL_LEVEL[segmentDrill.level]}
            selected={segmentDrill.level === 'segment' ? filters.segment : []}
            onSelect={(k) => {
              if (segmentDrill.level === 'segment') toggle('segment', k, 'Segment donut');
            }}
            onDrill={
              segmentDrill.nextLevel
                ? (item) =>
                    segmentDrill.drillTo({
                      level: segmentDrill.level,
                      key: item.key,
                      label: item.label,
                    })
                : undefined
            }
            height={168}
            colorOf={(_, i) => palette[i % palette.length]}
          />

          <SegmentTable items={drillItems.slice(0, 6)} basis={basis} palette={palette} />
        </Card>

        <Card
          title="Sales & profit trajectory"
          span="traj"
          info={
            <InfoDot label="About this chart">
              Revenue and profit use separate value axes — they differ by an order of magnitude
              and one shared axis would flatten profit onto the baseline. Bars show year-over-year
              growth against the {pct(BUSINESS_TARGETS.revenueGrowth, 0)} target.
            </InfoDot>
          }
          tools={
            <>
              <div className="legend-toggle" role="group" aria-label="Series shown">
                {(
                  [
                    ['revenue', 'Revenue', 'var(--c-accent)', 'bar'],
                    ['profit', 'Profit', 'var(--c-cat-2)', 'bar'],
                    ['growth', 'Growth', 'var(--c-ink-2)', 'line'],
                  ] as [TrajectoryMetric, string, string, 'bar' | 'line'][]
                ).map(([key, label, color, shape]) => (
                  <button
                    key={key}
                    type="button"
                    className="legend-toggle__btn"
                    aria-pressed={trajectory.has(key)}
                    onClick={() =>
                      setTrajectory((s) => {
                        const next = new Set(s);
                        if (next.has(key)) {
                          if (next.size > 1) next.delete(key);
                        } else next.add(key);
                        return next;
                      })
                    }
                  >
                    {/* The swatch shows the mark, so the legend reads as the
                        chart does: bars for amounts, a line for the rate. */}
                    <span
                      className={`chart-legend__swatch${
                        shape === 'line' ? ' chart-legend__swatch--line' : ''
                      }`}
                      style={{ background: color }}
                      aria-hidden
                    />
                    {label}
                  </button>
                ))}
              </div>
              <Segmented
                label="Time grain"
                value={grain}
                onChange={setGrain}
                options={(['year', 'quarter', 'month'] as TimeGrain[]).map((g) => ({
                  value: g,
                  label: TIME_GRAIN_LABEL[g],
                }))}
              />
            </>
          }
        >
          <TrajectoryChart points={series} basis={basis} visible={trajectory} height={206} />
          <TrajectoryNarrative series={series} />
        </Card>

        <Card
          title="Market viability watchlist"
          span="watch"
          subtitle={latest ? `${latest} vs the annual bar` : undefined}
          info={
            <InfoDot label="About this watchlist">
              Bars rank markets by total revenue across everything in view, with each market's
              profit margin beside it, coloured against the {pct(BUSINESS_TARGETS.profitMargin, 0)}{' '}
              target. The arrow
              beside each answers a separate question — whether that market cleared the{' '}
              {usdShort(BUSINESS_TARGETS.marketSalesThreshold)} bar in {latest ?? 'the latest year'},
              since the target is annual. The two are kept apart deliberately: a multi-year total
              measured against a one-year bar would clear it by arithmetic, not performance.
            </InfoDot>
          }
        >
          <ThresholdBars
            data={watchlist}
            formatValue={usdShort}
            formatGrowth={(v) => pctSigned(v, 1)}
            periodLabel={`Bars: total revenue, coloured by whether ${
              latest ?? 'the latest year'
            } cleared ${usdShort(
              BUSINESS_TARGETS.marketSalesThreshold,
            )} · growth vs the ${pct(BUSINESS_TARGETS.revenueGrowth, 0)} target`}
            selected={filters.market}
            onSelect={(k) => toggle('market', k, 'Watchlist selection')}
          />
          <WatchlistSummary data={watchlist} />
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

/**
 * Three states for a growth figure, which the default target tolerance cannot
 * express: it treats anything more than 2% below target as a miss, so a market
 * growing a healthy 17% would read the same red as one that is shrinking.
 * Here "short of target" and "going backwards" are different problems.
 */
function gradeGrowth(g: number | null): 'on-target' | 'at-risk' | 'off-target' | 'neutral' {
  if (g === null || !Number.isFinite(g)) return 'neutral';
  if (g >= BUSINESS_TARGETS.revenueGrowth) return 'on-target';
  return g >= 0 ? 'at-risk' : 'off-target';
}

/** The donut's centre names what its slices are, so it reads as a plural. */
const PLURAL_LEVEL: Record<'segment' | 'market' | 'country' | 'customer', string> = {
  segment: 'segments',
  market: 'markets',
  country: 'countries',
  customer: 'customers',
};

function latestYear(marketYear: { year: number }[]): number | null {
  if (marketYear.length === 0) return null;
  return Math.max(...marketYear.map((m) => m.year));
}

/** Narrow rows to a drill path without touching the global filter store. */
function scopeRows(
  ds: Dataset,
  rows: Int32Array,
  path: { level: string; key: number }[],
): Int32Array {
  if (path.length === 0) return rows;
  const f = ds.facts;
  const out = new Int32Array(rows.length);
  let k = 0;
  outer: for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    for (const step of path) {
      const col =
        step.level === 'segment'
          ? f.segment[i]
          : step.level === 'market'
            ? f.market[i]
            : step.level === 'country'
              ? f.country[i]
              : f.customer[i];
      if (col !== step.key) continue outer;
    }
    out[k++] = i;
  }
  return out.subarray(0, k);
}

function Breadcrumb({
  path,
  onJump,
  onReset,
  rootLabel,
}: {
  path: string[];
  onJump: (i: number) => void;
  onReset: () => void;
  rootLabel: string;
}) {
  return (
    <nav className="crumbs" aria-label="Drill path">
      <button type="button" className="crumbs__item" onClick={onReset}>
        {rootLabel}
      </button>
      {path.map((label, i) => (
        <span key={`${label}-${i}`} className="crumbs__seg">
          <span className="crumbs__sep" aria-hidden>
            ›
          </span>
          <button
            type="button"
            className="crumbs__item"
            onClick={() => onJump(i)}
            aria-current={i === path.length - 1 ? 'true' : undefined}
          >
            {label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function SegmentTable({
  items,
  basis,
  palette,
}: {
  items: ReturnType<typeof buildBreakdown>;
  basis: RevenueBasis;
  palette: string[];
}) {
  if (items.length === 0) return null;

  // The total is summed from the same rows the slices come from, so the footer
  // can never disagree with the body above it.
  const totalRevenue = items.reduce((a, s) => a + revenue(s.current, basis), 0);
  const totalProfit = items.reduce((a, s) => a + s.current.profit, 0);
  const totalMargin = totalRevenue > 0 ? totalProfit / totalRevenue : null;

  // Growth is annual, so the total compares the same two years every row does:
  // the sum of the latest year against the sum of the prior year. Dividing the
  // multi-year total by a single prior year would read as +268%.
  const latestRevenue = items.reduce((a, s) => a + (s.latest ? revenue(s.latest, basis) : 0), 0);
  const priorRevenue = items.reduce((a, s) => a + (s.prior ? revenue(s.prior, basis) : 0), 0);
  const totalGrowth =
    priorRevenue > 0 && latestRevenue > 0 ? (latestRevenue - priorRevenue) / priorRevenue : null;

  return (
    <table className="minitable">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col" className="n">Revenue</th>
          <th scope="col" className="n">Margin</th>
          <th scope="col" className="n">YoY</th>
          <th scope="col" className="n">Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((s, i) => {
          const m = margin(s.current, basis);
          return (
            <tr key={s.key}>
              <th scope="row">
                <span className="minitable__cell">
                  <span
                    className="minitable__dot"
                    style={{ background: palette[i % palette.length] }}
                    aria-hidden
                  />
                  <span className="minitable__name">{s.label}</span>
                </span>
              </th>
              <td className="n num">{usdShort(revenue(s.current, basis))}</td>
              <td className="n num">
                <span
                  className={
                    m !== null && m >= BUSINESS_TARGETS.profitMargin ? 'val--pos' : 'val--neg'
                  }
                >
                  {pct(m)}
                </span>
              </td>
              <td className="n num">
                <span className={s.growth === null ? '' : s.growth >= 0 ? 'val--pos' : 'val--neg'}>
                  {s.growth === null ? '—' : pctSigned(s.growth, 0)}
                </span>
              </td>
              <td className="n">
                <StatusChip level={gradeAgainstTarget(m, BUSINESS_TARGETS.profitMargin)} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="minitable__total">
          <th scope="row">
            <span className="minitable__cell">
              <span className="minitable__dot minitable__dot--none" aria-hidden />
              <span className="minitable__name">Total</span>
            </span>
          </th>
          <td className="n num">{usdShort(totalRevenue)}</td>
          <td className="n num">
            <span
              className={
                totalMargin !== null && totalMargin >= BUSINESS_TARGETS.profitMargin
                  ? 'val--pos'
                  : 'val--neg'
              }
            >
              {pct(totalMargin)}
            </span>
          </td>
          <td className="n num">
            {totalGrowth !== null ? (
              <span className={totalGrowth >= 0 ? 'val--pos' : 'val--neg'}>
                {pctSigned(totalGrowth, 0)}
              </span>
            ) : (
              '—'
            )}
          </td>
          <td className="n">
            <StatusChip level={gradeAgainstTarget(totalMargin, BUSINESS_TARGETS.profitMargin)} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * One sentence describing what the trajectory actually shows, generated from
 * the plotted points. It replaces the paragraph of static commentary a static
 * dashboard would carry.
 */
function TrajectoryNarrative({ series }: { series: ReturnType<typeof buildTimeSeries> }) {
  const withGrowth = series.filter((p) => p.yoy !== null);
  if (withGrowth.length === 0) {
    return (
      <p className="narrative">
        <Info size={12} aria-hidden />
        Not enough history in this filter to measure growth — a full prior period is needed.
      </p>
    );
  }
  const hits = withGrowth.filter((p) => (p.yoy as number) >= BUSINESS_TARGETS.revenueGrowth);
  const last = withGrowth[withGrowth.length - 1];
  return (
    <p className="narrative">
      <Info size={12} aria-hidden />
      {hits.length} of {withGrowth.length} periods cleared the{' '}
      {pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target. Latest: {last.label} at{' '}
      <strong>{pctSigned(last.yoy)}</strong>.
    </p>
  );
}

function WatchlistSummary({ data }: { data: ThresholdBarDatum[] }) {
  if (data.length === 0) return null;
  const above = data.filter((d) => d.meets).length;
  const below = data.length - above;
  const worst = [...data].sort((a, b) => a.variance - b.variance)[0];
  return (
    <div className="watchsum">
      <div className="watchsum__stat">
        <StatusChip level={above === data.length ? 'on-target' : 'at-risk'} label={`${above} above`} />
        <StatusChip level={below > 0 ? 'off-target' : 'neutral'} label={`${below} below`} />
      </div>
      {below > 0 ? (
        <p className="watchsum__note">
          <strong>{worst.label}</strong> is furthest from the threshold, short by{' '}
          <span className="num">{usd(Math.abs(worst.variance))}</span>.
        </p>
      ) : (
        <p className="watchsum__note">Every market in view clears the annual threshold.</p>
      )}
    </div>
  );
}
