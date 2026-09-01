import { useMemo } from 'react';
import type { Breakdown, Dataset, MeasureSummary } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import {
  filterRows,
  yearComparison,
  type PeriodComparison,
} from '@/data/transformations/filterRows';
import { buildKpiContext, buildKpis, type Kpi, type KpiContext } from '@/data/metrics/kpis';
import { buildBreakdown, type BreakdownDimension } from '@/data/metrics/breakdowns';
import { useFilters } from './useFilters';

export interface DashboardData {
  rows: Int32Array;
  /** Latest year vs the one before it — the basis for every growth figure. */
  comparison: PeriodComparison | null;
  summary: MeasureSummary;
  kpiContext: KpiContext;
  kpis: Kpi[];
  basis: RevenueBasis;
  /** True when the active filter selects nothing at all. */
  isEmpty: boolean;
  /** Share of the full dataset currently in view. */
  coverage: number;
}

/**
 * The one place the fact table is scanned per render pass.
 *
 * Everything downstream — KPIs, charts, tables, alerts — reads the row index
 * array produced here, so changing a filter costs a single pass rather than one
 * per visual. Memoised on the filter object and revenue basis, so an unrelated
 * state change (a hover, a tooltip, a page switch) recomputes nothing.
 */
export function useDashboardData(ds: Dataset): DashboardData {
  const { filters, basis } = useFilters();

  const rows = useMemo(() => filterRows(ds, filters), [ds, filters]);
  const comparison = useMemo(
    () => yearComparison(ds, filters, rows),
    [ds, filters, rows],
  );

  const kpiContext = useMemo(
    () => buildKpiContext(ds, rows, comparison, basis),
    [ds, rows, comparison, basis],
  );

  const kpis = useMemo(() => buildKpis(kpiContext), [kpiContext]);

  return useMemo(
    () => ({
      rows,
      comparison,
      summary: kpiContext.summary,
      kpiContext,
      kpis,
      basis,
      isEmpty: rows.length === 0,
      coverage: ds.rowCount > 0 ? rows.length / ds.rowCount : 0,
    }),
    [rows, comparison, kpiContext, kpis, basis, ds.rowCount],
  );
}

/**
 * Memoised breakdown for one dimension. Components call this instead of
 * grouping inline, so two cards showing the same dimension share one pass.
 */
export function useBreakdown(
  ds: Dataset,
  data: DashboardData,
  dimension: BreakdownDimension,
  opts: { distinct?: boolean; dropEmpty?: boolean } = {},
): Breakdown[] {
  const { distinct = false, dropEmpty = true } = opts;
  return useMemo(
    () =>
      buildBreakdown(ds, data.rows, data.comparison, dimension, {
        basis: data.basis,
        distinct,
        dropEmpty,
      }),
    [ds, data.rows, data.comparison, data.basis, dimension, distinct, dropEmpty],
  );
}
