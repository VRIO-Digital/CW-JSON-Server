/** Domain + UI types for the Context·Weave report authoring flow. */

export type RiskLevel = 'high' | 'med' | 'low';

/** Drives the coloured dot in the field picker. */
export type FieldKind = 'cat' | 'num' | 'cta' | 'text';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  filterable: boolean;
  /** `false` when the field exists in the domain but not on this spine. */
  avail?: boolean;
  /** Shown in the picker when `avail` is false. */
  note?: string;
}

/**
 * One row of the register the authoring flow composes a report over.
 *
 * **It used to be EPA's generator, field by field**, and every block renderer read those names —
 * `p.generator`, `p.risk`, `penalty`. That made the flow one tenant's: pointed at Northline's capital
 * projects it kept drawing "Penalty exposure by generator" over rows that have neither, which is what
 * was reported. The register is now whatever the served dataset holds, and what a renderer needs to
 * know about it — which field names a row, which are numeric, how each one formats — is **declared by
 * the dataset** rather than compiled in. `Generator` is kept as the name because it is what the
 * vendored folder calls this everywhere; the shape is generic.
 */
export type Row = { [key: string]: string | number | boolean | undefined };
export type Generator = Row;

/** How a field's value is written for a reader. Declared per field by the dataset — see `FORMATS`. */
export type ValueFormat =
  | 'money'
  | 'moneyM'
  | 'signedMoneyM'
  | 'percent'
  | 'signedPercent'
  | 'tons'
  | 'int'
  | 'yesno'
  | 'text';

/** One summary tile, expressed as data because a closure cannot be served. */
export interface KpiSpec {
  key: string;
  label: string;
  /**
   * `rows` counts the slice. The `*_over` three compare `field` against `against` — the shape both
   * tenants' tiles actually take ("projects over envelope", "generators with enforcement").
   */
  agg: 'rows' | 'sum' | 'count_true' | 'count_positive' | 'count_over' | 'sum_over' | 'max_over';
  field: string | null;
  against?: string | null;
  format: ValueFormat;
  tone?: 'bad' | 'warn' | null;
}

export interface Facility {
  facility: string;
  role: string;
  state: string;
  evals: number;
  viols: number;
  enf: number;
  penalty: number;
  last_eval: string;
}

export interface Quarter {
  quarter: string;
  manifests: number;
  tons: number;
  /** Load rejections. */
  rej: number;
  /** Residue shipments. */
  res: number;
}

export interface Trace {
  mtn: string;
  generator: string;
  gen_state: string;
  shipped: string;
  received: string;
  days: number;
  transporters: string[];
  tons: string;
  residue: string;
  rejected: string;
  status: string;
}

/* ---------------------------------------------------------------- reading */

export type SlotKey = 'graph' | 'scope' | 'measure' | 'horizon';

export interface Assumption {
  value: string;
  label: string;
}

export type Assumptions = Record<SlotKey, Assumption>;

export interface SlotOption {
  value: string;
  label: string;
  d: string;
  /** Compact name for chips, where the sentence-form `label` is too long. */
  short?: string;
}

export interface SlotOptions {
  q: string;
  options: SlotOption[];
}

/* ----------------------------------------------------------------- blocks */

/**
 * A numeric field a chart may plot.
 *
 * A string rather than a union of EPA's six: the pool is `dataset.measures`, derived from the field
 * catalogue, so a tenant whose measures are `auth`/`comm`/`proj` is not describing them in a
 * vocabulary that cannot hold them. `isMeasure` still checks membership — against the served list.
 */
export type MeasureKey = string;
/** A tile's key. The tiles are `dataset.kpis`, so this is a string rather than EPA's seven. */
export type KpiKey = string;
export type ChartType = 'bar' | 'column' | 'line';
export type QuarterMetric = 'tons' | 'manifests';

export type BlockType = 'kpis' | 'chart' | 'table' | 'facilities' | 'quarterly' | 'traces';

/** A block as authored in a starter/preset — no identity yet. */
export interface BlockSpec {
  type: BlockType;
  title: string;
  kpis?: KpiKey[];
  chartType?: ChartType;
  measure?: MeasureKey;
  cols?: string[];
  metric?: QuarterMetric;
}

/** A block placed in the report. */
export interface Block extends BlockSpec {
  id: string;
}

export interface Preset {
  label: string;
  d: string;
  block: BlockSpec;
}

/* --------------------------------------------------------------- starters */

export type Spine = 'generators' | 'facilities' | 'quarters' | 'traces';

export interface Reading {
  template: string;
  slots: SlotKey[];
}

export interface Starter {
  id: string;
  label: string;
  report_tag: string;
  q: string;
  spine: Spine;
  /** Overrides the default scope assumption when this starter is picked. */
  scope?: string;
  title: string;
  reading: Reading;
  blocks: BlockSpec[];
  filters?: Filter[];
}

/* ---------------------------------------------------------------- filters */

export interface Filter {
  key: string;
  /** `'All'` means the filter is present but not narrowing anything. */
  val: string;
}

/* ------------------------------------------------------- library + publish */

/** The three tabs inside the Reports section. */
export type ReportTab = 'library' | 'author' | 'authorize' | 'audience';

export type ReportStatus = 'draft' | 'published';

export interface Audience {
  key: string;
  label: string;
  d: string;
}

/** A library row as authored in dataset.json — expanded into a SavedReport at load. */
export interface LibraryEntry {
  id: string;
  name: string;
  status: ReportStatus;
  /** id of the starter this report was built from. */
  starter: string;
  published_by: string;
  published_role: string;
  saved_at: string;
  audience: string;
}

/** A report sitting in the library, draft or published. */
export interface SavedReport {
  id: string;
  name: string;
  status: ReportStatus;
  starterId: string;
  question: string;
  assumptions: Assumptions;
  filters: Filter[];
  blocks: Block[];
  publishedBy: string;
  publishedRole: string;
  savedAt: string;
  audience: string;
  /**
   * The app personas Share put on this row, as role ids. **A different pool from `audience` above**,
   * which is the prototype's own group vocabulary (Operations / Compliance) — so the two are kept
   * apart rather than one translated into the other.
   *
   * Optional, and absent means Share has never been used here: a report nobody has shared and one
   * deliberately made private (`[]`) are different facts, and only the second is a decision. It stays
   * in this browser, because the prototype does not post its saved reports to the API.
   */
  viewerRoles?: string[];
  /**
   * How often the figures re-run, as the id of one of the tenant's freshness presets.
   *
   * Set at publish and stored beside the readers. Like them it stays in this browser, and like
   * them it is **declared**: nothing here schedules anything, so the row states the intention the
   * publisher chose rather than reporting a job that ran.
   */
  freshness?: string;
}

/* -------------------------------------------------------------------- app */

export type Step = 1 | 2 | 3;

export interface Meta {
  persona_name: string;
  persona_role: string;
  persona_initials: string;
  entity_plural: string;
  scope_line: string;
  source_trace: string;
}
