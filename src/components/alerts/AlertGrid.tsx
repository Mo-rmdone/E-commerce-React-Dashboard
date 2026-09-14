import { motion } from 'framer-motion';
import {
  ArrowRight,
  CircleCheck,
  Lightbulb,
  OctagonAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Alert, AlertSeverity } from '@/data/metrics/alerts';
import type { FilterDimension } from '@/types';
import { HealthDial } from './HealthDial';
import './alerts.css';

const ICON: Record<AlertSeverity, LucideIcon> = {
  critical: OctagonAlert,
  warning: TriangleAlert,
  opportunity: Lightbulb,
  positive: CircleCheck,
};

const SEVERITY_WORD: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Watch',
  opportunity: 'Opportunity',
  positive: 'On track',
};

export function AlertGrid({
  alerts,
  health,
  onAct,
  wide = false,
  iconFor,
  emptyMessage = 'Every target is being met in this view. Nothing needs attention.',
}: {
  alerts: Alert[];
  health: { score: number; components: { label: string; achieved: number }[] } | null;
  onAct: (dimension: FilterDimension, value: number) => void;
  /** Full-width placement: the cards flow in columns and the health block goes
      horizontal, instead of the narrow single-column rail. */
  wide?: boolean;
  /** Overrides the severity icon — lets a caller keep its own iconography
      while reusing the card. */
  iconFor?: (alert: Alert) => LucideIcon;
  emptyMessage?: string;
}) {
  return (
    <div className={`alerts${wide ? ' alerts--wide' : ''}`}>
      {health ? <HealthDial health={health} /> : null}

      <div className="alerts__list">
        {alerts.length === 0 ? (
          <p className="alerts__none">
            <ShieldCheck size={14} aria-hidden />
            {emptyMessage}
          </p>
        ) : (
          alerts.map((a, i) => {
            const Icon = iconFor?.(a) ?? ICON[a.severity];
            return (
              <motion.article
                key={a.id}
                className={`alert alert--${a.severity}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: i * 0.05, ease: [0.2, 0, 0.1, 1] }}
              >
                <header className="alert__head">
                  <Icon size={13} strokeWidth={2.2} aria-hidden />
                  <span className="alert__sev">{SEVERITY_WORD[a.severity]}</span>
                  <h4 className="alert__title">{a.title}</h4>
                </header>
                <div className="alert__metric">
                  <span className="alert__value num">{a.metric}</span>
                  <span className="alert__unit">{a.metricLabel}</span>
                </div>
                <p className="alert__detail">{a.detail}</p>
                {a.action ? (
                  <button
                    type="button"
                    className="alert__action"
                    onClick={() => onAct(a.action!.dimension, a.action!.value)}
                  >
                    {a.action.label}
                    <ArrowRight size={12} />
                  </button>
                ) : null}
              </motion.article>
            );
          })
        )}
      </div>
    </div>
  );
}
