import { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal, sankeyJustify } from 'd3-sankey';
import { Workflow } from 'lucide-react';
import type { LevelFlowGraph, LevelNode } from '@/data/metrics/customers';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { pct, truncate } from '@/utils/format';
import './level-sankey.css';

/**
 * A multi-level flow: the whole on the left, decomposed once per column.
 *
 * Band thickness is the measure, so the eye compares thicknesses rather than
 * areas, and every level stays visible at once. Each node carries its label and
 * value to its right, under a column header, so the diagram reads as a set of
 * ranked lists that happen to be joined by their flows.
 */

const NODE_W = 12;
const LABEL_PAD = 10;
const HEADER_H = 30;

interface LaidOut {
  node: LevelNode;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function LevelSankey({
  graph,
  height = 400,
  colorOf,
  isSelected,
  onSelectNode,
  formatValue,
  rightLabelWidth = 150,
}: {
  graph: LevelFlowGraph;
  height?: number;
  colorOf: (node: LevelNode) => string;
  isSelected: (node: LevelNode) => boolean;
  /** Called for segment and category nodes; the root is not selectable. */
  onSelectNode: (node: LevelNode) => void;
  formatValue: (v: number) => string;
  rightLabelWidth?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [hover, setHover] = useState<string | null>(null);

  const w = size.width;

  const layout = useMemo(() => {
    if (w < 260 || graph.nodes.length === 0 || graph.links.length === 0) return null;

    // Ranked, not solver-ordered: every column reads largest to smallest, so
    // the diagram answers "which is biggest" as directly as a bar chart while
    // still showing where each band goes. Links inherit the same order, which
    // also keeps the ribbons from crossing more than the data requires.
    const gen = sankey<{ id: string; value?: number }, { value: number }>()
      .nodeId((d) => d.id)
      .nodeWidth(NODE_W)
      .nodePadding(14)
      .nodeAlign(sankeyJustify)
      .nodeSort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .linkSort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .extent([
        [2, HEADER_H],
        [Math.max(80, w - rightLabelWidth), Math.max(HEADER_H + 40, height - 6)],
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
      return null;
    }

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes: LaidOut[] = [];
    for (const n of result.nodes as unknown as (LaidOut & { id: string })[]) {
      const src = byId.get(n.id);
      if (!src) continue;
      nodes.push({ node: src, x0: n.x0, x1: n.x1, y0: n.y0, y1: n.y1 });
    }

    const pathOf = sankeyLinkHorizontal();
    const shareById = new Map(graph.links.map((l) => [`${l.source}>${l.target}`, l.shareOfSource]));
    const links = (
      result.links as unknown as {
        source: { id: string };
        target: { id: string };
        value: number;
        width: number;
      }[]
    )
      .map((l) => {
        const s = byId.get(l.source.id);
        const t = byId.get(l.target.id);
        if (!s || !t) return null;
        return {
          path: pathOf(l as never) ?? '',
          width: Math.max(1, l.width),
          source: s,
          target: t,
          value: l.value,
          share: shareById.get(`${s.id}>${t.id}`) ?? 0,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    // Column header positions come from the laid-out nodes, so they always sit
    // exactly above their own column whatever the sankey solver chose.
    const headers = graph.levels
      .map((label, level) => {
        const first = nodes.find((n) => n.node.level === level);
        return first ? { label, x: first.x0 } : null;
      })
      .filter((h): h is { label: string; x: number } => h !== null);

    return { nodes, links, headers };
  }, [graph, w, height, rightLabelWidth]);

  if (graph.nodes.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={Workflow}
          title="No flows to trace"
          message="The current filter selects nothing that can be drawn as a flow."
        />
      </div>
    );
  }

  /** Each segment owns a hue; the flow keeps it on both sides of the column. */
  const linkColor = (l: { source: LevelNode; target: LevelNode }) =>
    colorOf(l.source.dimension === 'total' ? l.target : l.source);

  const touchesHover = (id: string) =>
    !!hover &&
    !!layout?.links.some(
      (l) =>
        (l.source.id === hover || l.target.id === hover) &&
        (l.source.id === id || l.target.id === id),
    );

  return (
    <div ref={ref} className="chart-wrap lsankey" style={{ minHeight: height }}>
      {layout ? (
        <svg width={w} height={height} role="img" aria-label="Flow from total to segment to category">
          {layout.headers.map((h) => (
            <g key={h.label} transform={`translate(${h.x},0)`}>
              <text y={11} className="lsankey__header">
                {h.label}
              </text>
              <line x1={0} x2={Math.min(120, w - h.x - 8)} y1={18} y2={18} className="lsankey__rule" />
            </g>
          ))}

          <g>
            {layout.links.map((l, i) => {
              const dim = hover ? l.source.id !== hover && l.target.id !== hover : false;
              return (
                <path
                  key={`${l.source.id}>${l.target.id}-${i}`}
                  className="sankey__link"
                  d={l.path}
                  stroke={linkColor(l)}
                  strokeWidth={l.width}
                  opacity={dim ? 0.06 : hover ? 0.48 : 0.26}
                  onPointerEnter={(e) =>
                    show(
                      {
                        title: `${l.source.label} → ${l.target.label}`,
                        rows: [
                          { label: 'Value', value: formatValue(l.value), strong: true },
                          { label: `Share of ${l.source.label}`, value: pct(l.share, 1) },
                        ],
                      },
                      e,
                    )
                  }
                  onPointerMove={(e) =>
                    show(
                      {
                        title: `${l.source.label} → ${l.target.label}`,
                        rows: [
                          { label: 'Value', value: formatValue(l.value), strong: true },
                          { label: `Share of ${l.source.label}`, value: pct(l.share, 1) },
                        ],
                      },
                      e,
                    )
                  }
                  onPointerLeave={hide}
                />
              );
            })}
          </g>

          {layout.nodes.map((n) => {
            const d = n.node;
            const sel = isSelected(d);
            const dim = hover ? hover !== d.id && !touchesHover(d.id) : false;
            const clickable = d.dimension !== 'total';
            const labelRoom = Math.max(60, w - n.x1 - LABEL_PAD - 4);
            return (
              <g
                key={d.id}
                className={clickable ? 'chart-hit' : undefined}
                opacity={dim ? 0.3 : 1}
                onPointerEnter={(e) => {
                  setHover(d.id);
                  show(
                    {
                      title: d.label,
                      subtitle: graph.levels[d.level],
                      rows: [
                        { label: 'Value', value: formatValue(d.value), strong: true },
                        { label: 'Share of total', value: pct(d.value / (graph.total || 1), 1) },
                      ],
                      hint: clickable ? 'Click to filter' : undefined,
                    },
                    e,
                  );
                }}
                onPointerMove={(e) =>
                  show(
                    {
                      title: d.label,
                      subtitle: graph.levels[d.level],
                      rows: [
                        { label: 'Value', value: formatValue(d.value), strong: true },
                        { label: 'Share of total', value: pct(d.value / (graph.total || 1), 1) },
                      ],
                      hint: clickable ? 'Click to filter' : undefined,
                    },
                    e,
                  )
                }
                onPointerLeave={() => {
                  setHover(null);
                  hide();
                }}
                onClick={() => clickable && onSelectNode(d)}
              >
                <rect
                  x={n.x0}
                  y={n.y0}
                  width={Math.max(NODE_W, n.x1 - n.x0)}
                  height={Math.max(2, n.y1 - n.y0)}
                  rx={3}
                  fill={colorOf(d)}
                  stroke={sel ? 'var(--c-ink)' : 'none'}
                  strokeWidth={sel ? 2 : 0}
                />
                <text
                  x={n.x1 + LABEL_PAD}
                  y={(n.y0 + n.y1) / 2}
                  className={`lsankey__label ${sel ? 'lsankey__label--sel' : ''}`}
                >
                  <title>{d.label}</title>
                  <tspan x={n.x1 + LABEL_PAD} dy="-0.15em">
                    {truncate(d.label, Math.max(8, Math.floor(labelRoom / 6.6)))}
                  </tspan>
                  <tspan x={n.x1 + LABEL_PAD} dy="1.25em" className="lsankey__value">
                    {formatValue(d.value)}
                  </tspan>
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
