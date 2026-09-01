/** Shapes shared across the data, metric and presentation layers. */

// ------------------------------------------------------------- raw payload

export interface RawProduct {
  name: string;
  unitPrice: number;
}

export interface RawCountry {
  name: string;
  lat: number;
  lon: number;
  market: number;
  atlasId: string | null;
}

export interface RawPlace {
  city: string;
  state: string;
  country: number;
}

export interface RawSubcategory {
  name: string;
  category: number;
  baseMarginTiers: number[];
  baseMarginWeighted: number | null;
}

export interface QualityNote {
  id: string;
  label: string;
  detail: string;
  rows?: number;
}

export interface DatasetQuality {
  source: string;
  sheets: string[];
  rowsRead: number;
  rowsKept: number;
  corrections: QualityNote[];
  limitations: QualityNote[];
  fieldNotes: Record<string, string>;
}

export interface DatasetMeta {
  generatedAt: string;
  source: string;
  rows: number;
  years: number[];
  dateRange: [string, string];
  currency: string;
  baseMarginFormulaExact: boolean;
}

export interface RawDataset {
  meta: DatasetMeta;
  quality: DatasetQuality;
  dims: {
    dates: string[];
    customers: string[];
    orders: number;
    products: RawProduct[];
    countries: RawCountry[];
    places: RawPlace[];
    regions: string[];
    markets: string[];
    segments: string[];
    categories: string[];
    subcategories: RawSubcategory[];
    baseMarginTiers: number[];
  };
  columns: Record<string, string>;
}

// ------------------------------------------------------------- runtime shape

/** Column-oriented fact table. One index = one order line. */
export interface FactColumns {
  date: Int16Array;
  customer: Int16Array;
  product: Int16Array;
  country: Int16Array;
  place: Int16Array;
  region: Int8Array;
  market: Int8Array;
  segment: Int8Array;
  subcategory: Int8Array;
  order: Int32Array;
  quantity: Int8Array;
  sales: Int16Array;
  discountBp: Int16Array;
  profitCents: Int32Array;
  baseMarginBp: Int16Array;
  /** Derived at load: year of each row's date, for fast year filtering. */
  year: Int16Array;
  /** Derived at load: 0-based month index within the dataset's span. */
  monthIndex: Int16Array;
  /** Derived at load: quarter 1-4. */
  quarter: Int8Array;
}

export interface Dimensions {
  dates: string[];
  dateMs: Float64Array;
  customers: string[];
  orderCount: number;
  products: RawProduct[];
  countries: RawCountry[];
  places: RawPlace[];
  regions: string[];
  markets: string[];
  segments: string[];
  categories: string[];
  subcategories: RawSubcategory[];
  baseMarginTiers: number[];
  /** subcategory index -> category index */
  subToCategory: Int8Array;
  /** country index -> market index */
  countryToMarket: Int8Array;
  years: number[];
  /** Month keys ("2020-01") indexed by monthIndex. */
  months: string[];
}

export interface Dataset {
  meta: DatasetMeta;
  quality: DatasetQuality;
  dims: Dimensions;
  facts: FactColumns;
  rowCount: number;
}

// ----------------------------------------------------------------- filters

/** Dimensions the workbook actually supports filtering on. */
export type FilterDimension =
  | 'year'
  | 'market'
  | 'region'
  | 'country'
  | 'segment'
  | 'category'
  | 'subcategory'
  | 'product';

export type FilterState = {
  [K in FilterDimension]: number[];
};

export interface CrossFilterSource {
  dimension: FilterDimension;
  value: number;
  /** Human-readable origin, shown so a user knows why a chart changed. */
  origin: string;
}

// ---------------------------------------------------------------- measures

export interface Measures {
  sales: number;
  netSales: number;
  profit: number;
  quantity: number;
  lines: number;
  orders: number;
  customers: number;
  /** Sum of discount x sales, for a revenue-weighted discount rate. */
  discountValue: number;
  /** Sum of baseMargin x sales, for a revenue-weighted breakeven. */
  breakevenValue: number;
  /** Profit from lines discounted past their breakeven (a negative number). */
  lossProfit: number;
  lossLines: number;
}

export interface MeasureSummary extends Measures {
  grossMargin: number | null;
  netMargin: number | null;
  avgDiscount: number | null;
  avgBreakeven: number | null;
  avgOrderValue: number | null;
  lossShare: number | null;
}

/** A measure summary for one member of a dimension, plus its prior-year twin. */
export interface Breakdown {
  key: number;
  label: string;
  /** Measures across the whole filtered window. */
  current: MeasureSummary;
  /**
   * Latest-year measures — the numerator `growth` is computed from. Exposed so
   * a total row can re-aggregate growth from the same two years each member
   * used, instead of dividing a multi-year total by a single prior year.
   */
  latest: MeasureSummary | null;
  /** Prior-year measures — the denominator of `growth`. */
  prior: MeasureSummary | null;
  growth: number | null;
}

export type MetricKey = 'sales' | 'netSales' | 'profit' | 'margin' | 'growth' | 'discount';

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  format: (v: number | null) => string;
  /** True when higher is better — drives delta colouring. */
  higherIsBetter: boolean;
}
