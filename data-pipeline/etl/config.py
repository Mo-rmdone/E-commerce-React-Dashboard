"""Shared configuration for the Medallion pipeline.

Every path, column name and correction constant lives here so the Bronze,
Silver and Gold stages read from one source of truth and never disagree with
each other about what the workbook contains.
"""
from __future__ import annotations

import os
from pathlib import Path

# data-pipeline/etl/config.py -> data-pipeline/
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BRONZE = DATA / "bronze"
SILVER = DATA / "silver"
GOLD = DATA / "gold"
REPORTS = ROOT / "reports"
FIGURES = REPORTS / "figures"

WORKBOOK_NAME = "Global skincare and Beauty e-store_E-commerce Analysis_English.xlsx"
DATA_SHEET = "data"
DICT_SHEET = "dictionary"


def find_workbook() -> Path:
    """Locate the source workbook, mirroring the JS ETL's search order."""
    env = os.environ.get("WORKBOOK_PATH")
    if env:
        return Path(env)
    candidates = [
        ROOT.parent / "data" / WORKBOOK_NAME,   # prism-analytics/data
        ROOT.parent.parent / WORKBOOK_NAME,     # repo parent (English-Dataset)
        ROOT.parent / WORKBOOK_NAME,            # prism-analytics
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        f"Workbook '{WORKBOOK_NAME}' not found. Set WORKBOOK_PATH or place it in "
        f"one of: {[str(c) for c in candidates]}"
    )


# Workbook column names — read from the file, never assumed; verified present.
COLUMNS = {
    "row_id": "Row ID",
    "order_id": "Order ID",
    "order_date": "Order Date",
    "customer_id": "Customer ID",
    "segment": "Segment",
    "city": "City",
    "state": "State",
    "country": "Country",
    "latitude": "Country latitude",
    "longitude": "Country longitude",
    "region": "Region",
    "market": "Market",
    "subcategory": "Subcategory",
    "category": "Category",
    "product": "Product",
    "quantity": "Quantity",
    "sales": "Sales",
    "discount": "Discount",
    "profit": "Profit",
}

# --- correction constants (documented as DQ-* in the data audit) ---

# DQ-12: one product exists under two casings; fold to a single identity.
PRODUCT_ALIASES = {
    "ren clean skincare moroccan rose otto bath oil":
        "REN Clean Skincare Moroccan Rose Otto Bath Oil",
}

# DQ-08: Sudan is assigned to two regions; the (country, region) outlier is
# folded into the country's dominant region.
REGION_OVERRIDES = {("Sudan", "Eastern Africa"): "North Africa"}

# DQ-06b: four discount levels look like a clean rate + 0.002. Left untouched so
# Profit still reconstructs exactly; flagged, not altered.
ANOMALOUS_DISCOUNTS = {0.002, 0.202, 0.402, 0.602}

# Order IDs end in the Excel serial of the original (pre-shift) order date, and
# every Order Date is that serial + 2,922 days — an independent date check.
SHIFT_DAYS = 2922
# Excel's 1900 date system, anchored at 1899-12-30 to absorb the leap-year bug.
EXCEL_EPOCH = "1899-12-30"
