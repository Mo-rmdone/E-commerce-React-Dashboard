/**
 * ETL — Excel workbook  ->  typed columnar dataset consumed by the React app.
 *
 * The workbook is the single source of truth. This script:
 *   1. reads it,
 *   2. applies the corrections documented in the data audit,
 *   3. dictionary-encodes every dimension,
 *   4. emits fixed-width typed columns as base64 so the browser can
 *      rehydrate them into TypedArrays with zero parsing cost.
 *
 * Nothing here invents a value. Every correction is recorded in `quality`
 * and surfaced in the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKBOOK = 'Global skincare and Beauty e-store_E-commerce Analysis_English.xlsx';

// The workbook is committed under data/ so a fresh clone can rebuild the
// dataset. The parent directory is kept as a fallback for the original
// working layout, and WORKBOOK_PATH overrides both.
const SOURCE =
  process.env.WORKBOOK_PATH ??
  [path.resolve(ROOT, 'data', WORKBOOK), path.resolve(ROOT, '..', WORKBOOK)].find((p) =>
    fs.existsSync(p),
  ) ??
  path.resolve(ROOT, 'data', WORKBOOK);
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'dataset.json');

const log = (...a) => console.log('[etl]', ...a);

// ---------------------------------------------------------------- read

if (!fs.existsSync(SOURCE)) {
  console.error(`[etl] source workbook not found:\n      ${SOURCE}`);
  process.exit(1);
}

log('reading workbook …');
// The ESM build of `xlsx` has no fs bridge, so hand it a buffer directly.
//
// `cellDates` is deliberately OFF. It converts serials into JS Date objects
// using the host timezone, which shifts every date by a day on any machine that
// is not UTC — enough to invent a whole extra year at the start of the range.
// Reading the raw serial and converting with fixed UTC arithmetic below gives
// the same answer on every machine.
const wb = XLSX.read(fs.readFileSync(SOURCE), { type: 'buffer' });
log('sheets:', wb.SheetNames.join(', '));

const sheet = wb.Sheets['data'];
if (!sheet) {
  console.error('[etl] expected a sheet named "data"; found:', wb.SheetNames);
  process.exit(1);
}

/** @type {Record<string, unknown>[]} */
const raw = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: null });
log(`rows read: ${raw.length.toLocaleString()}`);

// Column names are read from the file, never assumed. We verify the ones we
// rely on are present and fail loudly if the workbook shape changes.
const COL = {
  rowId: 'Row ID',
  orderId: 'Order ID',
  orderDate: 'Order Date',
  customerId: 'Customer ID',
  segment: 'Segment',
  city: 'City',
  state: 'State',
  country: 'Country',
  lat: 'Country latitude',
  lon: 'Country longitude',
  region: 'Region',
  market: 'Market',
  subcategory: 'Subcategory',
  category: 'Category',
  product: 'Product',
  quantity: 'Quantity',
  sales: 'Sales',
  discount: 'Discount',
  profit: 'Profit',
};
const present = new Set(Object.keys(raw[0] ?? {}));
const missing = Object.values(COL).filter((c) => !present.has(c));
if (missing.length) {
  console.error('[etl] workbook is missing expected columns:', missing);
  process.exit(1);
}

// ------------------------------------------------------- data dictionary

const dictSheet = wb.Sheets['dictionary'];
const fieldNotes = {};
if (dictSheet) {
  const rows = XLSX.utils.sheet_to_json(dictSheet, { header: 1, raw: true });
  for (const r of rows) {
    if (Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string') {
      fieldNotes[r[0].trim()] = r[1].trim();
    }
  }
}

// ------------------------------------------------------------ corrections
// Each entry is reported in the UI's "Data integrity" panel.

const quality = {
  source: path.basename(SOURCE),
  sheets: wb.SheetNames,
  rowsRead: raw.length,
  rowsKept: 0,
  corrections: [],
  limitations: [],
  fieldNotes,
};
const correction = (id, label, detail, rows) =>
  quality.corrections.push({ id, label, detail, rows });
const limitation = (id, label, detail) =>
  quality.limitations.push({ id, label, detail });

const excelEpoch = Date.UTC(1899, 11, 30);

/**
 * Excel serial -> ISO date, in fixed UTC arithmetic.
 *
 * Every branch stays in UTC so the result never depends on where the build
 * runs. A Date only arrives here if the workbook is ever read with cellDates
 * on; its UTC getters are used for the same reason.
 */
const toISODate = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(excelEpoch + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// DQ-12 — one product exists under two casings; fold to a single identity.
const PRODUCT_ALIASES = new Map([
  [
    'ren clean skincare moroccan rose otto bath oil',
    'REN Clean Skincare Moroccan Rose Otto Bath Oil',
  ],
]);

// DQ-08 — Sudan is assigned to two regions; 2 rows are the outlier.
const REGION_OVERRIDES = new Map([['Sudan|Eastern Africa', 'North Africa']]);
let sudanFixes = 0;

// DQ-04 — US customer numbers carry a 9th digit that encodes the US region,
// not the customer. Stripping it restores the true customer identity.
let usIdCollapses = 0;
const canonicalCustomer = (id, country) => {
  if (typeof id !== 'string') return String(id ?? '');
  const t = id.trim();
  if (country !== 'United States') return t;
  const dash = t.indexOf('-');
  if (dash === -1) return t;
  const num = t.slice(dash + 1);
  if (num.length === 9 && /^\d+$/.test(num)) {
    usIdCollapses++;
    return `${t.slice(0, dash)}-${num.slice(0, 8)}`;
  }
  return t;
};

// DQ-06 — four discount levels that are almost certainly corrupted (a clean
// rate plus 0.002). They are left untouched so Profit still reconstructs
// exactly, and reported so nobody mistakes them for a real pricing tier.
const ANOMALOUS_DISCOUNTS = new Set([0.002, 0.202, 0.402, 0.602]);
let anomalousDiscountRows = 0;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------ normalise

/** @type {{d:string,cust:string,order:string,seg:string,city:string,state:string,country:string,lat:number,lon:number,region:string,market:string,sub:string,cat:string,prod:string,qty:number,sales:number,disc:number,profit:number}[]} */
const rows = [];
const seenExact = new Set();
let droppedDuplicates = 0;
let droppedInvalid = 0;
let discountRounded = 0;

for (const r of raw) {
  const date = toISODate(r[COL.orderDate]);
  const qty = num(r[COL.quantity]);
  const sales = num(r[COL.sales]);
  const profit = num(r[COL.profit]);
  const discRaw = num(r[COL.discount]);
  const lat = num(r[COL.lat]);
  const lon = num(r[COL.lon]);

  // A row must carry a date and the three measures to be analysable.
  if (
    !date ||
    qty === null ||
    sales === null ||
    profit === null ||
    discRaw === null ||
    lat === null ||
    lon === null
  ) {
    droppedInvalid++;
    continue;
  }

  // DQ-06 — float noise (0.15000000000000002) makes one discount level look
  // like two. Round to 4dp, which collapses the noise while preserving the four
  // genuinely odd levels (0.002 / 0.202 / 0.402 / 0.602) that exist in the
  // source. Rounding those away would break the exact Profit reconstruction, so
  // they are kept and reported as an anomaly instead of being altered.
  const disc = Math.round(discRaw * 10000) / 10000;
  if (Math.abs(disc - discRaw) > 1e-12) discountRounded++;
  if (ANOMALOUS_DISCOUNTS.has(disc)) anomalousDiscountRows++;

  const country = String(r[COL.country]).trim();
  let region = String(r[COL.region]).trim();
  const override = REGION_OVERRIDES.get(`${country}|${region}`);
  if (override) {
    region = override;
    sudanFixes++;
  }

  const prodRaw = String(r[COL.product]).trim();
  const prod = PRODUCT_ALIASES.get(prodRaw.toLowerCase()) ?? prodRaw;

  // DQ-07 — two rows are byte-identical duplicates of another row.
  const fingerprint = [
    r[COL.orderId],
    date,
    r[COL.customerId],
    prod,
    r[COL.subcategory],
    qty,
    sales,
    disc,
    profit,
  ].join('');
  if (seenExact.has(fingerprint)) {
    droppedDuplicates++;
    continue;
  }
  seenExact.add(fingerprint);

  rows.push({
    d: date,
    order: String(r[COL.orderId]).trim(),
    cust: canonicalCustomer(r[COL.customerId], country),
    seg: String(r[COL.segment]).trim(),
    city: String(r[COL.city]).trim(),
    state: String(r[COL.state]).trim(),
    country,
    lat,
    lon,
    region,
    market: String(r[COL.market]).trim(),
    sub: String(r[COL.subcategory]).trim(),
    cat: String(r[COL.category]).trim(),
    prod,
    qty,
    sales,
    disc,
    profit,
  });
}

quality.rowsKept = rows.length;
correction(
  'DQ-06',
  'Discount float noise collapsed',
  'Floating-point noise stored 0.15 as two distinct values (0.15 and 0.15000000000000002), splitting one discount level into two in every slicer and grouping. Values are rounded to 4dp, which removes the noise without disturbing any real rate.',
  discountRounded,
);
correction(
  'DQ-06b',
  'Anomalous discount levels flagged, not altered',
  'Four levels (0.2%, 20.2%, 40.2%, 60.2%) look like a clean rate plus 0.002 and appear only on the 10% margin tier. They are left exactly as supplied — rewriting them would break the Profit reconstruction — and are surfaced as a data note.',
  anomalousDiscountRows,
);
correction(
  'DQ-04',
  'US customer IDs de-duplicated',
  'US customer numbers carry a 9th digit encoding the US sub-region rather than the customer, inflating the US customer count roughly 3.2x. The trailing digit is stripped so one shopper is one customer.',
  usIdCollapses,
);
correction(
  'DQ-08',
  'Sudan region reassigned',
  'Sudan appeared under both North Africa and Eastern Africa. The 2 outlying rows were folded into North Africa, its dominant region.',
  sudanFixes,
);
correction(
  'DQ-07',
  'Exact duplicate rows removed',
  'Two order lines were byte-for-byte duplicates of an existing line and would have double-counted their sales and profit.',
  droppedDuplicates,
);
correction(
  'DQ-12',
  'Product name casing folded',
  '"REN Clean Skincare Moroccan Rose Otto Bath Oil" also appeared as "Ren …", counting one product as two.',
  PRODUCT_ALIASES.size,
);
if (droppedInvalid) {
  correction(
    'DQ-00',
    'Unparseable rows excluded',
    'Rows missing a date or any of quantity, sales, discount or profit cannot be analysed.',
    droppedInvalid,
  );
}

log(
  `normalised: ${rows.length.toLocaleString()} rows ` +
    `(-${droppedDuplicates} duplicates, -${droppedInvalid} invalid)`,
);

// ------------------------------------------------------- dimension build

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
  const placeKey = `${r.city}${r.state}${r.country}`;
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
    console.error(`[etl] ${name} dictionary (${dict.size}) overflows Int16`);
    process.exit(1);
  }
}

log(
  `dimensions — customers ${dCustomer.size}, products ${dProduct.size}, ` +
    `countries ${dCountry.size}, places ${dPlace.size}, orders ${dOrder.size}`,
);

// --------------------------------------------- derived dimension measures

// Verify the recovered formula reproduces Profit on every single row. If it
// ever stops holding, the discount/breakeven analysis in the app is invalid
// and we want the build to say so rather than the UI to quietly mislead.
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

// Base margin is assigned per order line, not per subcategory: 8 of 17
// subcategories use a single tier, the rest mix two. The dimension therefore
// carries the observed tiers plus a revenue-weighted average, never a single
// value pretending to be a constant.
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
const mixedSubs = subBaseMargin.filter((b) => b.tiers.length > 1).length;
log(
  `base margin is a line attribute — ${dSubcategory.size - mixedSubs}/${dSubcategory.size} ` +
    `subcategories use one tier, ${mixedSubs} mix two`,
);

// -------------------------------------------------- topojson name bridge

const atlasPath = path.join(
  ROOT,
  'node_modules',
  'world-atlas',
  'countries-110m.json',
);
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
  // Names that differ between the workbook and Natural Earth.
  const SYNONYMS = {
    'United States': 'United States of America',
    Czechia: 'Czechia',
    'Czech Republic': 'Czechia',
    'Republic of the Congo': 'Republic of the Congo',
    'Democratic Republic of the Congo': 'Dem. Rep. Congo',
    'Dominican Republic': 'Dominican Rep.',
    'Central African Republic': 'Central African Rep.',
    'South Sudan': 'S. Sudan',
    'Equatorial Guinea': 'Eq. Guinea',
    'Bosnia and Herzegovina': 'Bosnia and Herz.',
    'North Macedonia': 'Macedonia',
    Macedonia: 'Macedonia',
    'Ivory Coast': "Côte d'Ivoire",
    "Cote d'Ivoire": "Côte d'Ivoire",
    Myanmar: 'Myanmar',
    'Burma (Myanmar)': 'Myanmar',
    'South Korea': 'South Korea',
    'Republic of Korea': 'South Korea',
    'North Korea': 'North Korea',
    Swaziland: 'eSwatini',
    Eswatini: 'eSwatini',
    'Cape Verde': 'Cabo Verde',
    'East Timor': 'Timor-Leste',
    'Solomon Islands': 'Solomon Is.',
    'Western Sahara': 'W. Sahara',
    'Trinidad and Tobago': 'Trinidad and Tobago',
    'Antigua and Barbuda': 'Antigua and Barb.',
    'Saint Vincent and the Grenadines': 'St. Vin. and Gren.',
    'Saint Lucia': 'Saint Lucia',
    'Papua New Guinea': 'Papua New Guinea',
    Tanzania: 'Tanzania',
    'United Republic of Tanzania': 'Tanzania',
    Laos: 'Laos',
    Vietnam: 'Vietnam',
    Syria: 'Syria',
    Russia: 'Russia',
    Iran: 'Iran',
    Turkey: 'Turkey',
    'Hong Kong': 'Hong Kong',
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
  log(
    `atlas: ${atlasMatched}/${dCountry.size} countries matched to boundaries; ` +
      `all ${dCountry.size} have coordinates`,
  );
} else {
  log('atlas not found — map will fall back to coordinate bubbles only');
}

// ----------------------------------------------------- known limitations

limitation(
  'no-cost',
  'No cost or COGS field exists',
  'Profit is supplied directly and resolves exactly to Sales x (BaseMargin - Discount) on every row, where BaseMargin is one of four tiers assigned per order line. Discount is therefore the only lever on margin, and no cost-driven metric is offered.',
);
limitation(
  'line-level-margin',
  'Base margin is an order-line attribute',
  'Eight of the seventeen subcategories price at a single margin tier; the other nine mix two, with no dimension in the workbook explaining the split. Breakeven discount is exact per line, but a subcategory-level breakeven is a revenue-weighted average and is labelled as such.',
);
limitation(
  'no-sku',
  'No SKU level exists',
  'The workbook stops at Product. The category hierarchy therefore drills Category -> Subcategory -> Product, with no SKU tier.',
);
limitation(
  'line-level-category',
  'Category is an order-line attribute, not a product attribute',
  `${dProduct.size} products are recorded across multiple subcategories, so a product has no single category. Category and Subcategory are aggregated from order lines; product rankings are shown on their own or within a chosen category, never with a category label attached to the product.`,
);
limitation(
  'no-sub-segment',
  'No sub-segment field exists',
  'Segment has exactly 3 values and no child column. The segment drill-down therefore descends Segment -> Market -> Country -> Customer, which the data does support.',
);
limitation(
  'gross-sales',
  'Sales is a gross, pre-discount figure',
  'Sales equals Quantity x unit price with the discount applied to Profit only. Both Gross and Net revenue are exposed, and every KPI states which basis it uses.',
);
limitation(
  'weekday',
  'Weekday analysis is not offered',
  'Order dates were synthesised and the weekday distribution is degenerate (Thursday 990 rows against Tuesday 9,348). Year, quarter and month are sound; day-of-week is not, so no weekday visual exists.',
);

// -------------------------------------------------------------- encoding

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

const dates = dDate.values;
const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))].sort();

const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    source: path.basename(SOURCE),
    rows: N,
    years,
    dateRange: [dates[0], dates[dates.length - 1]],
    currency: 'USD',
    baseMarginFormulaExact: cleanFormula,
  },
  quality,
  dims: {
    dates,
    customers: dCustomer.values,
    orders: dOrder.size,
    products: dProduct.values.map((name) => ({
      name,
      unitPrice: productMeta.get(name),
    })),
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
// Totals recomputed straight off the encoded columns must match the raw sheet.

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
const ok =
  Math.abs(sSales - rawSales) < 1 && Math.abs(sProfit - rawProfit) < 1;
log(
  `checksum — sales $${Math.round(sSales).toLocaleString()}, ` +
    `profit $${Math.round(sProfit).toLocaleString()} … ${ok ? 'OK' : 'MISMATCH'}`,
);
if (!ok) process.exit(1);

// Date integrity. Each Order ID ends in the Excel serial of the original
// (pre-shift) order date, and every row's Order Date is exactly that serial
// plus 2,922 days. That gives an independent check on the date conversion:
// a timezone-dependent parse shifts the offset off 2,922 on every row.
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
    (datesAligned
      ? 'OK (every row matches its own Order ID serial + 2,922 days)'
      : `MISMATCH, day offsets seen: ${[...offsets.entries()].map(([d, n]) => `${d}:${n}`).join(', ')}`),
);
if (!datesAligned) {
  console.error(
    '[etl] date conversion is off — this usually means dates were parsed in local time.',
  );
  process.exit(1);
}
