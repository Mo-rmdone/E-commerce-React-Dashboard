import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Filter, RotateCcw, Search, X, ChevronDown, Check } from 'lucide-react';
import type { Dataset, FilterDimension } from '@/types';
import { DIMENSION_LABEL, useActiveChips, useFilters } from '@/hooks/useFilters';
import { countShort } from '@/utils/format';
import './filters.css';

/**
 * Global filter bar.
 *
 * Only dimensions the workbook actually carries are offered. Active selections
 * are always visible as removable chips — a filter that silently narrows the
 * numbers is the fastest way to lose a user's trust in a BI tool.
 */
export function FilterBar({
  ds,
  rowsInView,
  totalRows,
}: {
  ds: Dataset;
  rowsInView: number;
  totalRows: number;
}) {
  const { filters, setDimension, reset } = useFilters();
  const chips = useActiveChips(ds);

  const options = useMemo(
    () => ({
      year: ds.dims.years.map((y, i) => ({ value: i, label: String(y), raw: y })),
      market: ds.dims.markets.map((m, i) => ({ value: i, label: m })),
      region: ds.dims.regions.map((r, i) => ({ value: i, label: r })),
      segment: ds.dims.segments.map((s, i) => ({ value: i, label: s })),
      category: ds.dims.categories.map((c, i) => ({ value: i, label: c })),
      country: ds.dims.countries.map((c, i) => ({ value: i, label: c.name })),
    }),
    [ds],
  );

  return (
    <div className="fbar no-print">
      <div className="fbar__row">
        <span className="fbar__icon" aria-hidden>
          <Filter size={13} />
        </span>

        {/* Year uses raw values, not indices, because the filter engine keys
            years by their actual number. */}
        <MultiSelect
          label={DIMENSION_LABEL.year}
          options={options.year.map((o) => ({ value: o.raw, label: o.label }))}
          selected={filters.year}
          onChange={(v) => setDimension('year', v, 'Year filter')}
        />
        <MultiSelect
          label={DIMENSION_LABEL.market}
          options={options.market}
          selected={filters.market}
          onChange={(v) => setDimension('market', v, 'Market filter')}
        />
        <MultiSelect
          label={DIMENSION_LABEL.region}
          options={options.region}
          selected={filters.region}
          onChange={(v) => setDimension('region', v, 'Region filter')}
          searchable
        />
        <MultiSelect
          label={DIMENSION_LABEL.country}
          options={options.country}
          selected={filters.country}
          onChange={(v) => setDimension('country', v, 'Country filter')}
          searchable
        />
        <MultiSelect
          label={DIMENSION_LABEL.segment}
          options={options.segment}
          selected={filters.segment}
          onChange={(v) => setDimension('segment', v, 'Segment filter')}
        />
        <MultiSelect
          label={DIMENSION_LABEL.category}
          options={options.category}
          selected={filters.category}
          onChange={(v) => setDimension('category', v, 'Category filter')}
        />

        <div className="fbar__spacer" />

        <span className="fbar__count">
          <span className="num">{countShort(rowsInView)}</span>
          <span className="fbar__count-sep">/</span>
          <span className="num fbar__count-total">{countShort(totalRows)}</span>
          <span className="fbar__count-label">lines</span>
        </span>

        <button
          type="button"
          className="btn"
          onClick={reset}
          disabled={chips.length === 0}
          title="Clear every active filter"
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <AnimatePresence initial={false}>
        {chips.length > 0 ? (
          <motion.div
            className="fbar__chips"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0.1, 1] }}
          >
            <span className="label fbar__chips-label">Filtered by</span>
            {chips.map((c) => (
              <ActiveChip
                key={`${c.dimension}-${c.value}`}
                dimension={c.dimension}
                label={c.label}
                onRemove={() =>
                  setDimension(
                    c.dimension,
                    filters[c.dimension].filter((v) => v !== c.value),
                    'Chip removed',
                  )
                }
              />
            ))}
            <button type="button" className="fbar__clearall" onClick={reset}>
              Clear all
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ActiveChip({
  dimension,
  label,
  onRemove,
}: {
  dimension: FilterDimension;
  label: string;
  onRemove: () => void;
}) {
  return (
    <motion.span
      className="achip"
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.15 }}
    >
      <span className="achip__dim">{DIMENSION_LABEL[dimension]}</span>
      <span className="achip__val">{label}</span>
      <button
        type="button"
        className="achip__x"
        onClick={onRemove}
        aria-label={`Remove ${DIMENSION_LABEL[dimension]} filter ${label}`}
      >
        <X size={11} />
      </button>
    </motion.span>
  );
}

/* ------------------------------------------------------------ multiselect */

interface Option {
  value: number;
  label: string;
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string;
  options: Option[];
  selected: number[];
  onChange: (values: number[]) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (!query.trim()) return options.slice(0, 200);
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 200);
  }, [options, query]);

  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? '1')
        : `${selected.length} selected`;

  return (
    <div className="ms">
      <button
        type="button"
        className={`ms__btn ${selected.length ? 'ms__btn--active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="ms__label">{label}</span>
        <span className="ms__value">{summary}</span>
        <ChevronDown size={12} className={open ? 'ms__caret ms__caret--open' : 'ms__caret'} />
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div className="ms__scrim" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              className="ms__panel"
              role="listbox"
              aria-multiselectable
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: [0.2, 0, 0.1, 1] }}
            >
              {searchable ? (
                <div className="ms__search">
                  <Search size={12} aria-hidden />
                  <input
                    type="text"
                    value={query}
                    placeholder={`Search ${label.toLowerCase()}…`}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label={`Search ${label}`}
                  />
                </div>
              ) : null}

              <div className="ms__list">
                {visible.length === 0 ? (
                  <p className="ms__empty">No {label.toLowerCase()} matches “{query}”.</p>
                ) : (
                  visible.map((o) => {
                    const on = selected.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="option"
                        aria-selected={on}
                        className="ms__opt"
                        onClick={() =>
                          onChange(
                            on ? selected.filter((v) => v !== o.value) : [...selected, o.value],
                          )
                        }
                      >
                        <span className={`ms__box ${on ? 'ms__box--on' : ''}`} aria-hidden>
                          {on ? <Check size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className="ms__opt-label">{o.label}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {selected.length > 0 ? (
                <button type="button" className="ms__clear" onClick={() => onChange([])}>
                  Clear {label.toLowerCase()}
                </button>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
