import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { GitBranch } from 'lucide-react';
import type { Dataset } from '@/types';
import { BUSINESS_TARGETS } from '@/config/targets';
import { ChartTooltip } from '@/components/tooltips/Tooltip';
import { useChartTooltip } from './useChartTooltip';
import { useElementSize } from '@/hooks/useElementSize';
import { EmptyState } from '@/components/primitives';
import { pct, truncate, usdShort } from '@/utils/format';

/**
 * A decomposition tree over the clean hierarchy the workbook has:
 * Total → Category → Subcategory.
 *
 * It opens as categories only. Click a category to expand its subcategories and
 * double-click it to collapse; click a subcategory to filter the page to it.
 * Categories and subcategories are always ordered by the active metric, so the
 * view is a ranking at every level.
 *
 * On Sales the bar length is *share of the whole* — a category fills the track
 * by its share of total sales, a subcategory by its share of its category — so
 * the tree carries the part-to-whole story a treemap would, without giving up
 * the ranked order that a treemap's tiles make hard to read. On Profit the bar
 * is scaled to the biggest magnitude and turns red the moment a node loses
 * money, so a high-volume subcategory running at a loss cannot hide.
 */

export type TreeMetric = 'sales' | 'profit';

interface Agg {
  sales: number;
  profit: number;
}
interface SubNode extends Agg {
  key: number;
  label: string;
}
interface CatNode extends Agg {
  key: number;
  label: string;
  subs: SubNode[];
}

interface Placed {
  key: number;
  kind: 'root' | 'category' | 'subcategory';
  label: string;
  labelChars: number;
  x0: number;
  x1: number;
  y: number;
  value: number;
  sales: number;
  profit: number;
  share: string | null;
  colour: string;
  markerX: number | null;
  expanded: boolean;
  parent: 'root' | number | null;
}

const BAR_H = 12;
const TOP = 14;
const MIN_W = 320;
const MIN_ROW_H = 34;
const MAX_ROW_H = 60;

/** Column x-starts and bar budgets scaled to fill the available width. */
function columns(width: number) {
  const W = Math.max(width, MIN_W);
  const rightPad = 10;
  const PLUS = 18; // room for the +/− toggle after the category bar
  const GAP = 26; // slack for the connector curve between columns
  const rootX = 4;
  const catX = Math.round(W * 0.22);
  const subX = Math.round(W * 0.54);
  return {
    W,
    rootX,
    rootW: catX - rootX - GAP,
    catX,
    catW: subX - catX - PLUS - GAP,
    subX,
    subW: W - subX - rightPad,
  };
}

export function DecompositionTree({
  ds,
  rows,
  metric,
  palette,
  selectedCategories,
  selectedSubcategories,
  onFocusCategory,
  onResetCategory,
  onFocusSubcategory,
  onResetSubcategory,
  height = 320,
}: {
  ds: Dataset;
  rows: Int32Array;
  metric: TreeMetric;
  palette: string[];
  selectedCategories: number[];
  selectedSubcategories: number[];
  onFocusCategory: (key: number) => void;
  onResetCategory: () => void;
  onFocusSubcategory: (key: number) => void;
  onResetSubcategory: () => void;
  height?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { model, position, show, hide } = useChartTooltip();
  const [expandedCat, setExpandedCat] = useState<number | null>(null);

  const metricVal = (a: Agg) => (metric === 'sales' ? a.sales : a.profit);

  // One pass builds both measures for every category and subcategory, so the
  // toggle re-sorts without re-scanning.
  const tree = useMemo(() => {
    const f = ds.facts;
    const nSub = ds.dims.subcategories.length;
    const subSales = new Float64Array(nSub);
    const subProfit = new Float64Array(nSub);
    const total: Agg = { sales: 0, profit: 0 };
    for (let j = 0; j < rows.length; j++) {
      const i = rows[j];
      const s = f.subcategory[i];
      subSales[s] += f.sales[i];
      subProfit[s] += f.profitCents[i] / 100;
      total.sales += f.sales[i];
      total.profit += f.profitCents[i] / 100;
    }
    const cats: CatNode[] = ds.dims.categories.map((label, key) => ({
      key,
      label,
      sales: 0,
      profit: 0,
      subs: [],
    }));
    for (let s = 0; s < nSub; s++) {
      if (subSales[s] === 0 && subProfit[s] === 0) continue;
      const cat = cats[ds.dims.subToCategory[s]];
      cat.subs.push({ key: s, label: ds.dims.subcategories[s].name, sales: subSales[s], profit: subProfit[s] });
      cat.sales += subSales[s];
      cat.profit += subProfit[s];
    }
    const v = (a: Agg) => (metric === 'sales' ? a.sales : a.profit);
    const active = cats.filter((c) => c.subs.length > 0).sort((a, b) => v(b) - v(a));
    active.forEach((c) => c.subs.sort((a, b) => v(b) - v(a)));
    return { total, cats: active };
  }, [ds, rows, metric]);

  // On Sales the third token is share of the whole (part-to-whole); on Profit
  // it is the node's margin, the ratio that matters for a signed measure.
  const shareOf = (node: Agg, whole: number): string | null => {
    if (metric === 'sales') return whole > 0 ? pct(node.sales / whole, 0) : null;
    return node.sales > 0 ? pct(node.profit / node.sales, 0) : null;
  };

  const layout = useMemo(() => {
    if (size.width < 240 || tree.cats.length === 0) return null;

    const col = columns(size.width - 2);
    const availH = Math.max(size.height || 0, 260);

    // Room for each level's label, derived from the actual column widths so the
    // text is truncated to what fits rather than to a fixed guess.
    const catChars = Math.max(8, Math.floor((col.subX - col.catX - 14) / 6.2));
    const subChars = Math.max(8, Math.floor((col.W - col.subX - 8) / 6.2));

    // Row height fills the vertical space: divide it by the rows the current
    // expansion shows, clamped so it is never cramped nor absurdly airy.
    const openCat = expandedCat !== null ? tree.cats.find((c) => c.key === expandedCat) ?? null : null;
    const rowEstimate = Math.max(1, tree.cats.length + (openCat ? openCat.subs.length : 0));
    const vMargin = TOP + 2 * BAR_H + 12;
    const rowH = Math.max(MIN_ROW_H, Math.min(MAX_ROW_H, (availH - vMargin) / rowEstimate));

    const nodes: Placed[] = [];

    // Sales bars read as share of the whole: the category track is the grand
    // total, so a bar's length is literally its slice of it. Profit bars are
    // scaled to the biggest magnitude, since a signed share is meaningless.
    const catDomain =
      metric === 'sales'
        ? Math.max(1, tree.total.sales)
        : Math.max(1, ...tree.cats.map((c) => Math.abs(c.profit)));
    const wCat = scaleLinear().domain([0, catDomain]).range([0, col.catW]);

    const catY = new Map<number, number>();
    let y = TOP + BAR_H;
    tree.cats.forEach((c) => {
      catY.set(c.key, y);
      y += rowH;
      if (openCat && c.key === openCat.key) {
        y += openCat.subs.length * rowH + 8; // reserve the subs' band
      }
    });

    tree.cats.forEach((c) => {
      const val = metricVal(c);
      const barLen = Math.max(2, wCat(Math.abs(val)));
      nodes.push({
        key: c.key,
        kind: 'category',
        label: c.label,
        labelChars: catChars,
        x0: col.catX,
        x1: col.catX + barLen,
        y: catY.get(c.key)!,
        value: val,
        sales: c.sales,
        profit: c.profit,
        share: shareOf(c, tree.total.sales),
        colour: nodeColour(metric, val, palette[c.key % palette.length], 1),
        markerX: col.catX + col.catW + 6,
        expanded: expandedCat === c.key,
        parent: 'root',
      });
    });

    // Subcategories of the open category: their track is the category total, so
    // each bar is its share *of the category* — the decomposition, one level in.
    if (openCat) {
      const subDomain =
        metric === 'sales'
          ? Math.max(1, openCat.sales)
          : Math.max(1, ...openCat.subs.map((s) => Math.abs(s.profit)));
      const wSub = scaleLinear().domain([0, subDomain]).range([0, col.subW]);
      let sy = catY.get(openCat.key)! + rowH;
      openCat.subs.forEach((s) => {
        const val = metricVal(s);
        nodes.push({
          key: s.key,
          kind: 'subcategory',
          label: s.label,
          labelChars: subChars,
          x0: col.subX,
          x1: col.subX + Math.max(2, wSub(Math.abs(val))),
          y: sy,
          value: val,
          sales: s.sales,
          profit: s.profit,
          share: shareOf(s, openCat.sales),
          colour: nodeColour(metric, val, palette[openCat.key % palette.length], 0.5),
          markerX: null,
          expanded: false,
          parent: openCat.key,
        });
        sy += rowH;
      });
    }

    const catYs = [...catY.values()];
    const rootY = catYs.length ? (Math.min(...catYs) + Math.max(...catYs)) / 2 : TOP + BAR_H;
    nodes.push({
      key: -1,
      kind: 'root',
      label: 'All categories',
      labelChars: 20,
      x0: col.rootX,
      x1: col.rootX + col.rootW,
      y: rootY,
      value: metricVal(tree.total),
      sales: tree.total.sales,
      profit: tree.total.profit,
      share: metric === 'sales' ? pct(1, 0) : shareOf(tree.total, tree.total.sales),
      colour: 'var(--c-accent)',
      markerX: null,
      expanded: false,
      parent: null,
    });

    const byId = (kind: Placed['kind'], key: number) =>
      nodes.find((n) => n.kind === kind && n.key === key);
    const links = nodes
      .filter((n) => n.parent !== null)
      .map((n) => {
        const parent = n.parent === 'root' ? byId('root', -1) : byId('category', n.parent as number);
        return parent ? { from: parent, to: n, colour: n.colour } : null;
      })
      .filter((l): l is { from: Placed; to: Placed; colour: string } => l !== null);

    // Centre the drawn block when it is shorter than the space; let it grow and
    // scroll when an expanded category needs more than the height.
    const contentBottom = y + BAR_H + 10;
    const svgH = Math.max(availH, contentBottom);
    const offsetY = Math.max(0, (svgH - contentBottom) / 2);
    return { nodes, links, svgW: col.W, svgH, offsetY };
  }, [size.width, size.height, tree, expandedCat, metric, palette]);

  if (tree.cats.length === 0) {
    return (
      <div ref={ref} style={{ minHeight: height }}>
        <EmptyState
          icon={GitBranch}
          title="No hierarchy to decompose"
          message="The current filter selects no order lines."
        />
      </div>
    );
  }

  const isSelected = (n: Placed) =>
    n.kind === 'category'
      ? selectedCategories.includes(n.key)
      : n.kind === 'subcategory'
        ? selectedSubcategories.includes(n.key)
        : false;

  const tipFor = (n: Placed) => {
    const m = n.sales > 0 ? n.profit / n.sales : null;
    const shareRow =
      metric === 'sales' && n.kind !== 'root'
        ? [
            {
              label: n.kind === 'category' ? 'Share of total' : 'Share of category',
              value: n.share ?? '—',
            },
          ]
        : [];
    return {
      title: n.label,
      subtitle:
        n.kind === 'root'
          ? 'Everything in view'
          : n.kind === 'category'
            ? 'Category'
            : `Subcategory of ${ds.dims.categories[ds.dims.subToCategory[n.key]]}`,
      rows: [
        { label: 'Sales', value: usdShort(n.sales), strong: metric === 'sales' },
        {
          label: 'Profit',
          value: usdShort(n.profit),
          strong: metric === 'profit',
          tone: n.profit < 0 ? ('neg' as const) : ('pos' as const),
        },
        { label: 'Margin', value: pct(m) },
        ...shareRow,
      ],
      status: {
        level:
          m !== null && m >= BUSINESS_TARGETS.profitMargin
            ? ('on-target' as const)
            : n.profit >= 0
              ? ('at-risk' as const)
              : ('off-target' as const),
        label:
          n.profit < 0
            ? 'Loss-making'
            : m !== null && m >= BUSINESS_TARGETS.profitMargin
              ? `Clears the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`
              : `Under the ${pct(BUSINESS_TARGETS.profitMargin, 0)} target`,
      },
      hint:
        n.kind === 'category'
          ? n.expanded
            ? 'Double-click to collapse'
            : 'Click to expand · filters the page'
          : n.kind === 'subcategory'
            ? 'Click to filter · double-click to clear'
            : undefined,
    };
  };

  const onNodeClick = (n: Placed) => {
    if (n.kind === 'category') {
      setExpandedCat(n.key);
      onFocusCategory(n.key);
    } else if (n.kind === 'subcategory') {
      onFocusSubcategory(n.key);
    }
  };

  const onNodeDouble = (n: Placed) => {
    if (n.kind === 'category') {
      setExpandedCat(null);
      onResetCategory();
      onResetSubcategory();
    } else if (n.kind === 'subcategory') {
      onResetSubcategory();
    }
  };

  return (
    <div className="dtree" style={{ minHeight: height }}>
      <div ref={ref} className="dtree__scroll">
        {layout ? (
          <svg
            width={layout.svgW}
            height={layout.svgH}
            role="img"
            aria-label={`Decomposition tree of ${metric} by category and subcategory`}
          >
            <g transform={`translate(0,${layout.offsetY})`}>
              {layout.links.map((l, i) => (
                <path
                  key={`l${i}`}
                  className="dtree__link"
                  d={linkPath(l.from.x1, l.from.y, l.to.x0, l.to.y)}
                  stroke={l.colour}
                />
              ))}

              {layout.nodes.map((n) => {
                const sel = isSelected(n);
                return (
                  <g
                    key={`${n.kind}-${n.key}`}
                    className="dtree__node"
                    onPointerEnter={(e) => show(tipFor(n), e)}
                    onPointerMove={(e) => show(tipFor(n), e)}
                    onPointerLeave={hide}
                    onClick={() => onNodeClick(n)}
                    onDoubleClick={() => onNodeDouble(n)}
                  >
                    <text x={n.x0} y={n.y - BAR_H / 2 - 4} className="dtree__label">
                      <title>{n.label}</title>
                      {truncate(n.label, n.labelChars)}
                      <tspan className="dtree__value" dx={6}>
                        {usdShort(n.value)}
                      </tspan>
                      {n.share ? (
                        <tspan className="dtree__share" dx={5}>
                          {n.share}
                        </tspan>
                      ) : null}
                    </text>
                    <rect
                      x={n.x0}
                      y={n.y - BAR_H / 2}
                      width={Math.max(2, n.x1 - n.x0)}
                      height={BAR_H}
                      rx={3}
                      fill={n.colour}
                      stroke={sel ? 'var(--c-ink)' : 'none'}
                      strokeWidth={sel ? 2 : 0}
                    />
                    {n.markerX !== null ? (
                      <text
                        x={n.markerX}
                        y={n.y}
                        dy="0.32em"
                        className={`dtree__expand ${n.expanded ? 'dtree__expand--on' : ''}`}
                      >
                        {n.expanded ? '−' : '+'}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}
      </div>
      <ChartTooltip model={model} position={position} />
    </div>
  );
}

function linkPath(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0}C${mx},${y0},${mx},${y1},${x1},${y1}`;
}

function nodeColour(metric: TreeMetric, value: number, base: string, mix: number): string {
  if (metric === 'profit') return value < 0 ? 'var(--c-neg)' : 'var(--c-pos)';
  if (mix >= 1) return base;
  return `color-mix(in srgb, ${base} ${Math.round(mix * 100)}%, var(--c-surface))`;
}
