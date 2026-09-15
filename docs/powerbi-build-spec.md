# Power BI build spec — Prism Commercial Intelligence

The semantic model is finished. This sheet covers the canvas: which visual, which
fields, which formatting, page by page. Nothing here needs a decision re-made —
if a number looks wrong while you build, check it against the reconciliation
table at the bottom before changing anything.

---

## Model reference

**Tables** — `Sales` (fact) plus `Dates`, `Customer`, `Product`, `Subcategory`,
`Category`, `Segment`, `Geography`. Star schema, single-direction filters,
`Dates` marked as the date table. Surrogate keys are hidden.

**Measure folders**

| Folder | Holds |
|---|---|
| 01 Core | Revenue, Profit, Margin %, Orders, Customers, Order Lines, Quantity, Avg Order Value, Profit per Order, Revenue per Customer |
| 02 Targets | Margin Target, Revenue/Corporate Growth Target, Market Threshold, Margin vs Target, Markets On Target, Markets On Target %, Health Score |
| 03 Time | Revenue LY, Profit LY, Revenue YoY %, Margin LY %, Margin YoY pp |
| 04 Discount | Avg Discount, Lines Below Breakeven, Loss Line Share, Profit Destroyed, Profit Earned, Discount Exposure, Discount Verdict, Verdict Colour |
| 05 Basket economics | Basket Revenue, Basket Profit, Basket Margin %, Basket Lift pp, Cross-sell Revenue, Avg Basket Value, Contribution per Order |
| 06 Customer economics | Customer Revenue/Profit/Margin %/Lift pp, Spend Median, Customer Status, Recommended Action, Status Colour |
| 07 Classification | Portfolio Margin, Economic Class, Class Colour |
| 08 HTML visuals | Value Ladder SVG, Class Badge HTML, KPI Card HTML |
| 09 Concentration | Top 10 / Top 100 Customer Share, Bottom 50% Share, Cumulative Revenue % |
| 10 Price position | Avg Price Index, Net Price Index |

**Calculated columns worth knowing about**

- `Sales[Discount Band]` — five bands, sorted by `Discount Band Order`
- `Sales[Line Outcome]` — Below breakeven / Profitable
- `Customer[Revenue Rank]`, `Customer[Revenue Band]` — 30 equal-count spend bands
- `Product[Category]`, `Product[Price Index]`

---

## Shared page furniture

**Canvas** 1280 × 720, background `#F7F8FA`.
**Cards** white, 1px `#E9ECF1` border, 8px radius, 16–20px padding, shadow off.

**Slicer row** — same position on every page, top right, 32px tall:
`Dates[year]` · `Geography[market]` · `Segment[segment]` · `Category[category]`
Set every slicer to **Dropdown**, single-select off, and add a **Clear all
slicers** bookmark button labelled "Reset".

**Semantic colours** — use these and nothing else:

| Meaning | Hex |
|---|---|
| Healthy / value creating | `#2E9E6B` |
| Strategic / opportunity | `#6C4BE8` |
| Watch / near target | `#C98A18` |
| Destructive / risk | `#D65745` |
| Neutral ink | `#101319` / `#6B7280` |

Where a measure already returns a colour (`Class Colour`, `Verdict Colour`,
`Status Colour`), drive conditional formatting from it via **Format style →
Field value** rather than re-entering rules. That is the whole reason those
measures exist.

---

## Page 1 — Executive overview

> Is the business healthy, profitable and growing against target?

| # | Visual | Fields | Notes |
|---|---|---|---|
| 1 | Card ×4 | `Revenue`, `Margin %`, `Revenue YoY %`, `Customers` | Callout 28px semibold, category label 11px uppercase |
| 2 | KPI / Card | `Health Score` | Add `Markets On Target %` as the supporting line |
| 3 | Map (filled) | Location `Geography[country]`, Colour `Margin %` | Diverging scale, midpoint `Margin Target` |
| 4 | Line chart | Axis `Dates[order_date]` (month), Values `Revenue`, `Profit` | Two-line, no stacking. Add `Revenue LY` as a faint third if you want the comparison |
| 5 | Donut | Legend `Segment[segment]`, Values `Revenue` | Centre label = total |
| 6 | Table | Rows `Geography[market]`, Values `Revenue`, `Margin %`, `Revenue YoY %`, `Markets On Target` | Data bars on Revenue; conditional colour on `Margin vs Target` |

---

## Page 2 — Product & category intelligence

> Which products drive profitable growth, and where is discounting hurting?

| # | Visual | Fields | Notes |
|---|---|---|---|
| 1 | Card ×3 | `Revenue`, `Margin %`, `Avg Discount` | |
| 2 | Bar chart | Axis `Subcategory[subcategory]`, Values `Revenue`, Colour by `Margin %` | Sort descending by Revenue. This is the ranking view |
| 3 | Scatter | X `Avg Discount`, Y `Margin %`, Size `Revenue`, Details `Subcategory[subcategory]` | Add a constant line at `Margin Target` on Y |
| 4 | Matrix | Rows `Geography[country]`, Columns `Category[category]`, Values `Profit` | Background colour → Field value → `Class Colour` is wrong here; use a diverging rule on Profit centred at 0. Top 10 countries only |
| 5 | Table | Rows `Product[product]`, Values `Revenue`, `Margin %`, `Avg Discount`, `Orders` | Top N = 20 by Revenue |

---

## Page 3 — Commercial performance & value drivers

> Who creates value, where are we losing profitability, who needs action?

| # | Visual | Fields | Notes |
|---|---|---|---|
| 1 | Table | Rows `Customer[customer_id]`, Values `Revenue`, `Margin %`, `Orders`, `Revenue YoY %`, `Customer Status`, `Recommended Action` | **Top N = 10 by Revenue.** Background colour on Status → Field value → `Status Colour`. Centre the last two columns |
| 2 | HTML Content | `KPI Card HTML` | Sits above the signals list |
| 3 | Multi-row card | `Lines Below Breakeven`, `Profit Destroyed`, `Markets On Target`, `Revenue YoY %` | The "strategic signals" read |
| 4 | Sankey (custom visual) | Source `Segment[segment]`, Destination `Category[category]`, Weight `Revenue` | Profit mode will drop loss-making flows — a Sankey band cannot be negative. Note it on the visual |
| 5 | Matrix | Rows `Category[category]`, Columns `Segment[segment]`, Values `Margin %` | Three-band conditional format: ≥15% green, 10–15% amber, <10% red |
| 6 | Line + column | Axis `Customer[Revenue Band]`, Column `Revenue`, Line `Cumulative Revenue %` | The Pareto. 30 bands, not 15,707 points — that is what makes it render |
| 7 | Card ×3 | `Top 10 Customer Share`, `Top 100 Customer Share`, `Bottom 50% Share` | Accent left border, per the web version |

---

## Page 4 — Profitability & growth economics

> Is a low-margin product destroying value, or creating it downstream?

This is the page the model was really built for.

| # | Visual | Fields | Notes |
|---|---|---|---|
| 1 | Card ×5 | `Margin %`, `Basket Margin %`, `Customer Margin %`, `Discount Exposure`, `Revenue` | The last one filtered to `Economic Class = "Strategic loss leader"` via a visual-level filter |
| 2 | **Scatter** | X `Margin %`, Y `Basket Margin %`, Size `Revenue`, Legend `Economic Class`, Details `Product[product]` | The loss-leader matrix. **Visual-level filter: `Orders` ≥ 25** — below that a basket margin is noise. Constant line on X at `Margin Target`, on Y at `Portfolio Margin`. Legend colours: Winner green, Strategic loss leader violet, Underdeveloped amber, True margin problem red |
| 3 | HTML Content | `Value Ladder SVG` | Product → Basket → Customer, with the benchmark tick. Redraws on selection from visual 2 |
| 4 | HTML Content | `Class Badge HTML` | The verdict pill for the selected product |
| 5 | Table | Rows `Sales[Discount Band]`, Values `Revenue`, `Margin %`, `Basket Margin %`, `Customer Margin %`, `Avg Basket Value`, `Discount Verdict` | Background colour on Verdict → Field value → `Verdict Colour` |
| 6 | Scatter | X `Avg Price Index`, Y `Margin %`, Size `Revenue`, Details `Product[product]` | Constant line at X = 1. **Add a text box stating this is internal positioning** — see the honesty note below |
| 7 | Table | Rows `Economic Class`, Values `Revenue`, `Orders`, `Margin %`, `Basket Margin %` | The decision table. Add a static Action column via a text box or a small disconnected table |

### Cross-filtering

Set **Edit interactions** so visual 2 (the matrix) *filters* visuals 3, 4, 5 and 7,
and *highlights* visual 6. Everything else on the page should be set to **None**
from the KPI cards, so clicking a card never reshapes the analysis.

---

## Honesty note for page 4

Section 6 is narrower than a competitive-pricing section would normally be, and
the visual should say so. Put this in a text box beside visual 6:

> Price index compares each product to the median list price of its own
> category. This dataset holds no competitor prices, no traffic and no
> conversion, so it cannot say whether a low price is a pricing-discipline
> failure or a competitive requirement. Answering that needs market pricing and
> session data.

Do not label anything here "vs market". It is not.

---

## Reconciliation

Every figure below is produced identically by three independent
implementations — the pandas pipeline, the React dashboard, and this DAX model.
If a visual disagrees with this table, the visual is wrong.

| Measure | Value |
|---|---|
| Order lines | 51,288 |
| Revenue | $6,517,641 |
| Profit | $1,065,426 |
| Margin % | 16.3% |
| Orders | 25,728 |
| Customers | 15,707 |
| Lines below breakeven | 11,039 (21.5%) |
| Profit destroyed | $346,976 |
| Top 10 customer share | 1.6% |
| Top 100 customer share | 9.1% |
| Bottom 50% share | 8.4% |

**Product classification** (products with ≥25 orders)

| Class | Count |
|---|---|
| Winner | 243 |
| True margin problem | 154 |
| Underdeveloped | 112 |
| Strategic loss leader | 68 |

**Discount bands**

| Band | Product | Basket | Customer | Verdict |
|---|---|---|---|---|
| No discount | 31.7% | 29.3% | 24.7% | Value creating |
| Up to 10% | 11.5% | 17.7% | 17.3% | Value creating |
| 10–20% | 18.8% | 19.2% | 17.8% | Value creating |
| 20–30% | 10.9% | 9.0% | 13.6% | Neutral |
| 30%+ | −21.3% | −12.3% | 1.0% | Destructive |

---

## Two things to watch

**`Spend Median` is filter-aware and therefore not cheap.** It recomputes the
median across every customer in view, which is correct but costs a scan. Keep it
on cards and the 10-row watchlist. If you put `Customer Status` on a visual with
thousands of rows it will crawl, because the status calls the median per row.

**The old tables are still in the file.** `raw`, `Fact_Orders`, the four `Dim*`
tables and two auto date tables remain, and they hold the *uncorrected* data —
17,415 customers rather than 15,707. Delete them once nothing depends on them,
or you will eventually build a visual on the wrong fact and not notice.
