import { useEffect, useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { scaleSqrt } from 'd3-scale';
import { max } from 'd3-array';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import { Globe2, Minus, Plus, Crosshair } from 'lucide-react';
import type { Breakdown, Dataset } from '@/types';
import { BUSINESS_TARGETS, gradeAgainstTarget, type RevenueBasis } from '@/config/targets';
import { margin, revenue } from '@/data/metrics/breakdowns';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { ordinal, pct, pctSigned, usd, usdShort } from '@/utils/format';

/**
 * Geographic performance.
 *
 * Every country in the workbook carries its own latitude and longitude, and
 * those are what position the bubbles — no coordinate is invented or looked up.
 * Country outlines come from Natural Earth purely as context; 11 of the 164
 * trading countries have no boundary match in that file, and they still plot
 * correctly as bubbles because the coordinates are the workbook's own.
 *
 * Bubble area encodes the chosen metric's magnitude, colour encodes status
 * against the relevant target. Size and colour therefore answer two different
 * questions rather than restating one.
 */

export type MapMetric = 'sales' | 'profit' | 'margin' | 'growth';

export const MAP_METRIC_LABEL: Record<MapMetric, string> = {
  sales: 'Revenue',
  profit: 'Profit',
  margin: 'Margin',
  growth: 'Growth',
};

interface MapDatum {
  key: number;
  name: string;
  lat: number;
  lon: number;
  value: number;
  magnitude: number;
  status: ReturnType<typeof gradeAgainstTarget>;
  breakdown: Breakdown;
  rank: number;
  /** Sales in the latest year, which is what the $400K bar is measured on. */
  annualSales: number;
}

export function WorldMap({
  ds,
  items,
  metric,
  basis,
  selected,
  onSelect,
  onOpenDetail,
  latestYear,
  latestYearSales,
  height = 320,
}: {
  ds: Dataset;
  items: Breakdown[];
  metric: MapMetric;
  basis: RevenueBasis;
  selected: number[];
  onSelect: (countryKey: number) => void;
  onOpenDetail?: (countryKey: number) => void;
  /** Latest full year inside the filter — the $400K bar is an annual one. */
  latestYear: number | null;
  /** Sales in `latestYear`, per country key. */
  latestYearSales: Map<number, number>;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [land, setLand] = useState<FeatureCollection | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}countries-110m.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((topo: Topology) => {
        if (!alive) return;
        const geo = feature(
          topo,
          topo.objects.countries as GeometryCollection,
        ) as unknown as FeatureCollection;
        setLand(geo);
      })
      // Boundaries are context, not data. Without them the bubbles still carry
      // every value, so a failed fetch degrades rather than breaks the visual.
      .catch(() => setLand(null));
    return () => {
      alive = false;
    };
  }, []);

  const w = size.width;

  const geom = useMemo(() => {
    if (w < 120) return null;
    const h = height;
    const projection = geoNaturalEarth1()
      .fitExtent(
        [
          [6, 6],
          [w - 6, h - 6],
        ],
        { type: 'Sphere' },
      )
      .clipAngle(180);

    const path = geoPath(projection);
    return { projection, path, graticule: path(geoGraticule10()) ?? '', h };
  }, [w, height]);

  /**
   * Choropleth backdrop: country fill intensity by revenue.
   *
   * Bands are decades — powers of ten — rather than quantiles. Country revenue
   * spans five orders of magnitude here ($10 to $1.33M), so quantile bands
   * would encode rank and put a $28K country in the same shade as the United
   * States. Decades encode magnitude, which is what the fill is claiming to
   * show, and they stay round enough to read. The top decade is derived from
   * the data, so the bands rescale when the filter narrows.
   */
  const choropleth = useMemo(() => {
    const byAtlas = new Map<string, { key: number; value: number }>();
    let hi = 0;
    for (const b of items) {
      const v = revenue(b.current, basis);
      if (v <= 0) continue;
      if (v > hi) hi = v;
      const atlasId = ds.dims.countries[b.key]?.atlasId;
      if (atlasId) byAtlas.set(atlasId, { key: b.key, value: v });
    }
    if (hi <= 0) return { byAtlas, band: () => -1, edges: [] as number[] };

    // Largest power of ten at or below the biggest country, then two below it.
    const top = Math.pow(10, Math.floor(Math.log10(hi)));
    const edges = [top / 100, top / 10, top];

    return {
      byAtlas,
      band: (v: number) => (v >= edges[2] ? 3 : v >= edges[1] ? 2 : v >= edges[0] ? 1 : 0),
      edges,
    };
  }, [items, basis, ds]);

  const data = useMemo<MapDatum[]>(() => {
    if (!geom) return [];
    const withValue = items
      .map((b, i) => {
        const value = valueOf(b, metric, basis);
        return { b, i, value };
      })
      .filter((d) => d.value !== null) as { b: Breakdown; i: number; value: number }[];

    // Area always encodes magnitude. For every metric except Profit that is
    // revenue, so a big market stays big regardless of which lens is active.
    const magnitudes = withValue.map((d) =>
      metric === 'profit' ? Math.abs(d.value) : revenue(d.b.current, basis),
    );
    const hi = max(magnitudes) ?? 1;
    const r = scaleSqrt().domain([0, hi || 1]).range([0, 22]);

    return withValue.map((d, idx) => {
      const country = ds.dims.countries[d.b.key];
      return {
        key: d.b.key,
        name: d.b.label,
        lat: country.lat,
        lon: country.lon,
        value: d.value,
        magnitude: Math.max(2.2, r(magnitudes[idx])),
        status: statusOf(d.b, metric, basis, latestYearSales.get(d.b.key) ?? 0),
        breakdown: d.b,
        rank: d.i + 1,
        annualSales: latestYearSales.get(d.b.key) ?? 0,
      };
    });
  }, [items, metric, basis, ds, geom, latestYearSales]);

  if (items.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={Globe2}
          title="No countries in view"
          message="The current filter selects no order lines, so there is nothing to place on the map."
        />
      </div>
    );
  }

  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="chart-wrap" style={{ minHeight: height }}>
      {geom ? (
        <>
          <svg
            width={w}
            height={geom.h}
            role="img"
            aria-label={`World map of ${MAP_METRIC_LABEL[metric].toLowerCase()} by country`}
            className="map__svg"
            style={{
              // Panning only exists once there is something to pan to.
              cursor: zoom === 1 ? 'default' : drag ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            onPointerDown={(e) => {
              if (zoom === 1) return;
              setDrag({ x: e.clientX - offset[0], y: e.clientY - offset[1] });
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              setOffset(
                clampOffset([e.clientX - drag.x, e.clientY - drag.y], zoom, w, geom.h),
              );
            }}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <g
              transform={`translate(${offset[0]},${offset[1]}) scale(${zoom}) translate(${
                ((1 - zoom) * w) / (2 * zoom)
              },${((1 - zoom) * geom.h) / (2 * zoom)})`}
            >
              <path
                d={geom.path({ type: 'Sphere' }) ?? ''}
                fill="var(--c-surface-2)"
                stroke="var(--c-rule)"
                strokeWidth={0.8}
              />
              <path
                d={geom.graticule}
                fill="none"
                stroke="var(--c-grid)"
                strokeWidth={0.4}
                opacity={0.7}
              />
              {land
                ? land.features.map((f, i) => {
                    const hit = choropleth.byAtlas.get(String(f.id));
                    const band = hit ? choropleth.band(hit.value) : -1;
                    const isSel = hit ? selected.includes(hit.key) : false;
                    return (
                      <path
                        key={(f.id as string) ?? i}
                        d={geom.path(f) ?? ''}
                        fill={band >= 0 ? CHOROPLETH_FILL[band] : 'var(--c-surface-3)'}
                        stroke={isSel ? 'var(--c-ink)' : 'var(--c-surface)'}
                        strokeWidth={isSel ? 0.9 : 0.4}
                      />
                    );
                  })
                : null}

              {/* No entrance animation on the mark layer. Data marks paint at
                  their true size on the first frame: an animated entrance makes
                  the chart's correctness depend on a tween completing, and 164
                  of them is exactly the kind of bulk animation that buys nothing.
                  Motion is reserved for changes the user causes. */}
              <g>
                {data.map((d) => {
                  const p = geom.projection([d.lon, d.lat]);
                  if (!p) return null;
                  const isSel = selected.includes(d.key);
                  const dim = hasSelection && !isSel;
                  return (
                    <circle
                      key={d.key}
                      className="chart-hit"
                      cx={p[0]}
                      cy={p[1]}
                      r={d.magnitude / zoom ** 0.35}
                      opacity={dim ? 0.2 : 0.82}
                      fill={statusFill(d.status)}
                      stroke={isSel ? 'var(--c-ink)' : statusStroke(d.status)}
                      strokeWidth={isSel ? 2 / zoom : 0.9 / zoom}
                      style={{ transition: 'opacity 160ms var(--ease)' }}
                      onPointerEnter={(e) => show(tooltipFor(d, metric, basis, items.length, latestYear), e)}
                      onPointerMove={(e) => show(tooltipFor(d, metric, basis, items.length, latestYear), e)}
                      onPointerLeave={hide}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(d.key);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onOpenDetail?.(d.key);
                      }}
                    />
                  );
                })}
              </g>
            </g>
          </svg>

          <div className="map__controls no-print">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Zoom in"
              onClick={() =>
                setZoom((z) => {
                  const next = Math.min(6, z * 1.35);
                  setOffset((o) => clampOffset(o, next, w, geom.h));
                  return next;
                })
              }
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Zoom out"
              onClick={() =>
                setZoom((z) => {
                  const next = Math.max(1, z / 1.35);
                  // Zooming out shrinks the pannable range, so re-clamp or the
                  // view would be left hanging off the edge of the frame.
                  setOffset((o) => clampOffset(o, next, w, geom.h));
                  return next;
                })
              }
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Reset map view"
              title="Reset map view"
              disabled={zoom === 1 && offset[0] === 0 && offset[1] === 0}
              onClick={() => {
                setZoom(1);
                setOffset([0, 0]);
              }}
            >
              <Crosshair size={14} />
            </button>
          </div>

          <MapLegend metric={metric} latestYear={latestYear} edges={choropleth.edges} />
        </>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function MapLegend({
  metric,
  latestYear,
  edges,
}: {
  metric: MapMetric;
  latestYear: number | null;
  /** Quantile boundaries of the choropleth, for real band labels. */
  edges: number[];
}) {
  // Size, fill and colour are described separately, because they answer three
  // different questions and the legend is the only place that says which.
  const sizeBy = metric === 'profit' ? 'profit' : 'revenue';
  const colourBy =
    metric === 'sales'
      ? `${usdShort(BUSINESS_TARGETS.marketSalesThreshold)} annual bar${
          latestYear ? ` (${latestYear})` : ''
        }`
      : metric === 'growth'
        ? `${pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target`
        : `${pct(BUSINESS_TARGETS.profitMargin, 0)} margin target`;

  const bandLabels =
    edges.length === 3
      ? [
          `< ${usdShort(edges[0])}`,
          `${usdShort(edges[0])}–${usdShort(edges[1])}`,
          `${usdShort(edges[1])}–${usdShort(edges[2])}`,
          `> ${usdShort(edges[2])}`,
        ]
      : [];

  return (
    <div className="map__legend">
      <div className="map__legend-row">
        <span className="map__legend-key">Fill</span>
        {bandLabels.length ? (
          <span className="map__ramp">
            {bandLabels.map((label, i) => (
              <span className="map__ramp-step" key={label}>
                <span className="map__ramp-chip" style={{ background: CHOROPLETH_FILL[i] }} />
                <span className="map__ramp-label">{label}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="map__legend-note">country revenue</span>
        )}
      </div>

      <div className="map__legend-row">
        <span className="map__legend-key">Bubbles</span>
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: 'var(--c-map-above)' }} />
          At or above
        </span>
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: 'var(--c-map-close)' }} />
          Close
        </span>
        <span className="chart-legend__item">
          <span className="chart-legend__swatch" style={{ background: 'var(--c-map-below)' }} />
          Below
        </span>
        {metric === 'sales' && latestYear ? (
          <span className="chart-legend__item">
            <span className="chart-legend__swatch" style={{ background: 'var(--c-map-none)' }} />
            No {latestYear} sales
          </span>
        ) : null}
        <span className="chart-legend__item map__legend-note">
          area = {sizeBy} · colour vs {colourBy}
        </span>
      </div>
    </div>
  );
}

function valueOf(b: Breakdown, metric: MapMetric, basis: RevenueBasis): number | null {
  switch (metric) {
    case 'sales':
      return revenue(b.current, basis);
    case 'profit':
      return b.current.profit;
    case 'margin':
      return margin(b.current, basis);
    case 'growth':
      return b.growth;
  }
}

/**
 * Colour grades each country against the target the active metric is actually
 * governed by, and the legend states which one — the two must never disagree.
 *
 *   Revenue -> annual sales against the $400K viability bar
 *   Profit  -> margin against the 15% target
 *   Margin  -> margin against the 15% target
 *   Growth  -> YoY growth against the 20% target
 *
 * The viability bar is annual, so it is measured on the latest full year in the
 * filter rather than on the multi-year total the bubble's area shows. It is
 * also defined per *market* in the brief; applying it to a country is an
 * extension, which the legend and tooltip both say out loud.
 */
/**
 * Four steps of the accent over the land tone. Deliberately muted: this layer
 * is context for the status bubbles sitting on top of it, not the headline.
 */
const CHOROPLETH_FILL = [
  'color-mix(in srgb, var(--c-accent) 9%, var(--c-surface-3))',
  'color-mix(in srgb, var(--c-accent) 22%, var(--c-surface-3))',
  'color-mix(in srgb, var(--c-accent) 40%, var(--c-surface-3))',
  'color-mix(in srgb, var(--c-accent) 62%, var(--c-surface-3))',
];

const THRESHOLD_CLOSE_BAND = 0.2; // within 20% below the bar reads as "close"

/**
 * Keep the projected map covering its frame.
 *
 * Scaling happens about the centre, so at zoom `z` the content spans
 * `size * z` and may be shifted by at most half the overflow in either
 * direction before an edge would pull inside the frame. At zoom 1 that range
 * collapses to zero, which is what stops the map being dragged off its card.
 */
function clampOffset(offset: [number, number], zoom: number, w: number, h: number): [number, number] {
  const limitX = (w * (zoom - 1)) / 2;
  const limitY = (h * (zoom - 1)) / 2;
  return [
    Math.max(-limitX, Math.min(limitX, offset[0])),
    Math.max(-limitY, Math.min(limitY, offset[1])),
  ];
}

function statusOf(
  b: Breakdown,
  metric: MapMetric,
  basis: RevenueBasis,
  annualSales: number,
) {
  if (metric === 'sales') {
    // A country that did not trade in the latest year has not failed the bar —
    // it simply is not being measured. Grading it "below" would invent a verdict.
    if (annualSales <= 0) return 'neutral';
    return gradeAgainstTarget(
      annualSales,
      BUSINESS_TARGETS.marketSalesThreshold,
      THRESHOLD_CLOSE_BAND,
    );
  }
  if (metric === 'growth') {
    return gradeAgainstTarget(b.growth, BUSINESS_TARGETS.revenueGrowth);
  }
  return gradeAgainstTarget(margin(b.current, basis), BUSINESS_TARGETS.profitMargin);
}

/**
 * The map runs its own bubble palette — blue / orange / pink — rather than the
 * red-amber-green used for status elsewhere. Applying a market-level bar to 164
 * countries puts almost all of them below it, and a map of red dots read as an
 * alarm rather than as a distribution. The level is still named in the legend
 * and written out in every tooltip, so nothing depends on hue alone.
 */
function statusFill(s: ReturnType<typeof gradeAgainstTarget>): string {
  return s === 'on-target'
    ? 'var(--c-map-above)'
    : s === 'at-risk'
      ? 'var(--c-map-close)'
      : s === 'off-target'
        ? 'var(--c-map-below)'
        : 'var(--c-map-none)';
}

function statusStroke(s: ReturnType<typeof gradeAgainstTarget>): string {
  return statusFill(s);
}

function tooltipFor(
  d: MapDatum,
  metric: MapMetric,
  basis: RevenueBasis,
  total: number,
  latestYear: number | null,
) {
  const m = d.breakdown.current;
  const marginVal = margin(m, basis);
  const overBar = d.annualSales >= BUSINESS_TARGETS.marketSalesThreshold;
  const gap = Math.abs(d.annualSales - BUSINESS_TARGETS.marketSalesThreshold);

  return {
    title: d.name,
    subtitle: `${ordinal(d.rank)} of ${total} countries by ${MAP_METRIC_LABEL[metric].toLowerCase()}`,
    rows: [
      {
        label: 'Revenue',
        value: usd(revenue(m, basis)),
        strong: metric === 'sales',
      },
      ...(latestYear
        ? [{ label: `Sales, ${latestYear}`, value: usd(d.annualSales) }]
        : []),
      { label: 'Profit', value: usd(m.profit), strong: metric === 'profit' },
      { label: 'Margin', value: pct(marginVal), strong: metric === 'margin' },
      {
        label: 'YoY growth',
        value: d.breakdown.growth === null ? 'no prior year' : pctSigned(d.breakdown.growth),
        tone:
          d.breakdown.growth === null
            ? ('muted' as const)
            : d.breakdown.growth >= 0
              ? ('pos' as const)
              : ('neg' as const),
        strong: metric === 'growth',
      },
      { label: 'Order lines', value: m.lines.toLocaleString() },
    ],
    status: {
      level: d.status,
      label:
        metric === 'sales'
          ? latestYear
            ? overBar
              ? `${usd(gap)} above the ${usdShort(BUSINESS_TARGETS.marketSalesThreshold)} bar in ${latestYear}`
              : `${usd(gap)} short of the ${usdShort(BUSINESS_TARGETS.marketSalesThreshold)} bar in ${latestYear}`
            : 'No full year in view to measure against the bar'
          : metric === 'growth'
            ? d.status === 'on-target'
              ? `Above the ${pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target`
              : `Below the ${pct(BUSINESS_TARGETS.revenueGrowth, 0)} growth target`
            : d.status === 'on-target'
              ? `Above the ${pct(BUSINESS_TARGETS.profitMargin, 0)} margin target`
              : `Below the ${pct(BUSINESS_TARGETS.profitMargin, 0)} margin target`,
    },
    hint: 'Click to filter · double-click for country detail',
  };
}
