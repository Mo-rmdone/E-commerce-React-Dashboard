/**
 * Dataset packer — Gold layer  ->  typed columnar dataset consumed by the app.
 *
 * The Python Medallion pipeline (data-pipeline/) is the single source of truth:
 * it lands the workbook (Bronze), cleans and conforms it (Silver) and builds the
 * star schema (Gold). This script does NOT clean data — it reads the pipeline's
 * clean Gold rows and its report, then:
 *   1. dictionary-encodes every dimension,
 *   2. emits fixed-width typed columns as base64 for zero-parse rehydration,
 *   3. re-validates the data independently (totals + the Order-ID date check),
 *   4. carries the pipeline's quality, ETL, star-model and profiling into the UI.
 *
 * Run the pipeline first:  python data-pipeline/run_pipeline.py
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PIPELINE = path.resolve(ROOT, 'data-pipeline');
const GOLD_ROWS = path.join(PIPELINE, 'data', 'gold', 'app_rows.json');
const REPORT = path.join(PIPELINE, 'reports', 'pipeline_report.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'dataset.json');

const log = (...a) => console.log('[pack]', ...a);
const excelEpoch = Date.UTC(1899, 11, 30);

// ---------------------------------------------------------------- read Gold

for (const p of [GOLD_ROWS, REPORT]) {
  if (!fs.existsSync(p)) {
    console.error(
      `[pack] pipeline output missing:\n      ${p}\n` +
        `      run the pipeline first:  python data-pipeline/run_pipeline.py`,
    );
    process.exit(1);
  }
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const goldRows = JSON.parse(fs.readFileSync(GOLD_ROWS, 'utf8')).rows;
log(`loaded ${goldRows.length.toLocaleString()} clean Gold rows from data-pipeline`);

// Map the pipeline's flat rows onto the compact internal shape.
const rows = goldRows.map((r) => ({
  d: r.order_date,
  order: String(r.order_id),
  cust: String(r.customer_id),
  seg: String(r.segment),
  city: String(r.city),
  state: String(r.state),
  country: String(r.country),
  lat: r.lat,
  lon: r.lon,
  region: String(r.region),
  market: String(r.market),
  sub: String(r.subcategory),
  cat: String(r.category),
  prod: String(r.product),
  qty: r.quantity,
  sales: r.sales,
  disc: r.discount,
  profit: r.profit,
}));

// Data-integrity notes come straight from the pipeline report, so this panel
// can never drift out of step with what the pipeline actually did.
const quality = {
  source: report.source,
  sheets: report.sheets,
  rowsRead: report.rowsRead,
  rowsKept: report.rowsKept,
  corrections: report.corrections,
  limitations: report.limitations,
  fieldNotes: report.fieldNotes,
};

// ------------------------------------------------------------ dimension build

class Dict {
  constructor() {
    this.index = new Map();
    this.values = [];
  }
  id(key) {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.values.length;
      this.index.set(key, i);
      this.values.push(key);
    }
    return i;
  }
  get size() {
    return this.values.length;
  }
}

const dDate = new Dict();
const dCustomer = new Dict();
const dProduct = new Dict();
const dCountry = new Dict();
const dPlace = new Dict();
const dRegion = new Dict();
const dMarket = new Dict();
const dSegment = new Dict();
const dCategory = new Dict();
const dSubcategory = new Dict();
const dOrder = new Dict();

// Dates first, so the index is chronological.
const allDates = [...new Set(rows.map((r) => r.d))].sort();
allDates.forEach((d) => dDate.id(d));

const countryMeta = new Map(); // name -> { lat, lon, market }
const placeMeta = new Map(); // key  -> { city, state, country }
const subMeta = new Map(); // name -> category
const productMeta = new Map(); // name -> unit price

const N = rows.length;
const cDate = new Int16Array(N);
const cCustomer = new Int16Array(N);
const cProduct = new Int16Array(N);
const cCountry = new Int16Array(N);
const cPlace = new Int16Array(N);
const cRegion = new Int8Array(N);
const cMarket = new Int8Array(N);
const cSegment = new Int8Array(N);
const cSubcategory = new Int8Array(N);
const cOrder = new Int32Array(N);
const cQuantity = new Int8Array(N);
const cSales = new Int16Array(N); // whole dollars — verified integer in audit
const cDiscountBp = new Int16Array(N); // basis points (0.15 -> 1500)
const cProfitCents = new Int32Array(N);
// Recovered, not assumed: Profit = Sales x (BaseMargin - Discount). BaseMargin
// is an order-line attribute, so it is stored per row rather than per dimension.
const cBaseMarginBp = new Int16Array(N);

for (let i = 0; i < N; i++) {
  const r = rows[i];

  if (!countryMeta.has(r.country)) {
    countryMeta.set(r.country, { lat: r.lat, lon: r.lon, market: r.market });
  }
  const placeKey = `${r.city}${r.state}${r.country}`;
  if (!placeMeta.has(placeKey)) {
    placeMeta.set(placeKey, { city: r.city, state: r.state, country: r.country });
  }
  if (!subMeta.has(r.sub)) subMeta.set(r.sub, r.cat);
  if (!productMeta.has(r.prod)) productMeta.set(r.prod, r.sales / r.qty);

  cDate[i] = dDate.id(r.d);
  cCustomer[i] = dCustomer.id(r.cust);
  cProduct[i] = dProduct.id(r.prod);
  cCountry[i] = dCountry.id(r.country);
  cPlace[i] = dPlace.id(placeKey);
  cRegion[i] = dRegion.id(r.region);
  cMarket[i] = dMarket.id(r.market);
  cSegment[i] = dSegment.id(r.seg);
  cSubcategory[i] = dSubcategory.id(r.sub);
  cOrder[i] = dOrder.id(r.order);
  cQuantity[i] = r.qty;
  cSales[i] = r.sales;
  cDiscountBp[i] = Math.round(r.disc * 10000);
  cProfitCents[i] = Math.round(r.profit * 100);
  cBaseMarginBp[i] = Math.round((r.profit / r.sales + r.disc) * 10000);
}

// Categories are indexed through subcategories (Subcategory -> Category is the
// one product hierarchy edge the audit found to be clean).
dSubcategory.values.forEach((s) => dCategory.id(subMeta.get(s)));

// Guard the Int16 assumption rather than trusting it.
for (const [name, dict] of [
  ['customer', dCustomer],
  ['product', dProduct],
  ['country', dCountry],
  ['place', dPlace],
]) {
  if (dict.size > 32767) {
    console.error(`[pack] ${name} dictionary (${dict.size}) overflows Int16`);
    process.exit(1);
  }
}

log(
  `dimensions — customers ${dCustomer.size}, products ${dProduct.size}, ` +
    `countries ${dCountry.size}, places ${dPlace.size}, orders ${dOrder.size}`,
);

// --------------------------------------------- derived dimension measures

// Verify the recovered formula reproduces Profit on every single row. If it
// ever stops holding, the discount/breakeven analysis in the app is invalid.
let formulaMisses = 0;
for (let i = 0; i < N; i++) {
  const expected = cSales[i] * ((cBaseMarginBp[i] - cDiscountBp[i]) / 10000);
  if (Math.abs(expected * 100 - cProfitCents[i]) > 1) formulaMisses++;
}
const cleanFormula = formulaMisses === 0;
const baseMarginTiers = [...new Set(cBaseMarginBp)].sort((a, b) => a - b);
log(
  `base-margin formula: ${cleanFormula ? 'exact on all rows' : `${formulaMisses} misses`} ` +
    `— tiers ${baseMarginTiers.map((b) => `${b / 100}%`).join(', ')}`,
);

// Base margin is assigned per order line, not per subcategory.
const subTierSales = dSubcategory.values.map(() => new Map());
const subSales = new Float64Array(dSubcategory.size);
const subWeighted = new Float64Array(dSubcategory.size);
for (let i = 0; i < N; i++) {
  const s = cSubcategory[i];
  const bp = cBaseMarginBp[i];
  subTierSales[s].set(bp, (subTierSales[s].get(bp) ?? 0) + cSales[i]);
  subSales[s] += cSales[i];
  subWeighted[s] += (bp / 10000) * cSales[i];
}
const subBaseMargin = dSubcategory.values.map((_, i) => ({
  tiers: [...subTierSales[i].keys()].sort((a, b) => a - b).map((b) => b / 10000),
  weighted: subSales[i] ? subWeighted[i] / subSales[i] : null,
}));

// -------------------------------------------------- topojson name bridge

const atlasPath = path.join(ROOT, 'node_modules', 'world-atlas', 'countries-110m.json');
let countryToAtlasId = {};
let atlasMatched = 0;
if (fs.existsSync(atlasPath)) {
  const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
  const geoms = atlas.objects.countries.geometries;
  const norm = (s) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z]/g, '');
  const byName = new Map();
  for (const g of geoms) {
    if (g.properties?.name) byName.set(norm(g.properties.name), g.id);
  }
  const SYNONYMS = {
    'United States': 'United States of America',
    'Czech Republic': 'Czechia',
    'Democratic Republic of the Congo': 'Dem. Rep. Congo',
    'Dominican Republic': 'Dominican Rep.',
    'Central African Republic': 'Central African Rep.',
    'South Sudan': 'S. Sudan',
    'Equatorial Guinea': 'Eq. Guinea',
    'Bosnia and Herzegovina': 'Bosnia and Herz.',
    'North Macedonia': 'Macedonia',
    'Ivory Coast': "Côte d'Ivoire",
    "Cote d'Ivoire": "Côte d'Ivoire",
    'Burma (Myanmar)': 'Myanmar',
    'Republic of Korea': 'South Korea',
    Swaziland: 'eSwatini',
    Eswatini: 'eSwatini',
    'Cape Verde': 'Cabo Verde',
    'East Timor': 'Timor-Leste',
    'Solomon Islands': 'Solomon Is.',
    'Western Sahara': 'W. Sahara',
    'Antigua and Barbuda': 'Antigua and Barb.',
    'Saint Vincent and the Grenadines': 'St. Vin. and Gren.',
    'United Republic of Tanzania': 'Tanzania',
  };
  for (const name of dCountry.values) {
    const candidate = SYNONYMS[name] ?? name;
    const id = byName.get(norm(candidate)) ?? byName.get(norm(name));
    if (id) {
      countryToAtlasId[name] = id;
      atlasMatched++;
    }
  }
  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
  fs.copyFileSync(atlasPath, path.join(ROOT, 'public', 'countries-110m.json'));
  log(`atlas: ${atlasMatched}/${dCountry.size} countries matched to boundaries`);
} else {
  log('atlas not found — map will fall back to coordinate bubbles only');
}

// -------------------------------------------------------------- encoding

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

const dates = dDate.values;
const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))].sort();

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: report.source,
    rows: N,
    years,
    dateRange: [dates[0], dates[dates.length - 1]],
    currency: 'USD',
    baseMarginFormulaExact: cleanFormula,
  },
  quality,
  // The Medallion pipeline's own record — surfaced in the data-notes panel so
  // the dashboard shows how its data was engineered.
  pipeline: {
    generatedAt: report.generatedAt,
    etl: report.etl,
    dataModel: report.dataModel,
    profiling: report.profiling,
    reconciliation: report.quality,
    lineage: report.lineage,
  },
  dims: {
    dates,
    customers: dCustomer.values,
    orders: dOrder.size,
    products: dProduct.values.map((name) => ({ name, unitPrice: productMeta.get(name) })),
    countries: dCountry.values.map((name) => {
      const m = countryMeta.get(name);
      return {
        name,
        lat: m.lat,
        lon: m.lon,
        market: dMarket.index.get(m.market),
        atlasId: countryToAtlasId[name] ?? null,
      };
    }),
    places: dPlace.values.map((k) => {
      const m = placeMeta.get(k);
      return { city: m.city, state: m.state, country: dCountry.index.get(m.country) };
    }),
    regions: dRegion.values,
    markets: dMarket.values,
    segments: dSegment.values,
    categories: dCategory.values,
    subcategories: dSubcategory.values.map((name, i) => ({
      name,
      category: dCategory.index.get(subMeta.get(name)),
      baseMarginTiers: subBaseMargin[i].tiers,
      baseMarginWeighted: subBaseMargin[i].weighted,
    })),
    baseMarginTiers: baseMarginTiers.map((b) => b / 10000),
  },
  columns: {
    date: b64(cDate),
    customer: b64(cCustomer),
    product: b64(cProduct),
    country: b64(cCountry),
    place: b64(cPlace),
    region: b64(cRegion),
    market: b64(cMarket),
    segment: b64(cSegment),
    subcategory: b64(cSubcategory),
    order: b64(cOrder),
    quantity: b64(cQuantity),
    sales: b64(cSales),
    discountBp: b64(cDiscountBp),
    profitCents: b64(cProfitCents),
    baseMarginBp: b64(cBaseMarginBp),
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
log(`wrote ${path.relative(ROOT, OUT_FILE)} — ${kb} KB`);

// ------------------------------------------------------------- self-check
// Independent re-validation of the pipeline's Gold rows.

let sSales = 0;
let sProfit = 0;
for (let i = 0; i < N; i++) {
  sSales += cSales[i];
  sProfit += cProfitCents[i] / 100;
}
let rawSales = 0;
let rawProfit = 0;
for (const r of rows) {
  rawSales += r.sales;
  rawProfit += r.profit;
}
const ok = Math.abs(sSales - rawSales) < 1 && Math.abs(sProfit - rawProfit) < 1;
log(
  `checksum — sales $${Math.round(sSales).toLocaleString()}, ` +
    `profit $${Math.round(sProfit).toLocaleString()} … ${ok ? 'OK' : 'MISMATCH'}`,
);
if (!ok) process.exit(1);

// Date integrity — each Order ID ends in the Excel serial of the original
// (pre-shift) order date; every Order Date is that serial plus 2,922 days.
const SHIFT_DAYS = 2922;
const offsets = new Map();
for (const r of rows) {
  const serial = Number(r.order.slice(r.order.lastIndexOf('-') + 1));
  if (!Number.isFinite(serial)) continue;
  const expected = new Date(excelEpoch + (serial + SHIFT_DAYS) * 86400000)
    .toISOString()
    .slice(0, 10);
  const delta = (Date.parse(r.d) - Date.parse(expected)) / 86400000;
  offsets.set(delta, (offsets.get(delta) ?? 0) + 1);
}
const datesAligned = offsets.size === 1 && offsets.has(0);
log(
  `date check — ${dates[0]} → ${dates[dates.length - 1]}, years ${years.join('/')} … ` +
    (datesAligned ? 'OK' : `MISMATCH: ${[...offsets.entries()].map(([d, n]) => `${d}:${n}`).join(', ')}`),
);
if (!datesAligned) process.exit(1);
