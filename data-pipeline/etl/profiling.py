"""Profiling layer — summary statistics and distributions.

Produces two things from the Gold fact: PNG figures (portfolio artifacts under
reports/figures) and a compact JSON description of the same distributions so the
dashboard can redraw them natively as SVG. The numbers are the point; the charts
just make them legible.
"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from . import config  # noqa: E402

ACCENT = "#6c4be8"
POS = "#1f9d70"
NEG = "#d24d78"
INK = "#4b4763"


def _stats(series: pd.Series) -> dict:
    q = series.quantile([0.25, 0.5, 0.75])
    return {
        "count": int(series.count()),
        "mean": round(float(series.mean()), 2),
        "std": round(float(series.std()), 2),
        "min": round(float(series.min()), 2),
        "p25": round(float(q.loc[0.25]), 2),
        "median": round(float(q.loc[0.5]), 2),
        "p75": round(float(q.loc[0.75]), 2),
        "max": round(float(series.max()), 2),
    }


def _save(fig, name: str) -> None:
    config.FIGURES.mkdir(parents=True, exist_ok=True)
    fig.savefig(config.FIGURES / f"{name}.png", dpi=120, bbox_inches="tight",
                facecolor="white")
    plt.close(fig)


def run(gold_out: dict) -> dict:
    fact: pd.DataFrame = gold_out["fact_sales"]
    dim_date: pd.DataFrame = gold_out["tables"]["dim_date"]

    summary = {m: _stats(fact[m]) for m in ["sales", "profit", "discount", "quantity", "base_margin"]}
    histograms: list[dict] = []

    # 1. Sales distribution (numeric histogram).
    counts, edges = np.histogram(fact["sales"], bins=30)
    _hist_png("sales_distribution", "Sales per order line ($)", fact["sales"], ACCENT, bins=30)
    histograms.append({"id": "sales", "title": "Sales per order line",
                       "kind": "hist", "unit": "$", "edges": [round(float(e)) for e in edges],
                       "counts": [int(c) for c in counts]})

    # 2. Profit distribution (diverging around zero).
    counts, edges = np.histogram(fact["profit"], bins=30)
    colors = [NEG if (edges[i] + edges[i + 1]) / 2 < 0 else POS for i in range(len(counts))]
    fig, ax = _fig()
    ax.bar(edges[:-1], counts, width=np.diff(edges), align="edge", color=colors)
    ax.axvline(0, color=INK, lw=1)
    _style(ax, "Profit per order line ($)", "order lines")
    _save(fig, "profit_distribution")
    histograms.append({"id": "profit", "title": "Profit per order line",
                       "kind": "hist", "unit": "$", "diverging": True,
                       "edges": [round(float(e)) for e in edges],
                       "counts": [int(c) for c in counts]})

    # 3. Discount levels (categorical — the distinct rates).
    disc = (fact["discount"] * 100).round(1).value_counts().sort_index()
    _bar_png("discount_levels", "Discount level (%)", disc.index.astype(str), disc.values, ACCENT)
    histograms.append({"id": "discount", "title": "Discount levels", "kind": "bar",
                       "unit": "%", "labels": [f"{x:g}" for x in disc.index],
                       "counts": [int(c) for c in disc.values]})

    # 4. Base-margin tiers (the four recovered margins).
    bm = (fact["base_margin"] * 100).round(1).value_counts().sort_index()
    _bar_png("base_margin_tiers", "Base-margin tier (%)", bm.index.astype(str), bm.values, POS)
    histograms.append({"id": "base_margin", "title": "Base-margin tiers", "kind": "bar",
                       "unit": "%", "labels": [f"{x:g}" for x in bm.index],
                       "counts": [int(c) for c in bm.values]})

    # 5. Quantity per line.
    qty = fact["quantity"].value_counts().sort_index()
    _bar_png("quantity_per_line", "Quantity per order line", qty.index.astype(str), qty.values, ACCENT)
    histograms.append({"id": "quantity", "title": "Quantity per line", "kind": "bar",
                       "unit": "", "labels": [str(x) for x in qty.index],
                       "counts": [int(c) for c in qty.values]})

    # 6. Sales by year.
    by_year = (
        fact.merge(dim_date[["date_key", "year"]], on="date_key")
        .groupby("year")["sales"].sum().sort_index()
    )
    _bar_png("sales_by_year", "Sales by year ($)", by_year.index.astype(str),
             by_year.values, ACCENT, money=True)
    histograms.append({"id": "sales_by_year", "title": "Sales by year", "kind": "bar",
                       "unit": "$", "labels": [str(int(y)) for y in by_year.index],
                       "counts": [round(float(v)) for v in by_year.values]})

    # 7. Order lines per customer (long-tail check).
    lines = fact.groupby("customer_key").size()
    counts, edges = np.histogram(lines, bins=range(1, int(lines.max()) + 2))
    _hist_png("lines_per_customer", "Order lines per customer", lines, ACCENT,
              bins=range(1, int(lines.max()) + 2))
    histograms.append({"id": "lines_per_customer", "title": "Order lines per customer",
                       "kind": "hist", "unit": "",
                       "edges": [int(e) for e in edges], "counts": [int(c) for c in counts]})

    return {
        "summary": summary,
        "histograms": histograms,
        "figures": sorted(p.name for p in config.FIGURES.glob("*.png")),
    }


# --- small matplotlib helpers ---

def _fig():
    fig, ax = plt.subplots(figsize=(5.2, 3.0))
    return fig, ax


def _style(ax, xlabel: str, ylabel: str) -> None:
    ax.set_xlabel(xlabel, fontsize=9, color=INK)
    ax.set_ylabel(ylabel, fontsize=9, color=INK)
    ax.tick_params(labelsize=8, colors=INK)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.grid(axis="y", color="#eee", lw=0.8)
    ax.set_axisbelow(True)


def _hist_png(name, xlabel, series, color, bins) -> None:
    fig, ax = _fig()
    ax.hist(series, bins=bins, color=color, edgecolor="white", linewidth=0.4)
    _style(ax, xlabel, "order lines")
    _save(fig, name)


def _bar_png(name, xlabel, labels, values, color, money=False) -> None:
    fig, ax = _fig()
    ax.bar([str(x) for x in labels], values, color=color)
    _style(ax, xlabel, "count" if not money else "sales ($)")
    if len(labels) > 8:
        ax.tick_params(axis="x", rotation=45)
    _save(fig, name)
