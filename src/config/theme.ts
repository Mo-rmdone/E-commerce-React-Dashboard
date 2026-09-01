/**
 * Bridge between the CSS token layer and D3, which needs real colour strings.
 * Tokens are read from the document so charts follow the active theme instead
 * of carrying a second, drifting palette.
 */

export const TOKEN = {
  ink: '--c-ink',
  ink2: '--c-ink-2',
  muted: '--c-muted',
  faint: '--c-faint',
  surface: '--c-surface',
  surface2: '--c-surface-2',
  surface3: '--c-surface-3',
  rule: '--c-rule',
  ruleSoft: '--c-rule-soft',
  accent: '--c-accent',
  accentSoft: '--c-accent-soft',
  accentLine: '--c-accent-line',
  pos: '--c-pos',
  posSoft: '--c-pos-soft',
  neg: '--c-neg',
  negSoft: '--c-neg-soft',
  warn: '--c-warn',
  warnSoft: '--c-warn-soft',
  neutral: '--c-neutral',
  neutralSoft: '--c-neutral-soft',
  reference: '--c-reference',
  referenceSoft: '--c-reference-soft',
  grid: '--c-grid',
  axis: '--c-axis',
  track: '--c-track',
  dim: '--c-dim',
} as const;

export type TokenKey = keyof typeof TOKEN;

const CATEGORICAL_VARS = [
  '--c-cat-1',
  '--c-cat-2',
  '--c-cat-3',
  '--c-cat-4',
  '--c-cat-5',
  '--c-cat-6',
  '--c-cat-7',
  '--c-cat-8',
];

let cache: Record<string, string> = {};

function readVar(name: string): string {
  if (cache[name]) return cache[name];
  if (typeof window === 'undefined') return '#000';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache[name] = v || '#000';
  return cache[name];
}

/** Invalidate on theme change so the next chart render picks up new values. */
export function invalidateThemeCache(): void {
  cache = {};
}

export function color(key: TokenKey): string {
  return readVar(TOKEN[key]);
}

export function categorical(): string[] {
  return CATEGORICAL_VARS.map(readVar);
}

/** Stable colour for a named series, so a category keeps its hue everywhere. */
export function seriesColor(name: string, order: readonly string[]): string {
  const palette = categorical();
  const i = order.indexOf(name);
  return palette[(i < 0 ? hash(name) : i) % palette.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Semantic colour for a status level. Always paired with an icon and label. */
export function statusColor(level: 'on-target' | 'at-risk' | 'off-target' | 'neutral'): string {
  switch (level) {
    case 'on-target':
      return color('pos');
    case 'at-risk':
      return color('warn');
    case 'off-target':
      return color('neg');
    default:
      return color('neutral');
  }
}

export function statusSoftColor(
  level: 'on-target' | 'at-risk' | 'off-target' | 'neutral',
): string {
  switch (level) {
    case 'on-target':
      return color('posSoft');
    case 'at-risk':
      return color('warnSoft');
    case 'off-target':
      return color('negSoft');
    default:
      return color('neutralSoft');
  }
}

/** Direction of a change, independent of whether it meets a target. */
export function deltaColor(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta) || delta === 0) return color('muted');
  return delta > 0 ? color('pos') : color('neg');
}

export const CHART = {
  /** Consistent plot padding so gridlines line up across cards. */
  margin: { top: 14, right: 18, bottom: 26, left: 48 },
  tickSize: 4,
  strokeWidth: 1.75,
  pointRadius: 3,
  fontSize: 10.5,
  labelFont: "10.5px 'IBM Plex Mono', monospace",
} as const;
