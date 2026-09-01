import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { Dataset, FilterDimension, FilterState } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import {
  clearDimension,
  emptyFilters,
  FILTER_DIMENSIONS,
  toggleFilter,
} from '@/data/transformations/filterRows';

/**
 * One filter store for the whole application. Every visual reads from it and
 * every selection writes to it, which is what makes cross-filtering coherent
 * rather than a set of charts that happen to share a page.
 */

export interface ActiveFilterChip {
  dimension: FilterDimension;
  value: number;
  label: string;
}

interface FilterContextValue {
  filters: FilterState;
  basis: RevenueBasis;
  /** What last changed, so the UI can say why a chart moved. */
  lastChange: { dimension: FilterDimension; origin: string } | null;
  toggle: (d: FilterDimension, v: number, origin: string, mode?: 'toggle' | 'replace') => void;
  setDimension: (d: FilterDimension, values: number[], origin: string) => void;
  clear: (d: FilterDimension) => void;
  reset: () => void;
  isSelected: (d: FilterDimension, v: number) => boolean;
  /** True when a dimension has a selection — used to dim unselected marks. */
  hasSelection: (d: FilterDimension) => boolean;
}

type Action =
  | { type: 'toggle'; dimension: FilterDimension; value: number; origin: string; mode: 'toggle' | 'replace' }
  | { type: 'set'; dimension: FilterDimension; values: number[]; origin: string }
  | { type: 'clear'; dimension: FilterDimension }
  | { type: 'reset' };

interface State {
  filters: FilterState;
  basis: RevenueBasis;
  lastChange: { dimension: FilterDimension; origin: string } | null;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'toggle':
      return {
        ...state,
        filters: toggleFilter(state.filters, action.dimension, action.value, action.mode),
        lastChange: { dimension: action.dimension, origin: action.origin },
      };
    case 'set':
      return {
        ...state,
        filters: { ...state.filters, [action.dimension]: action.values },
        lastChange: { dimension: action.dimension, origin: action.origin },
      };
    case 'clear':
      return {
        ...state,
        filters: clearDimension(state.filters, action.dimension),
        lastChange: null,
      };
    case 'reset':
      return { ...state, filters: emptyFilters(), lastChange: null };
  }
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    filters: emptyFilters(),
    basis: 'gross' as RevenueBasis,
    lastChange: null,
  });

  const toggle = useCallback(
    (dimension: FilterDimension, value: number, origin: string, mode: 'toggle' | 'replace' = 'toggle') =>
      dispatch({ type: 'toggle', dimension, value, origin, mode }),
    [],
  );

  const setDimension = useCallback(
    (dimension: FilterDimension, values: number[], origin: string) =>
      dispatch({ type: 'set', dimension, values, origin }),
    [],
  );

  const clear = useCallback(
    (dimension: FilterDimension) => dispatch({ type: 'clear', dimension }),
    [],
  );

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);


  const value = useMemo<FilterContextValue>(() => {
    const isSelected = (d: FilterDimension, v: number) => state.filters[d].includes(v);
    const hasSelection = (d: FilterDimension) => state.filters[d].length > 0;
    return {
      filters: state.filters,
      basis: state.basis,
      lastChange: state.lastChange,
      toggle,
      setDimension,
      clear,
      reset,
      isSelected,
      hasSelection,
    };
  }, [state, toggle, setDimension, clear, reset]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used inside a FilterProvider');
  return ctx;
}

/** Human-readable labels for every active selection, for the filter bar. */
export function useActiveChips(ds: Dataset | null): ActiveFilterChip[] {
  const { filters } = useFilters();
  return useMemo(() => {
    if (!ds) return [];
    const chips: ActiveFilterChip[] = [];
    for (const d of FILTER_DIMENSIONS) {
      for (const v of filters[d]) {
        chips.push({ dimension: d, value: v, label: labelFor(ds, d, v) });
      }
    }
    return chips;
  }, [ds, filters]);
}

export function labelFor(ds: Dataset, d: FilterDimension, v: number): string {
  switch (d) {
    case 'year':
      return String(v);
    case 'market':
      return ds.dims.markets[v] ?? '—';
    case 'region':
      return ds.dims.regions[v] ?? '—';
    case 'country':
      return ds.dims.countries[v]?.name ?? '—';
    case 'segment':
      return ds.dims.segments[v] ?? '—';
    case 'category':
      return ds.dims.categories[v] ?? '—';
    case 'subcategory':
      return ds.dims.subcategories[v]?.name ?? '—';
    case 'product':
      return ds.dims.products[v]?.name ?? '—';
  }
}

export const DIMENSION_LABEL: Record<FilterDimension, string> = {
  year: 'Year',
  market: 'Market',
  region: 'Region',
  country: 'Country',
  segment: 'Segment',
  category: 'Category',
  subcategory: 'Subcategory',
  product: 'Product',
};
