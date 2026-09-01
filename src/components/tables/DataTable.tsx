import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Search, TableProperties, X } from 'lucide-react';
import { EmptyState } from '@/components/primitives';
import './tables.css';

/**
 * Sortable, searchable analytical table.
 *
 * Sorting and searching run across the full row set, but only the top
 * `maxRows` are mounted. That keeps a 15,707-row customer dimension cheap
 * without pretending to be a virtualised grid: these tables answer "top N",
 * and the search box is how a user reaches a row outside the cut.
 */

export interface Column<T> {
  id: string;
  header: string;
  /** Value used for sorting. Strings sort lexically, numbers numerically. */
  sortValue?: (row: T) => number | string;
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  /** Column is hidden below this viewport width, to keep the table readable. */
  hideBelow?: number;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  /** Free-text search runs against this projection of the row. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  initialSort?: { column: string; direction: 'asc' | 'desc' };
  isSelected?: (row: T) => boolean;
  onSelect?: (row: T) => void;
  onOpen?: (row: T) => void;
  maxRows?: number;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Rendered above the table, right-aligned. */
  toolbar?: ReactNode;
}

const ROW_H = 34;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Search…',
  initialSort,
  isSelected,
  onSelect,
  onOpen,
  maxRows = 10,
  emptyTitle = 'Nothing to show',
  emptyMessage = 'No rows match the current filter.',
  toolbar,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);

  const filtered = useMemo(() => {
    if (!query.trim() || !searchText) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, query, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.id === sort.column);
    if (!col?.sortValue) return filtered;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  }, [filtered, sort, columns]);

  const visible = sorted.slice(0, maxRows);

  const toggleSort = (id: string) => {
    setSort((s) =>
      s?.column === id
        ? { column: id, direction: s.direction === 'desc' ? 'asc' : 'desc' }
        : { column: id, direction: 'desc' },
    );
  };

  return (
    <div className="dt">
      {searchText || toolbar ? (
        <div className="dt__bar">
          {searchText ? (
            <div className="dt__search">
              <Search size={12} aria-hidden />
              <input
                type="text"
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={searchPlaceholder}
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={12} />
                </button>
              ) : null}
            </div>
          ) : null}
          {query ? (
            <span className="dt__count">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()}
            </span>
          ) : null}
          {toolbar ? <div className="dt__tools">{toolbar}</div> : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={TableProperties}
          title={emptyTitle}
          message={query ? `Nothing matches “${query}”.` : emptyMessage}
        />
      ) : (
        <div className="dt__scroll">
          <table className="dt__table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    style={{ width: c.width, textAlign: c.align ?? 'left' }}
                    className={c.hideBelow ? `dt__hide-${c.hideBelow}` : undefined}
                    aria-sort={
                      sort?.column === c.id
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        className="dt__sort"
                        onClick={() => toggleSort(c.id)}
                        style={{ justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}
                      >
                        {c.header}
                        {sort?.column === c.id ? (
                          sort.direction === 'asc' ? (
                            <ArrowUp size={10} />
                          ) : (
                            <ArrowDown size={10} />
                          )
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => {
                const sel = isSelected?.(row) ?? false;
                return (
                  <motion.tr
                    key={rowKey(row)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: Math.min(i * 0.018, 0.2) }}
                    className={sel ? 'dt__row--sel' : undefined}
                    style={{ height: ROW_H, cursor: onSelect ? 'pointer' : undefined }}
                    onClick={() => onSelect?.(row)}
                    onDoubleClick={() => onOpen?.(row)}
                    tabIndex={onSelect ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSelect?.(row);
                      if (e.key === ' ') {
                        e.preventDefault();
                        onOpen?.(row);
                      }
                    }}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.id}
                        style={{ textAlign: c.align ?? 'left' }}
                        className={c.hideBelow ? `dt__hide-${c.hideBelow}` : undefined}
                      >
                        {c.render(row, i)}
                      </td>
                    ))}
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
