"""Silver layer — clean and conform the raw orders.

Applies exactly the corrections documented in the data audit (DQ-*), each one
counted so the dashboard's data-integrity panel can report it. Nothing is
invented: Profit is left untouched and still reconstructs to
Sales x (BaseMargin - Discount) on every surviving row.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

C = config.COLUMNS


def _to_iso(series: pd.Series) -> pd.Series:
    """Excel serial / Timestamp / string -> 'YYYY-MM-DD' (tz-independent)."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return series.dt.strftime("%Y-%m-%d")
    if pd.api.types.is_numeric_dtype(series):
        base = pd.Timestamp(config.EXCEL_EPOCH)
        days = pd.to_numeric(series, errors="coerce").round()
        dt = base + pd.to_timedelta(days, unit="D")
        return dt.dt.strftime("%Y-%m-%d")
    dt = pd.to_datetime(series, errors="coerce")
    return dt.dt.strftime("%Y-%m-%d")


def _num(series: pd.Series) -> pd.Series:
    """Coerce to number, stripping $ , and whitespace like the JS ETL."""
    cleaned = series.astype(str).str.replace(r"[$,\s]", "", regex=True)
    return pd.to_numeric(cleaned, errors="coerce")


def _canonical_customer(cust: pd.Series, country: pd.Series) -> tuple[pd.Series, int]:
    """DQ-04 — strip the US sub-region digit so one shopper is one customer."""
    out = cust.copy()
    collapses = 0
    is_us = country.eq("United States")
    for idx in cust.index[is_us]:
        t = cust.at[idx]
        dash = t.rfind("-")
        if dash == -1:
            continue
        tail = t[dash + 1:]
        if len(tail) == 9 and tail.isdigit():
            out.at[idx] = f"{t[:dash]}-{tail[:8]}"
            collapses += 1
    return out, collapses


def run(bronze: dict) -> dict:
    raw: pd.DataFrame = bronze["raw"]
    df = raw.copy()

    # --- type coercion ---
    date_iso = _to_iso(df[C["order_date"]])
    qty = _num(df[C["quantity"]])
    sales = _num(df[C["sales"]])
    profit = _num(df[C["profit"]])
    disc_raw = _num(df[C["discount"]])
    lat = _num(df[C["latitude"]])
    lon = _num(df[C["longitude"]])

    # DQ-00 — a row needs a date and all measures to be analysable.
    valid = (
        date_iso.notna()
        & qty.notna()
        & sales.notna()
        & profit.notna()
        & disc_raw.notna()
        & lat.notna()
        & lon.notna()
    )
    dropped_invalid = int((~valid).sum())

    work = pd.DataFrame(
        {
            "order_date": date_iso,
            "order_id": df[C["order_id"]].astype(str).str.strip(),
            "customer_id_raw": df[C["customer_id"]].astype(str).str.strip(),
            "segment": df[C["segment"]].astype(str).str.strip(),
            "city": df[C["city"]].astype(str).str.strip(),
            "state": df[C["state"]].astype(str).str.strip(),
            "country": df[C["country"]].astype(str).str.strip(),
            "latitude": lat,
            "longitude": lon,
            "region_raw": df[C["region"]].astype(str).str.strip(),
            "market": df[C["market"]].astype(str).str.strip(),
            "subcategory": df[C["subcategory"]].astype(str).str.strip(),
            "category": df[C["category"]].astype(str).str.strip(),
            "product_raw": df[C["product"]].astype(str).str.strip(),
            "quantity": qty,
            "sales": sales,
            "discount_raw": disc_raw,
            "profit": profit,
        }
    )[valid].reset_index(drop=True)

    # DQ-06 — round discount to 4dp to collapse float noise (0.15 vs 0.150000002)
    # without disturbing any genuine rate.
    work["discount"] = (work["discount_raw"] * 10000).round() / 10000
    discount_rounded = int((work["discount"].sub(work["discount_raw"]).abs() > 1e-12).sum())
    # DQ-06b — count the anomalous levels (kept as-is so Profit still holds).
    anomalous_rows = int(work["discount"].isin(config.ANOMALOUS_DISCOUNTS).sum())

    # DQ-08 — Sudan region reassignment.
    override_key = list(zip(work["country"], work["region_raw"]))
    sudan_mask = pd.Series(
        [k in config.REGION_OVERRIDES for k in override_key], index=work.index
    )
    work["region"] = work["region_raw"]
    work.loc[sudan_mask, "region"] = [
        config.REGION_OVERRIDES[k] for k in override_key if k in config.REGION_OVERRIDES
    ]
    sudan_fixes = int(sudan_mask.sum())

    # DQ-12 — product name casing fold.
    lower = work["product_raw"].str.lower()
    work["product"] = work["product_raw"]
    alias_mask = lower.isin(config.PRODUCT_ALIASES.keys())
    work.loc[alias_mask, "product"] = [
        config.PRODUCT_ALIASES[v] for v in lower[alias_mask]
    ]

    # DQ-07 — remove byte-identical duplicate order lines. Fingerprint mirrors
    # the JS ETL: raw customer id + aliased product + the corrected discount.
    fingerprint = (
        work["order_id"].astype(str)
        + work["order_date"].astype(str)
        + work["customer_id_raw"].astype(str)
        + work["product"].astype(str)
        + work["subcategory"].astype(str)
        + work["quantity"].astype(str)
        + work["sales"].astype(str)
        + work["discount"].astype(str)
        + work["profit"].astype(str)
    )
    dup_mask = fingerprint.duplicated(keep="first")
    dropped_duplicates = int(dup_mask.sum())
    work = work[~dup_mask].reset_index(drop=True)

    # DQ-04 — canonical US customer id (after dedup, like the JS ETL).
    work["customer_id"], us_id_collapses = _canonical_customer(
        work["customer_id_raw"], work["country"]
    )

    # Recovered base margin: Profit = Sales x (BaseMargin - Discount).
    work["base_margin"] = (work["profit"] / work["sales"] + work["discount"]).round(4)

    silver = work[
        [
            "order_date", "order_id", "customer_id", "segment",
            "city", "state", "country", "latitude", "longitude", "region", "market",
            "category", "subcategory", "product",
            "quantity", "sales", "discount", "base_margin", "profit",
        ]
    ].copy()
    silver["quantity"] = silver["quantity"].astype(int)

    config.SILVER.mkdir(parents=True, exist_ok=True)
    silver.to_parquet(config.SILVER / "orders_clean.parquet", index=False)

    corrections = [
        _c("DQ-06", "Discount float noise collapsed",
           "Floating-point noise stored 0.15 as two distinct values (0.15 and "
           "0.15000000000000002), splitting one discount level into two in every "
           "slicer. Values are rounded to 4dp, which removes the noise without "
           "disturbing any real rate.", discount_rounded),
        _c("DQ-06b", "Anomalous discount levels flagged, not altered",
           "Four levels (0.2%, 20.2%, 40.2%, 60.2%) look like a clean rate plus "
           "0.002 and appear only on the 10% margin tier. They are left exactly "
           "as supplied — rewriting them would break the Profit reconstruction "
           "— and surfaced as a data note.", anomalous_rows),
        _c("DQ-04", "US customer IDs de-duplicated",
           "US customer numbers carry a 9th digit encoding the US sub-region "
           "rather than the customer, inflating the US customer count roughly "
           "3.2x. The trailing digit is stripped so one shopper is one customer.",
           us_id_collapses),
        _c("DQ-08", "Sudan region reassigned",
           "Sudan appeared under both North Africa and Eastern Africa. The "
           "outlying rows were folded into North Africa, its dominant region.",
           sudan_fixes),
        _c("DQ-07", "Exact duplicate rows removed",
           "Order lines that were byte-for-byte duplicates of an existing line "
           "would have double-counted their sales and profit.", dropped_duplicates),
        _c("DQ-12", "Product name casing folded",
           '"REN Clean Skincare Moroccan Rose Otto Bath Oil" also appeared as '
           '"Ren …", counting one product as two.', len(config.PRODUCT_ALIASES)),
    ]
    if dropped_invalid:
        corrections.append(_c(
            "DQ-00", "Unparseable rows excluded",
            "Rows missing a date or any of quantity, sales, discount or profit "
            "cannot be analysed.", dropped_invalid))

    return {
        "silver": silver,
        "rows_kept": int(len(silver)),
        "dropped_invalid": dropped_invalid,
        "dropped_duplicates": dropped_duplicates,
        "corrections": corrections,
        "metrics": {
            "discount_rounded": discount_rounded,
            "anomalous_discount_rows": anomalous_rows,
            "us_id_collapses": us_id_collapses,
            "sudan_fixes": sudan_fixes,
        },
    }


def _c(cid: str, label: str, detail: str, rows: int) -> dict:
    return {"id": cid, "label": label, "detail": detail, "rows": int(rows)}
