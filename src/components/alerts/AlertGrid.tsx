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
}: {
  alerts: Alert[];
  health: { score: number; components: { label: string; achieved: number }[] } | null;
  onAct: (dimension: FilterDimension, value: number) => void;
}) {
  return (
    <div className="alerts">
      {health ? <HealthDial health={health} /> : null}

      <div className="alerts__list">
        {alerts.length === 0 ? (
          <p className="alerts__none">
            <ShieldCheck size={14} aria-hidden />
            Every target is being met in this view. Nothing needs attention.
          </p>
        ) : (
          alerts.map((a, i) => {
            const Icon = ICON[a.severity];
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

/**
 * Composite health, shown as a dial with its four components broken out.
 * The breakdown is what stops the single number being a black box.
 */
function HealthDial({
  health,
}: {
  health: { score: number; components: { label: string; achieved: number }[] };
}) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const pctDone = Math.max(0, Math.min(1, health.score / 100));
  const tone =
    health.score >= 90 ? 'pos' : health.score >= 65 ? 'warn' : 'neg';
  const word = health.score >= 90 ? 'Strong' : health.score >= 65 ? 'Mixed' : 'Under pressure';

  return (
    <div className="health">
      <div className="health__dial">
        <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden>
          <circle cx={38} cy={38} r={R} fill="none" stroke="var(--c-track)" strokeWidth={7} />
          <motion.circle
            cx={38}
            cy={38}
            r={R}
            fill="none"
            stroke={`var(--c-${tone})`}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - pctDone) }}
            transition={{ duration: 0.7, ease: [0.2, 0, 0.1, 1] }}
            transform="rotate(-90 38 38)"
          />
        </svg>
        <div className="health__score">
          <span className="num">{health.score}</span>
          <span className="health__max">/100</span>
        </div>
      </div>
      <div className="health__text">
        <p className="label">Composite health</p>
        <p className={`health__word health__word--${tone}`}>{word}</p>
        <ul className="health__parts">
          {health.components.map((c) => (
            <li key={c.label}>
              <span className="health__part-label">{c.label}</span>
              <span className="health__part-track" aria-hidden>
                <span
                  className="health__part-fill"
                  style={{
                    width: `${Math.round(c.achieved * 100)}%`,
                    background:
                      c.achieved >= 1
                        ? 'var(--c-pos)'
                        : c.achieved >= 0.7
                          ? 'var(--c-warn)'
                          : 'var(--c-neg)',
                  }}
                />
              </span>
              <span className="health__part-val num">{Math.round(c.achieved * 100)}%</span>
            </li>
          ))}
        </ul>
        <p className="health__note">Share of each target achieved, capped at 100%.</p>
      </div>
    </div>
  );
}
