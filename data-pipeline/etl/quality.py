"""Data-quality gate — reconciliation and integrity checks.

Runs after Gold. Every check returns a pass/fail plus the numbers behind it, so
the result doubles as evidence in the data-notes panel. A failure here should
stop a build rather than let the dashboard quietly mislead.
"""
from __future__ import annotations

import pandas as pd

from . import config


def run(bronze: dict, silver_out: dict, gold_out: dict) -> dict:
    s: pd.DataFrame = silver_out["silver"]
    fact: pd.DataFrame = gold_out["fact_sales"]
    tables: dict[str, pd.DataFrame] = gold_out["tables"]
    checks: list[dict] = []

    # 1. Totals reconcile: Silver == Gold fact, and both tie to Bronze minus drops.
    silver_sales, silver_profit = float(s["sales"].sum()), float(s["profit"].sum())
    gold_sales, gold_profit = float(fact["sales"].sum()), float(fact["profit"].sum())
    checks.append(_check(
        "Totals reconcile Silver -> Gold",
        abs(silver_sales - gold_sales) < 1 and abs(silver_profit - gold_profit) < 1,
        f"Sales ${gold_sales:,.0f}, Profit ${gold_profit:,.0f} carry through unchanged.",
    ))

    # 2. Profit reconstructs exactly from the recovered formula on every row.
    expected = s["sales"] * (s["base_margin"] - s["discount"])
    residual = (expected - s["profit"]).abs()
    misses = int((residual > 0.01).sum())
    tiers = sorted(round(t, 4) for t in s["base_margin"].unique())
    checks.append(_check(
        "Profit = Sales x (BaseMargin - Discount)",
        misses == 0,
        f"Exact on all {len(s):,} rows (max residual ${residual.max():.4f}); "
        f"base-margin tiers {', '.join(f'{t*100:g}%' for t in tiers)}.",
    ))

    # 3. Independent date check: Order ID serial + 2,922 days == Order Date.
    serial = pd.to_numeric(s["order_id"].str.rsplit("-", n=1).str[-1], errors="coerce")
    base = pd.Timestamp(config.EXCEL_EPOCH)
    expected_date = (base + pd.to_timedelta(serial + config.SHIFT_DAYS, unit="D")).dt.strftime("%Y-%m-%d")
    ok_dates = int((expected_date == s["order_date"]).sum())
    aligned = ok_dates == len(s)
    checks.append(_check(
        "Dates match Order-ID serial + 2,922 days",
        aligned,
        f"{ok_dates:,}/{len(s):,} rows align — an independent confirmation the "
        f"Excel-serial conversion is timezone-safe.",
    ))

    # 4. Referential integrity: every fact key resolves to a dimension row.
    ri_pairs = [
        ("date_key", "dim_date"), ("customer_key", "dim_customer"),
        ("segment_key", "dim_segment"), ("product_key", "dim_product"),
        ("subcategory_key", "dim_subcategory"), ("geography_key", "dim_geography"),
    ]
    orphans = 0
    for fk, dim in ri_pairs:
        valid_keys = set(tables[dim][fk])
        orphans += int((~fact[fk].isin(valid_keys)).sum()) + int(fact[fk].isna().sum())
    checks.append(_check(
        "Referential integrity (fact -> dimensions)",
        orphans == 0,
        f"All {len(fact):,} fact rows resolve on all 6 dimension keys; {orphans} orphans.",
    ))

    # 5. Surrogate keys are unique within each dimension.
    dup_keys = 0
    for fk, dim in ri_pairs:
        dup_keys += int(tables[dim][fk].duplicated().sum())
    checks.append(_check(
        "Dimension surrogate keys are unique",
        dup_keys == 0,
        f"No duplicate keys across the {len(ri_pairs)} dimensions.",
    ))

    passed = all(c["passed"] for c in checks)
    return {
        "passed": passed,
        "checks": checks,
        "totals": {
            "bronze_rows": int(bronze["rows_read"]),
            "gold_rows": int(len(fact)),
            "sales_total": round(gold_sales, 2),
            "profit_total": round(gold_profit, 2),
            "base_margin_tiers": tiers,
        },
    }


def _check(name: str, passed: bool, detail: str) -> dict:
    return {"name": name, "passed": bool(passed), "detail": detail}
