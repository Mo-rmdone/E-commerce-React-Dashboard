import { useCallback, useMemo, useState } from 'react';

/**
 * Generic drill-down stack.
 *
 * A path is a list of `{ level, key, label }` steps. The hook only tracks
 * where the user is; the caller decides what each level means, which is what
 * lets the same machinery drive the product hierarchy and the segment
 * hierarchy without either knowing about the other.
 *
 * Drilling never writes to the global filter store — it narrows the view of one
 * visual while the page's filter context stays put. Callers that *do* want a
 * drill step to filter the whole page opt in explicitly.
 */

export interface DrillStep<L extends string> {
  level: L;
  key: number;
  label: string;
}

export interface DrilldownApi<L extends string> {
  /** Levels below the root, in order. */
  path: DrillStep<L>[];
  /** The level currently being displayed. */
  level: L;
  /** Level the next drill would land on, or null at the deepest level. */
  nextLevel: L | null;
  depth: number;
  canDrillUp: boolean;
  drillTo: (step: DrillStep<L>) => void;
  drillUp: () => void;
  /** Jump to a breadcrumb position. -1 is the root. */
  jumpTo: (index: number) => void;
  reset: () => void;
  /** Convenience: the key selected at a given level, if any. */
  keyAt: (level: L) => number | null;
}

export function useDrilldown<L extends string>(levels: readonly L[]): DrilldownApi<L> {
  const [path, setPath] = useState<DrillStep<L>[]>([]);

  const level = (levels[Math.min(path.length, levels.length - 1)] ?? levels[0]) as L;
  const nextLevel = path.length + 1 < levels.length ? levels[path.length + 1] : null;

  const drillTo = useCallback(
    (step: DrillStep<L>) => {
      setPath((p) => {
        // Guard against drilling below the deepest defined level.
        if (p.length >= levels.length - 1) return p;
        return [...p, step];
      });
    },
    [levels.length],
  );

  const drillUp = useCallback(() => setPath((p) => p.slice(0, -1)), []);
  const jumpTo = useCallback((i: number) => setPath((p) => p.slice(0, i + 1)), []);
  const reset = useCallback(() => setPath([]), []);

  const keyAt = useCallback(
    (l: L) => path.find((s) => s.level === l)?.key ?? null,
    [path],
  );

  return useMemo(
    () => ({
      path,
      level,
      nextLevel,
      depth: path.length,
      canDrillUp: path.length > 0,
      drillTo,
      drillUp,
      jumpTo,
      reset,
      keyAt,
    }),
    [path, level, nextLevel, drillTo, drillUp, jumpTo, reset, keyAt],
  );
}

/**
 * Drill-through target: an entity the user opened for detail.
 * Separate from drill-down — this opens a panel, not a deeper grouping.
 */
export type DrillthroughEntity =
  | { kind: 'country'; key: number }
  | { kind: 'product'; key: number }
  | { kind: 'customer'; key: number }
  | { kind: 'market'; key: number };

export function useDrillthrough() {
  const [entity, setEntity] = useState<DrillthroughEntity | null>(null);
  const open = useCallback((e: DrillthroughEntity) => setEntity(e), []);
  const close = useCallback(() => setEntity(null), []);
  return useMemo(() => ({ entity, open, close }), [entity, open, close]);
}
