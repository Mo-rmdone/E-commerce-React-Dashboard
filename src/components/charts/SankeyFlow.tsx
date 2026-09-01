import { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';
import { Workflow } from 'lucide-react';
import type { FlowGraph, FlowNode } from '@/data/metrics/flows';
import { ChartTooltip, type TooltipModel } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { truncate } from '@/utils/format';

/**
 * Revenue flow between two levels.
 *
 * Band height is revenue, so the eye compares thicknesses rather than areas,
 * and both levels are visible at once — a treemap could only ever show one.
 * Source nodes are clickable (they filter and drill); target nodes filter.
 *
 * Nothing here animates its geometry: band thickness *is* the value, so it is
 * painted correct on the first frame.
 */

export interface SankeyDatum extends FlowNode {
  tooltip: TooltipModel;
}

interface LaidOutNode {
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  datum: SankeyDatum;
}

interface LaidOutLink {
  path: string;
  width: number;
  sourceId: string;
  targetId: string;
  value: number;
  tooltip: TooltipModel;
}

const NODE_W = 11;
const LABEL_PAD = 9;

export function SankeyFlow({
  graph,
  height = 300,
  colorOf,
  nodeTooltip,
  linkTooltip,
  selectedSources,
  selectedTargets,
  onSelectSource,
  onSelectTarget,
  onDrillSource,
  labelWidth = 140,
}: {
  graph: FlowGraph;
  height?: number;
  colorOf: (node: FlowNode, index: number) => string;
  nodeTooltip: (node: FlowNode) => TooltipModel;
  linkTooltip: (
    source: FlowNode,
    target: FlowNode,
    value: number,
    shareOfSource: number,
  ) => TooltipModel;
  selectedSources: number[];
  selectedTargets: number[];
  onSelectSource: (key: number) => void;
  onSelectTarget: (key: number) => void;
  onDrillSource?: (node: FlowNode) => void;
  labelWidth?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [hover, setHover] = useState<string | null>(null);

  const w = size.width;

  const layout = useMemo(() => {
    if (w < 220 || graph.nodes.length === 0 || graph.links.length === 0) return null;

    const inner = {
      x0: labelWidth,
      x1: Math.max(labelWidth + 40, w - labelWidth),
      y0: 4,
      y1: Math.max(40, height - 4),
    };

    const gen = sankey<{ id: string }, { value: number }>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_W)
      .nodePadding(graph.nodes.length > 16 ? 6 : 10)
      .nodeAlign(sankeyJustify)
      .extent([
        [inner.x0, inner.y0],
        [inner.x1, inner.y1],
      ]);

    // d3-sankey mutates its input, so it gets copies.
    const nodesIn = graph.nodes.map((n) => ({ id: n.id }));
    const linksIn = graph.links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
    }));

    let result;
    try {
      result = gen({ nodes: nodesIn, links: linksIn } as never);
    } catch {
      // A disconnected or cyclic graph is not renderable; fall back to an empty
      // frame rather than throwing inside a chart card.
      return null;
    }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes: LaidOutNode[] = [];
    for (const n of result.nodes as unknown as (LaidOutNode & { id: string })[]) {
      const src = byId.get(n.id);
      if (!src) continue;
      nodes.push({
        id: n.id,
        x0: n.x0,
        x1: n.x1,
        y0: n.y0,
        y1: n.y1,
        datum: { ...src, tooltip: nodeTooltip(src) },
      });
    }

    const pathOf = sankeyLinkHorizontal();
    const shareById = new Map(graph.links.map((l) => [`${l.source}>${l.target}`, l.shareOfSource]));
    const links: LaidOutLink[] = [];
    for (const l of result.links as unknown as {
      source: { id: string };
      target: { id: string };
      value: number;
      width: number;
    }[]) {
      const s = byId.get(l.source.id);
      const t = byId.get(l.target.id);
      if (!s || !t) continue;
      links.push({
        path: pathOf(l as never) ?? '',
        width: Math.max(1, l.width),
        sourceId: l.source.id,
        targetId: l.target.id,
        value: l.value,
        tooltip: linkTooltip(s, t, l.value, shareById.get(`${s.id}>${t.id}`) ?? 0),
      });
    }

    return { nodes, links };
  }, [graph, w, height, labelWidth, nodeTooltip, linkTooltip]);

  if (graph.nodes.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={Workflow}
          title="No flows to trace"
          message="The current filter and drill path select no order lines."
        />
      </div>
    );
  }

  const colorIndex = new Map(
    graph.nodes.filter((n) => n.side === 'source').map((n, i) => [n.id, i]),
  );
  const colorFor = (n: FlowNode) => colorOf(n, colorIndex.get(n.id) ?? 0);

  const hasSourceSel = selectedSources.length > 0;
  const hasTargetSel = selectedTargets.length > 0;

  const isNodeSelected = (n: FlowNode) =>
    n.side === 'source' ? selectedSources.includes(n.key) : selectedTargets.includes(n.key);

  const isNodeDimmed = (n: FlowNode) => {
    if (hover) return hover !== n.id && !touchesHover(n.id);
    if (n.side === 'source' && hasSourceSel) return !selectedSources.includes(n.key);
    if (n.side === 'target' && hasTargetSel) return !selectedTargets.includes(n.key);
    return false;
  };

  function touchesHover(id: string): boolean {
    if (!hover || !layout) return false;
    return layout.links.some(
      (l) =>
        (l.sourceId === hover || l.targetId === hover) &&
        (l.sourceId === id || l.targetId === id),
    );
  }

  const isLinkDimmed = (l: LaidOutLink) => {
    if (hover) return l.sourceId !== hover && l.targetId !== hover;
    if (hasSourceSel && !selectedSources.includes(keyOf(l.sourceId))) return true;
    if (hasTargetSel && !selectedTargets.includes(keyOf(l.targetId))) return true;
    return false;
  };

  return (
    <div ref={ref} className="chart-wrap" style={{ minHeight: height }}>
      {layout ? (
        <svg width={w} height={height} role="img" aria-label="Revenue flow between levels">
          <g className="sankey__links">
            {layout.links.map((l, i) => {
              const src = layout.nodes.find((n) => n.id === l.sourceId);
              return (
                <path
                  key={`${l.sourceId}>${l.targetId}-${i}`}
                  className="sankey__link"
                  d={l.path}
                  stroke={src ? colorFor(src.datum) : 'var(--c-neutral)'}
                  strokeWidth={l.width}
                  opacity={isLinkDimmed(l) ? 0.07 : hover ? 0.5 : 0.28}
                  onPointerEnter={(e) => show(l.tooltip, e)}
                  onPointerMove={(e) => show(l.tooltip, e)}
                  onPointerLeave={hide}
                />
              );
            })}
          </g>

          {layout.nodes.map((n) => {
            const d = n.datum;
            const sel = isNodeSelected(d);
            const dim = isNodeDimmed(d);
            const isSource = d.side === 'source';
            const drillable = isSource && !!onDrillSource;
            return (
              <g
                key={n.id}
                className="chart-hit"
                opacity={dim ? 0.3 : 1}
                onPointerEnter={(e) => {
                  setHover(n.id);
                  show(d.tooltip, e);
                }}
                onPointerMove={(e) => show(d.tooltip, e)}
                onPointerLeave={() => {
                  setHover(null);
                  hide();
                }}
                onClick={() => (isSource ? onSelectSource(d.key) : onSelectTarget(d.key))}
                onDoubleClick={() => drillable && onDrillSource?.(d)}
              >
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={Math.max(NODE_W, n.x1 - n.x0)}
                  height={Math.max(2, n.y1 - n.y0)}
                  rx={2}
                  fill={colorFor(d)}
                  stroke={sel ? 'var(--c-ink)' : 'none'}
                  strokeWidth={sel ? 2 : 0}
                />
                <text
                  x={isSource ? n.x0 - LABEL_PAD : n.x1 + LABEL_PAD}
                  y={(n.y0 + n.y1) / 2}
                  dy="0.34em"
                  textAnchor={isSource ? 'end' : 'start'}
                  className={`sankey__label ${sel ? 'sankey__label--sel' : ''}`}
                >
                  {truncate(d.label, Math.max(10, Math.floor(labelWidth / 6.2)))}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function keyOf(id: string): number {
  return Number(id.slice(id.indexOf(':') + 1));
}
