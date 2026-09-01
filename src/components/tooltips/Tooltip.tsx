import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Minus } from 'lucide-react';
import type { StatusLevel } from '@/config/targets';
import './tooltip.css';

/**
 * One tooltip shape for the whole application: a title, an optional
 * subtitle, a set of aligned metric rows, and an optional status footer.
 * Charts pass data, never markup, so every tooltip reads the same.
 */

export interface TooltipRow {
  label: string;
  value: string;
  /** Emphasise the primary measure. */
  strong?: boolean;
  /** Colour the value — used for signed growth, never for decoration. */
  tone?: 'pos' | 'neg' | 'muted';
}

export interface TooltipModel {
  title: string;
  subtitle?: string;
  rows: TooltipRow[];
  status?: { level: StatusLevel; label: string };
  /** Prompt shown at the bottom, e.g. "Click to filter". */
  hint?: string;
}

export interface TooltipPosition {
  x: number;
  y: number;
}

const STATUS_ICON = {
  'on-target': CheckCircle2,
  'at-risk': AlertTriangle,
  'off-target': XCircle,
  neutral: Minus,
} as const;

export function ChartTooltip({
  model,
  position,
}: {
  model: TooltipModel | null;
  position: TooltipPosition | null;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {model && position ? (
        <motion.div
          className="tt"
          role="tooltip"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.12, ease: [0.2, 0, 0.1, 1] }}
          style={placement(position)}
        >
          <div className="tt__title">{model.title}</div>
          {model.subtitle ? <div className="tt__sub">{model.subtitle}</div> : null}
          <div className="tt__rows">
            {model.rows.map((r) => (
              <div className="tt__row" key={r.label}>
                <span className="tt__label">{r.label}</span>
                <span
                  className={[
                    'tt__value',
                    'num',
                    r.strong ? 'tt__value--strong' : '',
                    r.tone ? `tt__value--${r.tone}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {r.value}
                </span>
              </div>
            ))}
          </div>
          {model.status ? <StatusFooter {...model.status} /> : null}
          {model.hint ? <div className="tt__hint">{model.hint}</div> : null}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function StatusFooter({ level, label }: { level: StatusLevel; label: string }) {
  const Icon = STATUS_ICON[level];
  return (
    <div className={`tt__status tt__status--${level}`}>
      <Icon size={12} strokeWidth={2.4} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/**
 * Keep the panel inside the viewport. Charts report a pointer position; the
 * tooltip flips side and clamps vertically rather than being clipped.
 */
function placement({ x, y }: TooltipPosition): React.CSSProperties {
  const PAD = 14;
  const W = 232;
  const flip = typeof window !== 'undefined' && x + W + PAD * 2 > window.innerWidth;
  return {
    left: flip ? undefined : x + PAD,
    right: flip ? window.innerWidth - x + PAD : undefined,
    top: Math.max(PAD, y - 12),
  };
}

/** Small inline explainer used on card headers. */
export function InfoDot({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="infodot" tabIndex={0} role="note" aria-label={label}>
      <span className="infodot__mark" aria-hidden>
        i
      </span>
      <span className="infodot__panel">{children}</span>
    </span>
  );
}
