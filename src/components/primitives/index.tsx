import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { STATUS_LABEL, type StatusLevel } from '@/config/targets';
import { DASH } from '@/utils/format';
import './primitives.css';

/* ------------------------------------------------------------------ card */

export function Card({
  title,
  subtitle,
  info,
  tools,
  children,
  flush,
  className = '',
  span,
  minHeight,
}: {
  title?: string;
  subtitle?: ReactNode;
  info?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  span?: string;
  minHeight?: number;
}) {
  return (
    <section
      className={`card ${className}`}
      style={{ gridArea: span, minHeight }}
      aria-label={title}
    >
      {title ? (
        <header className="card__head">
          <h3 className="card__title">{title}</h3>
          {info}
          {subtitle ? <span className="card__sub">{subtitle}</span> : null}
          {tools ? <div className="card__tools">{tools}</div> : null}
        </header>
      ) : null}
      <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- status */

const STATUS_ICON: Record<StatusLevel, LucideIcon> = {
  'on-target': CheckCircle2,
  'at-risk': AlertTriangle,
  'off-target': XCircle,
  neutral: Minus,
};

const STATUS_CHIP: Record<StatusLevel, string> = {
  'on-target': 'chip--pos',
  'at-risk': 'chip--warn',
  'off-target': 'chip--neg',
  neutral: 'chip--neutral',
};

/**
 * Status is always icon + word + colour. Colour alone never carries the
 * meaning, so the state survives a monochrome print or a colour-vision
 * difference.
 */
export function StatusChip({
  level,
  label,
  compact = false,
}: {
  level: StatusLevel;
  label?: string;
  compact?: boolean;
}) {
  const Icon = STATUS_ICON[level];
  return (
    <span className={`chip ${STATUS_CHIP[level]}`}>
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {!compact ? <span>{label ?? STATUS_LABEL[level]}</span> : null}
      {compact ? <span className="sr-only">{label ?? STATUS_LABEL[level]}</span> : null}
    </span>
  );
}

/** Signed change with a direction arrow, coloured by direction. */
export function Delta({
  value,
  format,
  suffix,
  invert = false,
}: {
  value: number | null;
  format: (v: number | null) => string;
  suffix?: string;
  /** For measures where down is good (e.g. discount depth). */
  invert?: boolean;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="delta delta--none num">{DASH}</span>;
  }
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  const tone = value === 0 ? 'none' : good ? 'pos' : 'neg';
  return (
    <span className={`delta delta--${tone}`}>
      {value !== 0 ? <Icon size={12} strokeWidth={2.5} aria-hidden /> : null}
      <span className="num">{format(value)}</span>
      {suffix ? <span className="delta__suffix">{suffix}</span> : null}
    </span>
  );
}

/* ----------------------------------------------------------- empty state */

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <Icon size={20} strokeWidth={1.6} aria-hidden />
      <p className="empty__title">{title}</p>
      <p className="empty__msg">{message}</p>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- skeleton */

export function ChartSkeleton({ height = 180 }: { height?: number }) {
  return (
    <div className="skeleton" style={{ height }} aria-hidden>
      <div className="skeleton__shimmer" />
    </div>
  );
}

/* ------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg__btn"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- micro bar */

/**
 * Inline comparison bar for table cells. The bar is decoration for the number
 * beside it, so it is hidden from assistive tech rather than read twice.
 */
export function MicroBar({
  value,
  max,
  tone = 'accent',
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'pos' | 'neg' | 'neutral';
}) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="mbar" aria-hidden>
      {/* Width is the comparison, so it is set directly and eased by CSS
          rather than tweened up from zero. */}
      <span
        className={`mbar__fill mbar__fill--${tone}`}
        style={{ transform: `scaleX(${w})` }}
      />
    </span>
  );
}

