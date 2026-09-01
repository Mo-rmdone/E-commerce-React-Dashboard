import type {
  Dataset,
  Dimensions,
  FactColumns,
  RawDataset,
} from '@/types';

/** Decode a base64 column into the TypedArray the ETL wrote. */
function decode<T extends Int8Array | Int16Array | Int32Array>(
  b64: string,
  Ctor: new (buffer: ArrayBuffer) => T,
): T {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Ctor(bytes.buffer);
}

let inflight: Promise<Dataset> | null = null;

/**
 * Fetch and rehydrate the dataset produced by `npm run etl`.
 * Cached for the lifetime of the page — the fact table is immutable.
 */
export function loadDataset(url = `${import.meta.env.BASE_URL}data/dataset.json`): Promise<Dataset> {
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Could not load the dataset (${res.status}). Run "npm run etl" to build it from the workbook.`,
      );
    }
    const raw = (await res.json()) as RawDataset;
    return hydrate(raw);
  })();

  return inflight;
}

function hydrate(raw: RawDataset): Dataset {
  const c = raw.columns;
  const n = raw.meta.rows;

  const date = decode(c.date, Int16Array);
  const dates = raw.dims.dates;

  // Derive the calendar columns once, so year/quarter/month filtering and
  // grouping are array reads rather than Date parsing on every pass.
  const dateMs = new Float64Array(dates.length);
  const dateYear = new Int16Array(dates.length);
  const dateQuarter = new Int8Array(dates.length);
  const dateMonthIdx = new Int16Array(dates.length);
  const monthKeys: string[] = [];
  const monthIndexOf = new Map<string, number>();

  for (let i = 0; i < dates.length; i++) {
    const iso = dates[i];
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    dateMs[i] = Date.parse(`${iso}T00:00:00Z`);
    dateYear[i] = y;
    dateQuarter[i] = Math.floor((m - 1) / 3) + 1;
    const key = iso.slice(0, 7);
    let mi = monthIndexOf.get(key);
    if (mi === undefined) {
      mi = monthKeys.length;
      monthKeys.push(key);
      monthIndexOf.set(key, mi);
    }
    dateMonthIdx[i] = mi;
  }

  const year = new Int16Array(n);
  const quarter = new Int8Array(n);
  const monthIndex = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const d = date[i];
    year[i] = dateYear[d];
    quarter[i] = dateQuarter[d];
    monthIndex[i] = dateMonthIdx[d];
  }

  const facts: FactColumns = {
    date,
    customer: decode(c.customer, Int16Array),
    product: decode(c.product, Int16Array),
    country: decode(c.country, Int16Array),
    place: decode(c.place, Int16Array),
    region: decode(c.region, Int8Array),
    market: decode(c.market, Int8Array),
    segment: decode(c.segment, Int8Array),
    subcategory: decode(c.subcategory, Int8Array),
    order: decode(c.order, Int32Array),
    quantity: decode(c.quantity, Int8Array),
    sales: decode(c.sales, Int16Array),
    discountBp: decode(c.discountBp, Int16Array),
    profitCents: decode(c.profitCents, Int32Array),
    baseMarginBp: decode(c.baseMarginBp, Int16Array),
    year,
    quarter,
    monthIndex,
  };

  const subToCategory = new Int8Array(raw.dims.subcategories.length);
  raw.dims.subcategories.forEach((s, i) => (subToCategory[i] = s.category));

  const countryToMarket = new Int8Array(raw.dims.countries.length);
  raw.dims.countries.forEach((c2, i) => (countryToMarket[i] = c2.market));

  const dims: Dimensions = {
    dates,
    dateMs,
    customers: raw.dims.customers,
    orderCount: raw.dims.orders,
    products: raw.dims.products,
    countries: raw.dims.countries,
    places: raw.dims.places,
    regions: raw.dims.regions,
    markets: raw.dims.markets,
    segments: raw.dims.segments,
    categories: raw.dims.categories,
    subcategories: raw.dims.subcategories,
    baseMarginTiers: raw.dims.baseMarginTiers,
    subToCategory,
    countryToMarket,
    years: raw.meta.years,
    months: monthKeys,
  };

  return { meta: raw.meta, quality: raw.quality, dims, facts, rowCount: n };
}
