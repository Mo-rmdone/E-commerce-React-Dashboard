import { useState, type ReactNode } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { Alert, AlertSeverity } from '@/data/metrics/alerts';
import type { FilterDimension } from '@/types';
import { Segmented } from '@/components/primitives';
import './signals.css';

/**
 * Strategic signals — the findings the rest of the dashboard generates, read
 * one severity at a time.
 *
 * Severity is a tab rather than a sort order. Stacked into a single list the
 * six findings ran past the height of the card and the panel scrolled, which
 * hid the low-severity ones behind a gesture nobody makes; split by severity
 * each view is one or two findings and nothing scrolls. The count stays in each
 * tab's tooltip rather than its label, which keeps the row quiet. There is
 * deliberately no "All": it would be the scrolling list this replaced.
 */

/**
 * The figures inside a finding carry it, so they are set apart from the prose
 * around them. Derived, not hand-marked: every currency amount, percentage,
 * point difference and bare count in the generated sentence is emphasised, so a
 * new alert written tomorrow is treated the same way without being annotated.
 */
const FIGURE = /(\$[\d.,]+[KMB]?|[-+−]?\d[\d.,]*\s?(?:pp|%)|\d[\d,]*)/g;

function Figures({ text }: { text: string }) {
  const parts = text.split(FIGURE);
  return (
    <>
      {parts.map((part, i) =>
        // split() puts captured groups at the odd indices.
        i % 2 === 1 ? (
          <strong key={i} className="signal__figure num">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

const SEVERITY_WORD: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Watch',
  opportunity: 'Opportunity',
  positive: 'On track',
};

/** Worst first, so the default tab is the one that needs attention. */
const SEVERITY_ORDER: AlertSeverity[] = ['critical', 'warning', 'opportunity', 'positive'];

export function SignalPanel({
  signals,
  onAct,
  header,
  footer,
}: {
  signals: Alert[];
  onAct: (dimension: FilterDimension, value: number) => void;
  /** Pinned above the tabs — the score the signals explain. */
  header?: ReactNode;
  /** Pinned to the bottom of the panel, below the list. */
  footer?: ReactNode;
}) {
  const [chosen, setChosen] = useState<AlertSeverity | null>(null);

  // Only severities actually present get a tab, so a filter that clears every
  // critical finding does not leave an empty tab behind to click.
  const tabs = SEVERITY_ORDER.filter((sev) => signals.some((s) => s.severity === sev)).map(
    (sev) => ({
      value: sev,
      label: SEVERITY_WORD[sev],
      title: `${signals.filter((s) => s.severity === sev).length} ${SEVERITY_WORD[sev].toLowerCase()} ${
        signals.filter((s) => s.severity === sev).length === 1 ? 'signal' : 'signals'
      }`,
    }),
  );

  // Derived rather than stored: if the chosen severity vanishes on a filter
  // change, the panel falls back to the worst one still present instead of
  // rendering nothing.
  const active = tabs.some((t) => t.value === chosen) ? chosen : (tabs[0]?.value ?? null);
  const shown = signals.filter((s) => s.severity === active);

  if (signals.length === 0) {
    return (
      <div className="signals">
        {header}
        <p className="signals__none">
          <ShieldCheck size={14} aria-hidden />
          Every target is being met in this view. Nothing needs attention.
        </p>
        {footer}
      </div>
    );
  }

  return (
    <div className="signals">
      {header}
      {tabs.length > 1 ? (
        <div className="signals__tabs">
          <Segmented
            label="Signal severity"
            value={active as AlertSeverity}
            onChange={setChosen}
            options={tabs}
          />
        </div>
      ) : null}
      <ol className="signals__list">
        {shown.map((s) => (
          <li key={s.id} className={`signal signal--${s.severity}`}>
            <header className="signal__head">
              <span className="signal__sev">
                <span className="signal__dot" aria-hidden />
                {SEVERITY_WORD[s.severity]}
              </span>
              <span className="signal__metric num">{s.metric}</span>
            </header>
            <h4 className="signal__title">{s.title}</h4>
            <p className="signal__detail">
              <Figures text={s.detail} />
            </p>
            {s.action ? (
              <button
                type="button"
                className="signal__action"
                onClick={() => onAct(s.action!.dimension, s.action!.value)}
              >
                Inspect
                <ArrowRight size={11} />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {footer}
    </div>
  );
}
