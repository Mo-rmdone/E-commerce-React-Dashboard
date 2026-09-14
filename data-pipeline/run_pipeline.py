"""Run the full Medallion pipeline: Bronze -> Silver -> Gold -> QA -> Profile.

Outputs
-------
- data/bronze|silver|gold/*        parquet (+ csv for Gold) layers
- data/gold/app_rows.json          the clean flat table the dashboard is built from
- reports/pipeline_report.json     ETL steps, star model, DQ results, profiling
- reports/figures/*.png            distribution charts

The pipeline is the single source of truth: the React app's packer reads
data/gold/app_rows.json, not the raw workbook.
"""
from __future__ import annotations

import json
import sys
import time

from etl import bronze, gold, profiling, quality, silver
from etl import config


LIMITATIONS = [
    {"id": "no-cost", "label": "No cost or COGS field exists",
     "detail": "Profit is supplied directly and resolves exactly to "
               "Sales x (BaseMargin - Discount) on every row, where BaseMargin is one "
               "of four tiers assigned per order line. Discount is the only lever on "
               "margin, and no cost-driven metric is offered."},
    {"id": "line-level-margin", "label": "Base margin is an order-line attribute",
     "detail": "Eight of the seventeen subcategories price at a single margin tier; "
               "the rest mix two, with no dimension explaining the split. Breakeven "
               "discount is exact per line; a subcategory-level breakeven is a "
               "revenue-weighted average and is labelled as such."},
    {"id": "no-sku", "label": "No SKU level exists",
     "detail": "The workbook stops at Product, so the hierarchy drills "
               "Category -> Subcategory -> Product with no SKU tier."},
    {"id": "line-level-category", "label": "Category is an order-line attribute",
     "detail": "Some products are recorded across multiple subcategories, so a product "
               "has no single category. Category and Subcategory are aggregated from "
               "order lines rather than attached to the product."},
    {"id": "no-sub-segment", "label": "No sub-segment field exists",
     "detail": "Segment has exactly 3 values and no child column, so the segment "
               "drill descends Segment -> Market -> Country -> Customer instead."},
    {"id": "gross-sales", "label": "Sales is a gross, pre-discount figure",
     "detail": "Sales equals Quantity x unit price, with the discount applied to "
               "Profit only. Every KPI states the revenue basis it uses."},
    {"id": "weekday", "label": "Weekday analysis is not offered",
     "detail": "Order dates were synthesised and the weekday distribution is "
               "degenerate, so year/quarter/month are used and day-of-week is not."},
]


def etl_steps(bronze_out, silver_out, gold_out) -> list[dict]:
    return [
        {"layer": "Bronze", "title": "Land the raw workbook",
         "detail": "Read the `data` sheet verbatim and persist it as parquet — an "
                   "immutable snapshot every later stage is reproducible from.",
         "rows_in": bronze_out["rows_read"], "rows_out": bronze_out["rows_read"],
         "output": "data/bronze/orders_raw.parquet"},
        {"layer": "Silver", "title": "Clean & conform",
         "detail": "Coerce types, drop unparseable rows, round discount noise to 4dp, "
                   "de-duplicate byte-identical lines, canonicalise US customer IDs, "
                   "reassign Sudan's region and fold the product casing. Profit is left "
                   "untouched so the margin formula still holds.",
         "rows_in": bronze_out["rows_read"], "rows_out": silver_out["rows_kept"],
         "output": "data/silver/orders_clean.parquet"},
        {"layer": "Gold", "title": "Star schema",
         "detail": "Build conformed dimensions with surrogate keys and a one-line-grain "
                   "fact; emit the flat clean table the dashboard is built from.",
         "rows_in": silver_out["rows_kept"], "rows_out": gold_out["row_counts"]["fact_sales"],
         "output": "data/gold/*.parquet + app_rows.json"},
    ]


def main() -> int:
    t0 = time.time()
    print("[pipeline] Bronze — landing raw workbook …")
    bronze_out = bronze.run()
    print(f"[pipeline]   {bronze_out['rows_read']:,} rows from {bronze_out['source']}")

    print("[pipeline] Silver — cleaning & conforming …")
    silver_out = silver.run(bronze_out)
    print(f"[pipeline]   {silver_out['rows_kept']:,} rows kept "
          f"(-{silver_out['dropped_invalid']} invalid, -{silver_out['dropped_duplicates']} dup)")

    print("[pipeline] Gold — building star schema …")
    gold_out = gold.run(silver_out)
    for name, n in gold_out["row_counts"].items():
        print(f"[pipeline]   {name}: {n:,}")

    print("[pipeline] Quality — reconciliation & integrity …")
    qa = quality.run(bronze_out, silver_out, gold_out)
    for c in qa["checks"]:
        print(f"[pipeline]   [{'OK' if c['passed'] else 'FAIL'}] {c['name']}")

    print("[pipeline] Profiling — summary & histograms …")
    prof = profiling.run(gold_out)

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": bronze_out["source"],
        "sheets": bronze_out["sheets"],
        "rowsRead": bronze_out["rows_read"],
        "rowsKept": silver_out["rows_kept"],
        "corrections": silver_out["corrections"],
        "limitations": LIMITATIONS,
        "fieldNotes": bronze_out["field_notes"],
        "etl": etl_steps(bronze_out, silver_out, gold_out),
        "dataModel": gold_out["data_model"],
        "quality": qa,
        "profiling": prof,
        "lineage": ["Excel workbook", "Bronze (raw parquet)", "Silver (cleaned parquet)",
                    "Gold (star schema)", "app_rows.json", "dashboard dataset.json"],
    }

    config.REPORTS.mkdir(parents=True, exist_ok=True)
    with open(config.REPORTS / "pipeline_report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    dt = time.time() - t0
    status = "PASSED" if qa["passed"] else "FAILED"
    print(f"[pipeline] done in {dt:.1f}s — quality {status}")
    print(f"[pipeline] report -> reports/pipeline_report.json")
    return 0 if qa["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
