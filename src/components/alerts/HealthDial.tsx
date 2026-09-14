import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import './alerts.css';

/**
 * Composite health, shown as a prominent gradient dial with its four
 * components broken out. The breakdown is what stops the single number being a
 * black box; the ring gives the executive read at a glance.
 */
export function HealthDial({
  health,
}: {
  health: { score: number; components: { label: string; achieved: number }[] };
}) {
  const SIZE = 108;
  const R = 44;
  const C = 2 * Math.PI * R;
  const pctDone = Math.max(0, Math.min(1, health.score / 100));
  const tone = health.score >= 70 ? 'pos' : health.score >= 55 ? 'warn' : 'neg';
  const word =
    health.score >= 85 ? 'Strong' : health.score >= 70 ? 'Good' : health.score >= 55 ? 'Fair' : 'At risk';
  const met = health.components.filter((c) => c.achieved >= 1).length;

  return (
    <div className="health">
      <div className="health__header">
        <span className={`health__badge health__badge--${tone}`}>
          <ShieldCheck size={15} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="label">Composite health score</span>
      </div>

      <div className="health__main">
        <div className="health__dial" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
            <defs>
              <linearGradient id="health-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--c-pos)" />
                <stop offset="100%" stopColor="var(--c-accent)" />
              </linearGradient>
            </defs>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--c-track)" strokeWidth={10} />
            <motion.circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="url(#health-grad)"
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * (1 - pctDone) }}
              transition={{ duration: 0.8, ease: [0.2, 0, 0.1, 1] }}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>
          <div className="health__score">
            <span className="num">{health.score}</span>
            <span className="health__max">/100</span>
          </div>
        </div>

        <div className="health__summary">
          <p className={`health__word health__word--${tone}`}>{word}</p>
          <p className="health__meta">
            <span className="num">{met}</span> of <span className="num">{health.components.length}</span> targets
            on track
          </p>
        </div>
      </div>

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
  );
}
