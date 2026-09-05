import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Search, X } from 'lucide-react';
import { DASH } from '@/utils/format';
import './leaderboard.css';

/**
 * A ranked leaderboard: rank badge, an identity chip, a magnitude bar, the
 * headline value, and a signed delta pill.
 *
 * The bar length is the row's magnitude relative to the leader, so the eye
 * reads the gap between first and the rest at a glance; the pill carries a
 * second, orthogonal signal (year-over-year direction) with its own colour.
 * Two encodings, kept apart, exactly as the ranked bars did — but in a form
 * that scans like a scoreboard rather than a chart.
 */

export interface LeaderRow {
  key: number;
  name: string;
  /** Two-letter monogram for the identity chip. */
  initials: string;
  /** One muted line under the name (e.g. "13.4% margin · 335 lines"). */
  subtitle: string;
  /** Headline figure, pre-formatted. */
  valueLabel: string;
  /** Colour the value red for a loss. */
  valueNegative?: boolean;
  /** 0–1, share of the leader's magnitude — drives the bar. */
  barPct: number;
  /** Year-over-year change; null renders as a muted "new". */
  delta: number | null;
  /** Pre-formatted delta text, e.g. "+19.8%". */
  deltaLabel: string;
}

const MEDAL = ['lb__rank--gold', 'lb__rank--silver', 'lb__rank--bronze'];

export function LeaderboardTable({
  rows,
  headerRight,
  selected,
  onSelect,
  onOpen,
  emptyMessage = 'Nothing to rank in the current filter.',
  search,
  searchPlaceholder = 'Search products…',
  maxRows,
}: {
  rows: LeaderRow[];
  /** Right-aligned column caption, e.g. "vs prior year". */
  headerRight: string;
  selected: number[];
  onSelect: (key: number) => void;
  onOpen?: (key: number) => void;
  emptyMessage?: string;
  /** When provided, renders a search box that filters rows by this text. */
  search?: (row: LeaderRow) => string;
  searchPlaceholder?: string;
  /** Cap on how many rows to show after searching (e.g. keep it a top-8). */
  maxRows?: number;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!search || !query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => search(r).toLowerCase().includes(q));
  }, [rows, search, query]);

  const shown = maxRows ? filtered.slice(0, maxRows) : filtered;

  const searchBox = search ? (
    <div className="lb__search">
      <Search size={13} aria-hidden />
      <input
        type="text"
        value={query}
        placeholder={searchPlaceholder}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the leaderboard"
      />
      {query ? (
        <button type="button" className="lb__search-clear" onClick={() => setQuery('')} aria-label="Clear search">
          <X size={13} />
        </button>
      ) : null}
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div className="lb" role="table" aria-label="Leaderboard">
        {searchBox}
        <p className="lb__empty">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="lb" role="table" aria-label="Leaderboard">
      {searchBox}
      {shown.length === 0 ? (
        <p className="lb__empty">No product matches “{query}”.</p>
      ) : (
        <div className="lb__head" role="row">
          <span className="lb__head-rank" role="columnheader">
            #
          </span>
          <span className="lb__head-name" role="columnheader">
            Product
          </span>
          <span className="lb__head-right" role="columnheader">
            {headerRight}
          </span>
        </div>
      )}

      {shown.map((r, i) => {
        const isSel = selected.includes(r.key);
        const up = r.delta !== null && r.delta >= 0;
        return (
          <motion.div
            key={r.key}
            role="row"
            tabIndex={0}
            className={`lb__row ${isSel ? 'lb__row--sel' : ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.24) }}
            onClick={() => onSelect(r.key)}
            onDoubleClick={() => onOpen?.(r.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(r.key);
              if (e.key === ' ') {
                e.preventDefault();
                onOpen?.(r.key);
              }
            }}
          >
            <span className={`lb__rank ${MEDAL[i] ?? ''}`} aria-hidden>
              {i === 0 ? <Crown size={11} strokeWidth={2.4} /> : null}
              {i + 1}
            </span>

            <span className="lb__avatar" aria-hidden>
              {r.initials}
            </span>

            <span className="lb__id">
              <span className="lb__name" title={r.name}>
                {r.name}
              </span>
              <span className="lb__sub">{r.subtitle}</span>
            </span>

            <span className="lb__bar" aria-hidden>
              <motion.span
                className="lb__barfill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.max(0.02, r.barPct) }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.03, 0.24), ease: [0.2, 0, 0.1, 1] }}
              />
            </span>

            <span className={`lb__val num ${r.valueNegative ? 'lb__val--neg' : ''}`}>
              {r.valueLabel}
            </span>

            <span
              className={`lb__pill ${
                r.delta === null ? 'lb__pill--none' : up ? 'lb__pill--up' : 'lb__pill--down'
              }`}
            >
              {r.delta === null ? (
                'new'
              ) : (
                <>
                  <span className="lb__pill-arrow" aria-hidden>
                    {up ? '▲' : '▼'}
                  </span>
                  <span className="num">{r.deltaLabel === DASH ? '—' : r.deltaLabel}</span>
                </>
              )}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
