import { useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Globe2,
  Package,
  Users,
  Moon,
  Sun,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { Dataset } from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { DataNotesPanel } from './DataNotesPanel';
import { isoDateLabel } from '@/utils/format';
import './shell.css';

export type PageId = 'executive' | 'products' | 'customers';

/**
 * Page identity lives here rather than inside each page component so the title
 * can sit in the application header, above the controls — which is where the
 * reader looks first and where it outranks the filter row.
 */
export const PAGE_META: Record<
  PageId,
  { index: number; nav: string; title: string; question: string; icon: typeof Globe2; hint: string }
> = {
  executive: {
    index: 1,
    nav: 'Executive',
    title: 'Executive overview & geographic performance',
    question: 'Is the global business healthy, profitable and growing against target?',
    icon: Globe2,
    hint: 'Health, targets and geography',
  },
  products: {
    index: 2,
    nav: 'Products',
    title: 'Product & category intelligence',
    question:
      'Which products and categories drive profitable growth, and where is discounting damaging margin?',
    icon: Package,
    hint: 'Category, product and discount',
  },
  customers: {
    index: 3,
    nav: 'Customers',
    title: 'Customer insights & market deep-dive',
    question: 'Who are the highest-value customers, and how are their markets evolving?',
    icon: Users,
    hint: 'High-value accounts and markets',
  },
};

const NAV_ORDER: PageId[] = ['executive', 'products', 'customers'];

export function AppShell({
  ds,
  page,
  onNavigate,
  filterBar,
  children,
}: {
  ds: Dataset;
  page: PageId;
  onNavigate: (p: PageId) => void;
  filterBar: ReactNode;
  children: ReactNode;
}) {
  const [theme, toggleTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const noteCount = ds.quality.corrections.length + ds.quality.limitations.length;
  const meta = PAGE_META[page];

  return (
    <div className={`shell ${collapsed ? 'shell--collapsed' : ''}`}>
      <nav className="rail no-print" aria-label="Primary">
        <div className="rail__brand">
          <span className="rail__mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M12 3 20.5 18.5H3.5L12 3Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M12 3v15.5" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
              <path d="M12 11.2 20.5 18.5" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
            </svg>
          </span>
          {!collapsed ? (
            <span className="rail__wordmark">
              <span className="rail__name">Prism</span>
              <span className="rail__sub">Commercial Intelligence</span>
            </span>
          ) : null}
        </div>

        <div className="rail__group">
          {!collapsed ? <p className="rail__grouplabel">Analysis</p> : null}
          <ul className="rail__nav">
            {NAV_ORDER.map((id) => {
              const item = PAGE_META[id];
              const Icon = item.icon;
              const active = page === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`rail__link ${active ? 'rail__link--active' : ''}`}
                    onClick={() => onNavigate(id)}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? `${item.nav} — ${item.hint}` : item.hint}
                  >
                    <Icon size={17} strokeWidth={active ? 2.1 : 1.7} aria-hidden />
                    {!collapsed ? <span className="rail__text">{item.nav}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rail__group">
          {!collapsed ? <p className="rail__grouplabel">Dataset</p> : null}
          <ul className="rail__nav">
            <li>
              <button
                type="button"
                className="rail__link"
                onClick={() => setNotesOpen(true)}
                title="Corrections applied and limitations of the source workbook"
              >
                <Database size={17} strokeWidth={1.7} aria-hidden />
                {!collapsed ? <span className="rail__text">Data notes</span> : null}
                <span className="rail__badge">{noteCount}</span>
              </button>
            </li>
          </ul>
        </div>

        <div className="rail__foot">
          <button
            type="button"
            className="rail__util"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          >
            {theme === 'light' ? (
              <Moon size={16} strokeWidth={1.7} aria-hidden />
            ) : (
              <Sun size={16} strokeWidth={1.7} aria-hidden />
            )}
            {!collapsed ? (
              <span className="rail__text">{theme === 'light' ? 'Dark' : 'Light'}</span>
            ) : null}
          </button>

          <button
            type="button"
            className="rail__util"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.7} aria-hidden />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.7} aria-hidden />
            )}
            {!collapsed ? <span className="rail__text">Collapse</span> : null}
          </button>

          {!collapsed ? (
            <p className="rail__meta">
              {ds.meta.rows.toLocaleString()} order lines
              <br />
              {isoDateLabel(ds.meta.dateRange[0])} – {isoDateLabel(ds.meta.dateRange[1])}
              <br />
              All values in {ds.meta.currency}
            </p>
          ) : null}
        </div>
      </nav>

      <div className="shell__main">
        <header className="topbar">
          <div className="topbar__text">
            <p className="topbar__eyebrow">
              Page {meta.index} <span aria-hidden>·</span> {meta.nav}
            </p>
            <h1 className="topbar__title">{meta.title}</h1>
            <p className="topbar__q">{meta.question}</p>
          </div>
        </header>

        {filterBar}

        <main className="shell__canvas">{children}</main>
      </div>

      <AnimatePresence>
        {notesOpen ? <DataNotesPanel ds={ds} onClose={() => setNotesOpen(false)} /> : null}
      </AnimatePresence>
    </div>
  );
}
