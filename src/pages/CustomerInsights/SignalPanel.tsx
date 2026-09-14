import type { ReactNode } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { Alert, AlertSeverity } from '@/data/metrics/alerts';
import type { FilterDimension } from '@/types';
import './signals.css';

/**
 * Section 02, right column — strategic signals.
 *
 * The same findings the rest of the dashboard generates, compressed to a
 * prioritised list: a severity dot, a title, the number, one line of why. It
 * stays deliberately quiet so the flow diagram beside it remains the thing the
 * eye lands on first — a signal here is a pointer into the page, not the
 * analysis itself.
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

export function SignalPanel({
  signals,
  onAct,
  limit,
  header,
  footer,
}: {
  signals: Alert[];
  onAct: (dimension: FilterDimension, value: number) => void;
  /** Severity-sorted upstream; omit to show every signal. */
  limit?: number;
  /** Pinned above the list — the score the signals explain. */
  header?: ReactNode;
  /** Pinned to the bottom of the panel, below the scrolling list. */
  footer?: ReactNode;
}) {
  const shown = limit === undefined ? signals : signals.slice(0, limit);

  if (shown.length === 0) {
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
