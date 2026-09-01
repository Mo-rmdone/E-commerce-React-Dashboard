import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Filter, X } from 'lucide-react';
import type { Dataset, FilterDimension } from '@/types';
import { BUSINESS_TARGETS, gradeAgainstTarget, type RevenueBasis } from '@/config/targets';
import type { DrillthroughEntity } from '@/hooks/useDrilldown';
import type { PeriodComparison } from '@/data/transformations/filterRows';
import { summarize } from '@/data/metrics/aggregate';
import { buildBreakdown, margin, revenue } from '@/data/metrics/breakdowns';
import { buildTimeSeries, trimEmptyEdges } from '@/data/metrics/timeseries';
import { buildDiscountImpact } from '@/data/metrics/discount';
import { Sparkline } from '@/components/charts/Sparkline';
import { StatusChip } from '@/components/primitives';
import { int, pct, pctSigned, usd, usdShort } from '@/utils/format';
import './detail.css';

/**
 * Drill-through: everything about one entity, in context.
 *
 * Deliberately not a copy of the dashboard scoped down. It answers the
 * questions you only ask once you have singled something out — what it sells,
 * where its profit actually comes from, and whether its discounting is sound.
 */
export function DetailPanel({
  ds,
  entity,
  rows,
  comparison,
  basis,
  onClose,
  onFilter,
}: {
  ds: Dataset;
  entity: DrillthroughEntity;
  rows: Int32Array;
  comparison: PeriodComparison | null;
  basis: RevenueBasis;
  onClose: () => void;
  onFilter: (dimension: FilterDimension, value: number) => void;
}) {
  const detail = useMemo(
    () => buildDetail(ds, entity, rows, comparison, basis),
    [ds, entity, rows, comparison, basis],
  );

  return (
    <>
      <motion.div
        className="drawer__scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />
      <motion.aside
        className="drawer detail"
        role="dialog"
        aria-label={`${detail.kindLabel} detail: ${detail.title}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.2, 0, 0.1, 1] }}
      >
        <header className="drawer__head">
          <div>
            <p className="label">{detail.kindLabel} detail</p>
            <h2 className="drawer__title">{detail.title}</h2>
            {detail.subtitle ? <p className="detail__sub">{detail.subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="drawer__body">
          {detail.empty ? (
            <p className="detail__empty">
              This {detail.kindLabel.toLowerCase()} has no order lines inside the current filter.
              Clear a filter to see its full history.
            </p>
          ) : (
            <>
              <section className="detail__stats">
                {detail.stats.map((s) => (
                  <div key={s.label} className="detail__stat">
                    <span className="label">{s.label}</span>
                    <span className={`detail__stat-val num ${s.tone ?? ''}`}>{s.value}</span>
                    {s.note ? <span className="detail__stat-note">{s.note}</span> : null}
                  </div>
                ))}
              </section>

              <section className="detail__block">
                <div className="detail__block-head">
                  <h3 className="detail__h">Performance against target</h3>
                  <StatusChip level={detail.status} />
                </div>
                <p className="detail__note">{detail.statusNote}</p>
                {detail.spark.length > 1 ? (
                  <div className="detail__spark">
                    <Sparkline
                      values={detail.spark}
                      width={220}
                      height={40}
                      tone={detail.status === 'on-target' ? 'pos' : 'neg'}
                    />
                    <span className="detail__spark-cap">
                      Revenue by {detail.sparkGrain}, {detail.sparkRange}
                    </span>
                  </div>
                ) : null}
              </section>

              {detail.sections.map((sec) => (
                <section key={sec.title} className="detail__block">
                  <h3 className="detail__h">{sec.title}</h3>
                  {sec.note ? <p className="detail__note">{sec.note}</p> : null}
                  <ul className="detail__list">
                    {sec.items.map((it) => (
                      <li key={it.label} className="detail__item">
                        <span className="detail__item-label" title={it.label}>
                          {it.label}
                        </span>
                        <span className="detail__item-bar" aria-hidden>
                          <span
                            className="detail__item-fill"
                            style={{
                              width: `${Math.round(it.share * 100)}%`,
                              background: it.negative ? 'var(--c-neg)' : 'var(--c-accent)',
                            }}
                          />
                        </span>
                        <span className={`detail__item-val num ${it.negative ? 'val--neg' : ''}`}>
                          {it.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        {detail.filterDimension !== null ? (
          <footer className="detail__foot">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                onFilter(detail.filterDimension!, entity.key);
                onClose();
              }}
            >
              <Filter size={13} />
              Filter the dashboard to {detail.title}
            </button>
          </footer>
        ) : null}
      </motion.aside>
    </>
  );
}

/* --------------------------------------------------------------- builder */

interface DetailStat {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}
interface DetailItem {
  label: string;
  value: string;
  share: number;
  negative: boolean;
}
interface DetailSection {
  title: string;
  note?: string;
  items: DetailItem[];
}

function buildDetail(
  ds: Dataset,
  entity: DrillthroughEntity,
  rows: Int32Array,
  comparison: PeriodComparison | null,
  basis: RevenueBasis,
) {
  const f = ds.facts;

  const match = (i: number): boolean => {
    switch (entity.kind) {
      case 'country':
        return f.country[i] === entity.key;
      case 'market':
        return f.market[i] === entity.key;
      case 'product':
        return f.product[i] === entity.key;
      case 'customer':
        return f.customer[i] === entity.key;
    }
  };

  const scoped = filterBy(rows, match);
  const m = summarize(ds, scoped, { distinct: true });

  // Annual growth, matching the KPI row: latest year against the one before it.
  const latest =
    comparison ? summarize(ds, filterBy(comparison.currentRows, match)) : null;
  const prior =
    comparison?.priorRows ? summarize(ds, filterBy(comparison.priorRows, match)) : null;
  const growth =
    latest && prior && revenue(prior, basis) > 0
      ? (revenue(latest, basis) - revenue(prior, basis)) / revenue(prior, basis)
      : null;
  const growthLabel =
    comparison?.priorYear != null
      ? `${comparison.latestYear} vs ${comparison.priorYear}`
      : 'no prior year in filter';

  const marginVal = margin(m, basis);
  const impact = buildDiscountImpact(ds, scoped);

  const title =
    entity.kind === 'country'
      ? ds.dims.countries[entity.key].name
      : entity.kind === 'market'
        ? ds.dims.markets[entity.key]
        : entity.kind === 'product'
          ? ds.dims.products[entity.key].name
          : ds.dims.customers[entity.key];

  const kindLabel =
    entity.kind === 'country'
      ? 'Country'
      : entity.kind === 'market'
        ? 'Market'
        : entity.kind === 'product'
          ? 'Product'
          : 'Customer';

  const filterDimension: FilterDimension | null =
    entity.kind === 'country'
      ? 'country'
      : entity.kind === 'market'
        ? 'market'
        : entity.kind === 'product'
          ? 'product'
          : null;

  const subtitle =
    entity.kind === 'country'
      ? `${ds.dims.markets[ds.dims.countryToMarket[entity.key]]} · ${int(m.lines)} order lines`
      : entity.kind === 'product'
        ? `Unit price ${usd(ds.dims.products[entity.key].unitPrice)} · ${int(m.quantity)} units sold`
        : entity.kind === 'customer'
          ? `${int(m.orders)} orders · ${int(m.lines)} order lines`
          : `${int(m.lines)} order lines`;

  const stats: DetailStat[] = [
    { label: 'Revenue', value: usd(revenue(m, basis)) },
    {
      label: 'Profit',
      value: usd(m.profit),
      tone: m.profit < 0 ? 'val--neg' : 'val--pos',
    },
    { label: 'Margin', value: pct(marginVal) },
    {
      label: 'YoY growth',
      value: growth === null ? '—' : pctSigned(growth),
      note: growthLabel,
      tone: growth === null ? '' : growth >= 0 ? 'val--pos' : 'val--neg',
    },
    { label: 'Orders', value: int(m.orders) },
    { label: 'Avg discount', value: pct(m.avgDiscount) },
  ];

  const status = gradeAgainstTarget(marginVal, BUSINESS_TARGETS.profitMargin);
  const statusNote =
    marginVal === null
      ? 'No revenue in view, so margin cannot be measured.'
      : status === 'on-target'
        ? `Margin of ${pct(marginVal)} clears the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target. ${
            impact.lossLines > 0
              ? `${pct(impact.lossShare, 0)} of lines still sell at a loss, costing ${usd(impact.profitLost)}.`
              : 'No line here sells at a loss.'
          }`
        : `Margin of ${pct(marginVal)} is ${pct(
            BUSINESS_TARGETS.profitMargin - marginVal,
          )} under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target. ${int(
            impact.lossLines,
          )} lines were discounted past breakeven, destroying ${usd(impact.profitLost)}.`;

  const yearly = trimEmptyEdges(buildTimeSeries(ds, scoped, 'quarter', basis));
  const spark = yearly.map((p) => revenue(p.measures, basis));

  const sections: DetailSection[] = [];

  if (entity.kind === 'country' || entity.kind === 'market' || entity.kind === 'customer') {
    sections.push(
      topSection(
        'Revenue by category',
        buildBreakdown(ds, scoped, null, 'category', { basis }).slice(0, 5),
        basis,
      ),
    );
    sections.push(
      topSection(
        'Top products',
        buildBreakdown(ds, scoped, null, 'product', { basis }).slice(0, 5),
        basis,
        'Products are ranked within this scope only. Category is an order-line attribute in this workbook, so a product is not shown with a category label.',
      ),
    );
  }

  if (entity.kind === 'product') {
    sections.push(
      topSection(
        'Revenue by country',
        buildBreakdown(ds, scoped, null, 'country', { basis }).slice(0, 5),
        basis,
      ),
    );
    sections.push(
      topSection(
        'Sold under these subcategories',
        buildBreakdown(ds, scoped, null, 'subcategory', { basis }).slice(0, 6),
        basis,
        'This product appears on order lines across several subcategories — a property of the source data, not a classification error in this app.',
      ),
    );
  }

  if (entity.kind === 'country') {
    sections.push(
      topSection(
        'Revenue by segment',
        buildBreakdown(ds, scoped, null, 'segment', { basis }),
        basis,
      ),
    );
  }

  return {
    title,
    kindLabel,
    subtitle,
    stats,
    status,
    statusNote,
    spark,
    sparkGrain: 'quarter',
    sparkRange:
      yearly.length > 0 ? `${yearly[0].label} – ${yearly[yearly.length - 1].label}` : '',
    sections,
    filterDimension,
    empty: scoped.length === 0,
  };
}

function topSection(
  title: string,
  items: ReturnType<typeof buildBreakdown>,
  basis: RevenueBasis,
  note?: string,
): DetailSection {
  const maxV = Math.max(...items.map((i) => Math.abs(revenue(i.current, basis))), 1);
  return {
    title,
    note,
    items: items.map((i) => ({
      label: i.label,
      value: usdShort(revenue(i.current, basis)),
      share: Math.abs(revenue(i.current, basis)) / maxV,
      negative: i.current.profit < 0,
    })),
  };
}

function filterBy(rows: Int32Array, keep: (i: number) => boolean): Int32Array {
  const out = new Int32Array(rows.length);
  let k = 0;
  for (let j = 0; j < rows.length; j++) {
    if (keep(rows[j])) out[k++] = rows[j];
  }
  return out.subarray(0, k);
}
