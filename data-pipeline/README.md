# Data pipeline — Medallion ETL + star schema

A small, production-shaped **pandas** pipeline that turns the raw
*Global Skincare & Beauty e-store* workbook into a clean **Kimball star schema**,
with an automated data-quality gate and a profiling pass. It is the **single
source of truth** for the dashboard: the React app is built from the Gold layer,
not from the Excel file.

```
Excel workbook
   │
   ▼  Bronze   land the sheet verbatim → parquet (immutable snapshot)
   ▼  Silver   clean & conform (DQ-* corrections) → parquet
   ▼  Gold     conformed dimensions + one-line-grain fact → parquet + CSV
   ▼  Quality  reconciliation & integrity checks (build gate)
   ▼  Profile  summary stats + histograms
   │
   ▼  app_rows.json → dashboard packer → public/data/dataset.json
```

## Run it

```bash
pip install -r requirements.txt
python run_pipeline.py            # writes data/ and reports/
# then rebuild the dashboard dataset from Gold:
cd .. && npm run etl              # node scripts/build-dataset.mjs
```

## Layers

| Layer | Output | What happens |
| :--- | :--- | :--- |
| **Bronze** | `data/bronze/orders_raw.parquet` | The `data` sheet, untouched. Reproducible from an immutable snapshot. |
| **Silver** | `data/silver/orders_clean.parquet` | Type coercion + the documented corrections (below). Profit is left untouched so the margin formula still holds. |
| **Gold** | `data/gold/*.parquet` + `*.csv` | Star schema: `fact_sales` + 7 dimensions, surrogate keys, plus `app_rows.json` for the dashboard. |

## Star schema

`fact_sales` at **one order line** grain, with conformed dimensions:

- `dim_date`, `dim_customer`, `dim_segment`, `dim_product`,
  `dim_subcategory` (carries Category), `dim_category`, `dim_geography`
- `order_id` is a **degenerate dimension** on the fact.
- Measures: `quantity`, `sales`, `discount`, `base_margin`, `profit`.

## Corrections (Silver)

Each is counted and surfaced in the dashboard's *Data notes → Integrity* tab.

| ID | Correction |
| :--- | :--- |
| DQ-00 | Drop rows missing a date or any measure |
| DQ-04 | De-duplicate US customer IDs (strip the sub-region digit) — ~9,992 rows |
| DQ-06 | Round discount to 4dp to collapse float noise |
| DQ-06b | Flag (not alter) the four anomalous discount levels |
| DQ-07 | Remove byte-identical duplicate order lines |
| DQ-08 | Reassign Sudan's region to its dominant one |
| DQ-12 | Fold a product's two casings into one identity |

## Quality gate

The build fails unless all pass (see `reports/pipeline_report.json`):

1. Totals reconcile Silver → Gold
2. `Profit = Sales × (BaseMargin − Discount)` is exact on every row
3. Dates match the Order-ID serial + 2,922 days (timezone-safe check)
4. Referential integrity (fact → all 6 dimension keys)
5. Dimension surrogate keys are unique

**Reconciled totals:** 51,290 rows → 51,288 kept · **$6,517,641** sales ·
**$1,065,426** profit · **16.3%** blended margin.

## Outputs

- `data/{bronze,silver,gold}/` — the parquet layers (git-ignored; regeneratable)
- `reports/pipeline_report.json` — ETL steps, star model, DQ results, profiling
- `reports/figures/*.png` — distribution charts

*Built to showcase BI + Data Engineering practice: Medallion architecture,
dimensional modelling, data-quality testing, and a pipeline wired end-to-end to
a live dashboard.*
