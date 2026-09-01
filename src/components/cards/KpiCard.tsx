import type { Kpi } from '@/data/metrics/kpis';
import { STATUS_LABEL } from '@/config/targets';
import { Sparkline } from '@/components/charts/Sparkline';
import { InfoDot } from '@/components/tooltips/Tooltip';
import { Delta, StatusChip } from '@/components/primitives';
import { DASH, pct, pctSigned, ppSigned, usdShort } from '@/utils/format';
import './kpi.css';

/**
 * Executive KPI.
 *
 * Every card answers the same four questions in the same place: what is it,
 * how did it move, what was it supposed to be, and are we there. Consistent
 * position is what makes the row scannable in a few seconds.
 */
export function KpiCard({ kpi, index }: { kpi: Kpi; index: number }) {
  const value = formatValue(kpi);
  const variance = formatVariance(kpi);
  const sparkTone =
    kpi.status === 'on-target' ? 'pos' : kpi.status === 'off-target' ? 'neg' : 'muted';

  return (
    <article
      className={`kpi kpi--${kpi.status} card-enter`}
      style={{ '--enter-delay': `${index * 50}ms` } as React.CSSProperties}
      aria-label={`${kpi.label}: ${value}, ${STATUS_LABEL[kpi.status]}`}
    >
      <header className="kpi__head">
        <span className="label">{kpi.label}</span>
        <InfoDot label={`About ${kpi.label}`}>{kpi.help}</InfoDot>
        <span className="kpi__status">
          <StatusChip level={kpi.status} />
        </span>
      </header>

      <div className="kpi__value num">{value}</div>

      <div className="kpi__meta">
        {kpi.delta !== null ? (
          <Delta
            value={kpi.delta}
            format={kpi.id === 'margin' ? ppSigned : kpi.id === 'markets' ? formatCount : pctSigned}
            suffix={kpi.deltaLabel ?? undefined}
          />
        ) : (
          <span className="kpi__nodelta">{kpi.deltaLabel ?? 'No prior period'}</span>
        )}
        {kpi.spark.length > 1 ? (
          <Sparkline values={kpi.spark} tone={sparkTone} width={72} height={22} />
        ) : null}
      </div>

      <footer className="kpi__foot">
        <span className="kpi__target">{kpi.targetLabel}</span>
        <span className={`kpi__var kpi__var--${kpi.status}`}>{variance}</span>
      </footer>
    </article>
  );
}

function formatValue(kpi: Kpi): string {
  if (kpi.value === null) return DASH;
  switch (kpi.id) {
    case 'revenue':
      return usdShort(kpi.value);
    case 'margin':
      return pct(kpi.value);
    case 'corporate':
      return pctSigned(kpi.value);
    case 'markets':
      return pct(kpi.value, 0);
  }
}

/**
 * The footer's left half already names the target, so the variance is just the
 * gap. Spelling out "vs target" here overflowed the card at four-across.
 */
function formatVariance(kpi: Kpi): string {
  if (kpi.variance === null) return 'Not measurable here';
  switch (kpi.id) {
    case 'revenue':
    case 'corporate':
    case 'margin':
      return ppSigned(kpi.variance);
    case 'markets':
      return kpi.variance === 0 ? 'All clear' : `${pct(-kpi.variance, 0)} short`;
  }
}

function formatCount(v: number | null): string {
  if (v === null) return DASH;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
}
