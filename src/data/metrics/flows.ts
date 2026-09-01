import type { Dataset } from '@/types';
import type { RevenueBasis } from '@/config/targets';
import { dimensionAccess, type BreakdownDimension } from './breakdowns';

/**
 * Revenue flows between two dimensions.
 *
 * A flow is the honest shape for this workbook's product data. Category and
 * Subcategory are attributes of the order *line*, and 3,576 products appear
 * under more than one subcategory — so a product does not "belong to" a
 * category, and a containment visual would assert a hierarchy that is not
 * there. A flow says only what the data says: this much revenue moved from
 * this source to this target.
 */

export interface FlowNode {
  /** Stable id: `${side}:${key}`, since a source and target key can collide. */
  id: string;
  key: number;
  label: string;
  side: 'source' | 'target';
  value: number;
  /** True for the synthetic bucket holding the long tail. */
  aggregate: boolean;
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
  /** Share of the source node's total that this link carries. */
  shareOfSource: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  total: number;
  /** How many targets were folded into the aggregate bucket, if any. */
  foldedTargets: number;
}

export interface BuildFlowOptions {
  /** Accepted for symmetry with the other builders; reporting is gross. */
  basis?: RevenueBasis;
  /** Targets beyond this many are folded into a single "Other" node. */
  maxTargets?: number;
  /** Drop links carrying less than this share of total revenue. */
  minLinkShare?: number;
}

const OTHER_KEY = -1;

export function buildFlowGraph(
  ds: Dataset,
  rows: Int32Array,
  sourceDim: BreakdownDimension,
  targetDim: BreakdownDimension,
  opts: BuildFlowOptions = {},
): FlowGraph {
  const { maxTargets = 14, minLinkShare = 0.0015 } = opts;

  const src = dimensionAccess(ds, sourceDim);
  const tgt = dimensionAccess(ds, targetDim);
  const f = ds.facts;

  // Pair sums keyed by source * targetSize + target, so one pass covers both
  // the link values and each node's total.
  const pair = new Map<number, number>();
  const sourceTotal = new Map<number, number>();
  const targetTotal = new Map<number, number>();
  let total = 0;

  for (let j = 0; j < rows.length; j++) {
    const i = rows[j];
    const s = src.keyOf(i);
    const t = tgt.keyOf(i);
    if (s < 0 || t < 0) continue;

    const value = f.sales[i];
    if (value <= 0) continue;

    const k = s * tgt.size + t;
    pair.set(k, (pair.get(k) ?? 0) + value);
    sourceTotal.set(s, (sourceTotal.get(s) ?? 0) + value);
    targetTotal.set(t, (targetTotal.get(t) ?? 0) + value);
    total += value;
  }

  if (total === 0) return { nodes: [], links: [], total: 0, foldedTargets: 0 };

  // Keep the biggest targets; the rest become one honest "Other" node rather
  // than disappearing, so the flows still sum to the whole.
  const rankedTargets = [...targetTotal.entries()].sort((a, b) => b[1] - a[1]);
  const kept = new Set(rankedTargets.slice(0, maxTargets).map(([k]) => k));
  const foldedTargets = Math.max(0, rankedTargets.length - kept.size);

  const linkAcc = new Map<string, number>();
  for (const [k, v] of pair) {
    const s = Math.floor(k / tgt.size);
    const t = k % tgt.size;
    const tk = kept.has(t) ? t : OTHER_KEY;
    const id = `${s}|${tk}`;
    linkAcc.set(id, (linkAcc.get(id) ?? 0) + v);
  }

  const usedSources = new Set<number>();
  const usedTargets = new Set<number>();
  const links: FlowLink[] = [];

  for (const [id, v] of linkAcc) {
    if (v / total < minLinkShare) continue;
    const [sRaw, tRaw] = id.split('|');
    const s = Number(sRaw);
    const t = Number(tRaw);
    usedSources.add(s);
    usedTargets.add(t);
    links.push({
      source: `source:${s}`,
      target: `target:${t}`,
      value: v,
      shareOfSource: v / (sourceTotal.get(s) || 1),
    });
  }

  const nodes: FlowNode[] = [];
  for (const s of usedSources) {
    nodes.push({
      id: `source:${s}`,
      key: s,
      label: src.label(s),
      side: 'source',
      value: sourceTotal.get(s) ?? 0,
      aggregate: false,
    });
  }
  for (const t of usedTargets) {
    const isOther = t === OTHER_KEY;
    nodes.push({
      id: `target:${t}`,
      key: t,
      label: isOther ? `Other (${foldedTargets})` : tgt.label(t),
      side: 'target',
      // The aggregate node's value is the sum of the links reaching it.
      value: isOther
        ? links.filter((l) => l.target === `target:${OTHER_KEY}`).reduce((a, l) => a + l.value, 0)
        : (targetTotal.get(t) ?? 0),
      aggregate: isOther,
    });
  }

  nodes.sort((a, b) => (a.side === b.side ? b.value - a.value : a.side === 'source' ? -1 : 1));
  links.sort((a, b) => b.value - a.value);

  return { nodes, links, total, foldedTargets };
}
