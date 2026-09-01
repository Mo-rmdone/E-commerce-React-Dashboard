# Prism — Commercial Intelligence

An interactive analytics dashboard for a global skincare and beauty e-commerce
dataset, built as a data product rather than a static report: every figure is
computed from the source workbook at build time, and every visual cross-filters
the rest of the page.

**Stack** — React 18 · TypeScript (strict) · D3 · Framer Motion · lucide-react · Vite

---

## What it reports

51,288 order lines across 164 countries, 2020–2023, measured against four
business targets:

| Target | Result |
|---|---|
| 20% annual revenue growth | **Met every year** (+22.4 / +26.0 / +23.8%) |
| 15% profit margin | **Missed in 2023** (12.8%) and permanently in two categories |
| 30% Corporate segment growth | **Missed every year** (+20.5 / +26.6 / +24.3%) |
| $400K annual sales per market | **Africa never clears it** (peak $163.6K) |

Three pages: an executive overview with a geographic view, product and
discount intelligence, and customer/market deep-dive with generated
recommendations.

---

## Running it

```bash
npm install
npm run etl     # builds public/data/dataset.json from the workbook
npm run dev     # http://localhost:5180
```

`npm run etl` only needs re-running when the workbook changes — the generated
dataset is committed so a fresh clone can `npm run build` straight away.

| Script | Does |
|---|---|
| `npm run etl` | Rebuild the dataset from the Excel workbook |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run build:full` | ETL, then build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run deploy` | Build and deploy to Cloudflare |

---

## Architecture

```
scripts/build-dataset.mjs   Excel -> typed columnar dataset (build-time ETL)
src/
  config/       business targets and design tokens — every threshold lives here
  data/
    loaders/    base64 -> TypedArray rehydration
    transformations/  the filter engine (row-index based)
    metrics/    aggregation, breakdowns, time series, KPIs, alerts
  hooks/        filter store, derived data, drill state
  components/   layout, charts, cards, tables, filters, tooltips, drilldown
  pages/        the three report pages
```

**The data layer.** The workbook is parsed once at build time into
dictionary-encoded, fixed-width columns shipped as base64. The browser
rehydrates them into TypedArrays with no parsing pass. Filtering produces an
array of row indices — nothing is copied — and every chart on the page reads
that same array, so changing a filter costs one scan rather than one per visual.

**Business rules are centralised.** `src/config/targets.ts` holds the four
targets and the single `gradeAgainstTarget` function. No component defines its
own idea of "on target", which is what stops two cards disagreeing.

**Motion never gates content.** Data marks paint at their true geometry on the
first frame; entrance animation is CSS whose resting state is the final state.
A throttled or skipped animation can never leave a chart blank or a bar short.

---

## Data integrity

The workbook is the single source of truth and nothing is estimated around it.
The in-app **Data notes** panel lists every correction and limitation; the
short version:

**Corrections applied on import**
- US customer IDs de-duplicated — a 9th digit encodes the US sub-region, not the
  customer, inflating the US customer count ~3.2× (2,501 → 793)
- Discount float noise collapsed (`0.15000000000000002` → `0.15`)
- Sudan reassigned to a single region; 2 exact duplicate rows dropped; one
  product name folded from two casings

**What the data cannot support**
- **No cost field.** Profit resolves exactly to `Sales × (BaseMargin − Discount)`
  on all 51,288 rows, so discount is the only lever on margin
- **Product is not a member of a Category** — 3,576 products appear across
  multiple subcategories, which is why the hierarchy is drawn as a *flow*
  rather than a containment tree
- **`Sales` is gross**, pre-discount; the app reports on that basis throughout
- **No weekday analysis** — order dates were synthesised and the weekday
  distribution is degenerate (990 Thursdays against 9,348 Tuesdays)

The ETL self-checks on every run: totals are reconciled against the raw sheet,
and each row's date is verified against the Excel serial embedded in its own
Order ID. The build fails rather than emitting a silently wrong dataset.

---

## Deploying to Cloudflare

The app is fully static. `wrangler.jsonc` configures Workers Static Assets with
SPA fallback via `not_found_handling: "single-page-application"`.

> There is deliberately **no `_redirects` file**. Workers Static Assets rejects
> the usual `/* /index.html 200` SPA rule as an infinite loop, because its own
> html_handling already strips `/index` and the rewrite re-triggers itself. The
> `not_found_handling` setting above does the same job natively.

### Option A — Wrangler CLI

```bash
npx wrangler login
npm run deploy
```

### Option B — Cloudflare dashboard (deploy on git push)

**Workers & Pages → Create → Import a repository**, then:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `22` (from `.nvmrc`) |

No environment variables or secrets are needed.

`public/_headers` pins fingerprinted assets as immutable and keeps
`index.html` uncached, so a deploy reaches everyone immediately.

---

## A note on `npm audit`

`npm audit` reports one high-severity advisory against **`xlsx`** (SheetJS):
prototype pollution and ReDoS, with `fixAvailable: false` because SheetJS
publishes current releases from its own CDN rather than npm.

It does not affect this application:

- `xlsx` is a **devDependency**, used only by `scripts/build-dataset.mjs`
- It never reaches the browser. The app fetches the pre-built
  `dataset.json`; verified by grepping the production bundle for SheetJS
- Both advisories need attacker-controlled input. The only input is one
  committed workbook in `data/`

If you would rather not have it installed at all, delete the `xlsx`
devDependency and the `etl` script: `public/data/dataset.json` is committed, so
`npm run build` works without either. You would only lose the ability to
regenerate the dataset from the Excel.

## Licence / attribution

Dataset from the FP20 Analytics Challenge 19. Country boundaries from Natural
Earth via [`world-atlas`](https://github.com/topojson/world-atlas); 153 of the
164 trading countries have a boundary match, and the remaining 11 still plot
from the coordinates the workbook supplies.
