"""Bronze layer — land the workbook exactly as supplied.

No cleaning happens here. The raw sheet is persisted verbatim as parquet so
every later stage is reproducible from an immutable snapshot, and the field
dictionary is captured for the data notes.
"""
from __future__ import annotations

import pandas as pd

from . import config


def run() -> dict:
    """Read the workbook and persist the raw `data` sheet to Bronze."""
    workbook = config.find_workbook()
    xls = pd.ExcelFile(workbook, engine="openpyxl")

    if config.DATA_SHEET not in xls.sheet_names:
        raise ValueError(
            f"Expected a sheet named '{config.DATA_SHEET}'; found {xls.sheet_names}"
        )

    raw = xls.parse(config.DATA_SHEET)

    missing = [c for c in config.COLUMNS.values() if c not in raw.columns]
    if missing:
        raise ValueError(f"Workbook is missing expected columns: {missing}")

    # Field dictionary (optional sheet) -> {field: description}
    field_notes: dict[str, str] = {}
    if config.DICT_SHEET in xls.sheet_names:
        dic = xls.parse(config.DICT_SHEET, header=None)
        for _, row in dic.iterrows():
            a, b = row.iloc[0], row.iloc[1] if len(row) > 1 else None
            if isinstance(a, str) and isinstance(b, str) and a.strip().lower() != "field":
                field_notes[a.strip()] = b.strip()

    config.BRONZE.mkdir(parents=True, exist_ok=True)
    raw.to_parquet(config.BRONZE / "orders_raw.parquet", index=False)

    return {
        "source": workbook.name,
        "sheets": list(xls.sheet_names),
        "rows_read": int(len(raw)),
        "columns": list(raw.columns),
        "field_notes": field_notes,
        "raw": raw,
    }
