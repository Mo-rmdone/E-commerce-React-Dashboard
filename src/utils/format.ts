/**
 * Formatting is centralised so a figure looks the same wherever it appears.
 * Everything returns an em-dash for null — a missing value is never a zero.
 */

export const DASH = '—';

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const usdFull = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Compact currency for KPIs and axes: $6.5M, $412K, $940. */
export function usdShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) < 1000) return usdFull.format(v);
  return usdCompact.format(v);
}

/** Full currency for tables and tooltips: $6,517,641. */
export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return usdFull.format(v);
}

export function usdPrecise(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return usdCents.format(v);
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return intFmt.format(v);
}

/** Rate as a percentage: 0.1635 -> "16.4%". */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** Signed rate, for growth and variance: "+22.4%", "−4.6%". */
export function pctSigned(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = (v * 100).toFixed(digits);
  return v > 0 ? `+${s}%` : `${s.replace('-', '−')}%`;
}

/** Percentage points, for margin deltas where "%" would be ambiguous. */
export function ppSigned(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = (v * 100).toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s.replace('-', '')} pp`;
}

export function signedInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${intFmt.format(Math.abs(v))}`;
}

/** Compact counts for dense chips: 15,707 -> "15.7K". */
export function countShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) < 1000) return intFmt.format(v);
  if (Math.abs(v) < 1_000_000) return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

/** Trim a label to fit a fixed-width slot without cutting mid-word if avoidable. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function monthLabel(t: number): string {
  return monthYear.format(new Date(t));
}

export function isoDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** Ordinal rank: 1 -> "1st". Used for "#3 of 164" context. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
