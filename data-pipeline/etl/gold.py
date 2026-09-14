"""Gold layer — a Kimball star schema plus the flat table the app consumes.

Grain of the fact is one order line. Dimensions are conformed with surrogate
keys; the category hierarchy is carried on the subcategory dimension
(Subcategory -> Category is the one clean hierarchy edge in the workbook), and
the order number is kept as a degenerate dimension on the fact.
"""
from __future__ import annotations

import json

import pandas as pd

from . import config


def _dim(frame: pd.DataFrame, keys: list[str], key_name: str) -> pd.DataFrame:
    """Distinct rows on `keys`, assigned a 1-based surrogate key."""
    dim = frame[keys].drop_duplicates().sort_values(keys).reset_index(drop=True)
    dim.insert(0, key_name, dim.index + 1)
    return dim


def run(silver_out: dict) -> dict:
    s: pd.DataFrame = silver_out["silver"].copy()

    # --- dimensions ---
    dim_date = _dim(s, ["order_date"], "date_key")
    d = pd.to_datetime(dim_date["order_date"])
    dim_date["year"] = d.dt.year
    dim_date["quarter"] = d.dt.quarter
    dim_date["month"] = d.dt.month
    dim_date["month_name"] = d.dt.strftime("%b")
    dim_date["day"] = d.dt.day

    dim_customer = _dim(s, ["customer_id"], "customer_key")
    dim_segment = _dim(s, ["segment"], "segment_key")
    dim_product = _dim(s, ["product"], "product_key")
    # unit price is Sales / Quantity at first appearance, like the app.
    first_price = (
        s.assign(unit_price=(s["sales"] / s["quantity"]).round(2))
        .drop_duplicates("product")
        .set_index("product")["unit_price"]
    )
    dim_product["unit_price"] = dim_product["product"].map(first_price)

    dim_subcategory = _dim(s, ["subcategory", "category"], "subcategory_key")
    dim_category = _dim(s, ["category"], "category_key")

    geo_keys = ["city", "state", "country", "region", "market", "latitude", "longitude"]
    dim_geography = _dim(s, geo_keys, "geography_key")

    # --- fact: attach surrogate keys ---
    fact = s.copy()
    fact = fact.merge(dim_date[["date_key", "order_date"]], on="order_date")
    fact = fact.merge(dim_customer, on="customer_id")
    fact = fact.merge(dim_segment, on="segment")
    fact = fact.merge(dim_product[["product_key", "product"]], on="product")
    fact = fact.merge(dim_subcategory, on=["subcategory", "category"])
    fact = fact.merge(dim_geography, on=geo_keys)

    fact_sales = fact[
        [
            "date_key", "customer_key", "segment_key", "product_key",
            "subcategory_key", "geography_key",
            "order_id",  # degenerate dimension
            "quantity", "sales", "discount", "base_margin", "profit",
        ]
    ].copy()
    fact_sales.insert(0, "sales_key", range(1, len(fact_sales) + 1))

    # --- persist star schema ---
    config.GOLD.mkdir(parents=True, exist_ok=True)
    tables = {
        "fact_sales": fact_sales,
        "dim_date": dim_date,
        "dim_customer": dim_customer,
        "dim_segment": dim_segment,
        "dim_product": dim_product,
        "dim_subcategory": dim_subcategory,
        "dim_category": dim_category,
        "dim_geography": dim_geography,
    }
    for name, tbl in tables.items():
        tbl.to_parquet(config.GOLD / f"{name}.parquet", index=False)
        tbl.to_csv(config.GOLD / f"{name}.csv", index=False)

    # --- flat table for the dashboard's packer (single source of truth) ---
    app_rows = s.rename(columns={"latitude": "lat", "longitude": "lon"})[
        [
            "order_date", "order_id", "customer_id", "segment", "city", "state",
            "country", "lat", "lon", "region", "market", "subcategory", "category",
            "product", "quantity", "sales", "discount", "profit",
        ]
    ]
    records = app_rows.to_dict(orient="records")
    with open(config.GOLD / "app_rows.json", "w", encoding="utf-8") as f:
        json.dump({"rows": records}, f, ensure_ascii=False)

    data_model = _describe_model(tables)

    return {
        "tables": tables,
        "fact_sales": fact_sales,
        "row_counts": {name: int(len(t)) for name, t in tables.items()},
        "data_model": data_model,
    }


def _describe_model(tables: dict[str, pd.DataFrame]) -> dict:
    """A serialisable star-schema description for the data-notes panel."""
    def cols(name: str) -> list[str]:
        return list(tables[name].columns)

    return {
        "grain": "one order line",
        "fact": {
            "name": "fact_sales",
            "grain": "order line",
            "measures": ["quantity", "sales", "discount", "base_margin", "profit"],
            "degenerate": ["order_id"],
            "columns": cols("fact_sales"),
            "rows": int(len(tables["fact_sales"])),
        },
        "dimensions": [
            {"name": "dim_date", "grain": "day", "columns": cols("dim_date"),
             "rows": int(len(tables["dim_date"]))},
            {"name": "dim_customer", "grain": "customer", "columns": cols("dim_customer"),
             "rows": int(len(tables["dim_customer"]))},
            {"name": "dim_segment", "grain": "segment", "columns": cols("dim_segment"),
             "rows": int(len(tables["dim_segment"]))},
            {"name": "dim_product", "grain": "product", "columns": cols("dim_product"),
             "rows": int(len(tables["dim_product"]))},
            {"name": "dim_subcategory", "grain": "subcategory",
             "columns": cols("dim_subcategory"), "rows": int(len(tables["dim_subcategory"])),
             "note": "carries Category (Subcategory -> Category hierarchy)"},
            {"name": "dim_category", "grain": "category", "columns": cols("dim_category"),
             "rows": int(len(tables["dim_category"]))},
            {"name": "dim_geography", "grain": "city / state / country",
             "columns": cols("dim_geography"), "rows": int(len(tables["dim_geography"]))},
        ],
        "relationships": [
            {"from": "fact_sales.date_key", "to": "dim_date.date_key"},
            {"from": "fact_sales.customer_key", "to": "dim_customer.customer_key"},
            {"from": "fact_sales.segment_key", "to": "dim_segment.segment_key"},
            {"from": "fact_sales.product_key", "to": "dim_product.product_key"},
            {"from": "fact_sales.subcategory_key", "to": "dim_subcategory.subcategory_key"},
            {"from": "fact_sales.geography_key", "to": "dim_geography.geography_key"},
            {"from": "dim_subcategory.category", "to": "dim_category.category"},
        ],
    }
