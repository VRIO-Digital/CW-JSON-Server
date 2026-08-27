/** Domain + UI types for the Context·Weave report authoring flow. */

export type RiskLevel = 'high' | 'med' | 'low';

/** Drives the coloured dot in the field picker. */
/* `text` is a fourth because a second dataset's dictionary declares one: a project's name and the
   sentence explaining its variance are neither a category to filter by nor a number to rank by. The
   picker already printed "text" for anything that was not `cat` or `num`, so this names what it drew. */
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

export type RowValue = string | number | boolean | null | undefined;

/**
 * One row of the population a report is about.
 *
 * **Open, because the columns are the dataset's.** This was EPA's eleven fields spelled out, which was
 * true of the one fixture the prototype shipped with and false the moment a second arrived: CAPEX's rows
 * are capital projects carrying `auth`/`comm`/`proj`, and no column here is one of them. What a row
 * *means* is declared per dataset in `RowModel` below — which column names it, which carries its state,
 * which may be ranked — so the engine reads through that rather than through field names it happens to
 * know.
 *
 * The EPA columns stay named and optional rather than being deleted: they are what its own fixture
 * carries, and a named field still type-checks the reads that are genuinely about EPA — the quarterly
 * and traces blocks, which only its data has rows for.
 */
export interface Generator {
  generator?: string;
  state?: string;
  risk?: RiskLevel;
  evals?: number;
  viols?: number;
  enf?: number;
  penalty?: number;
  tons?: number;
  manifests?: number;
  cd?: boolean;
  last_enf?: string;
  [column: string]: RowValue;
}

/** How a column prints. A column the dataset does not list prints as its plain value. */
export type ValueFormat = 'money' | 'money_m' | 'tons' | 'count' | 'pct' | 'yesno' | 'text';

/**
 * What one scope option admits, as data rather than as a branch.
 *
 * `scopeSet` was a `switch` over EPA's three option ids reading EPA's three columns, so a dataset with
 * scopes of its own fell through to "everything" — a report that says it covers the projects over $5M
 * and quietly covers all sixty. A rule with no `field` is the deliberate "every row" case.
 */
export interface ScopeRule {
  field?: string;
  op?: 'gt' | 'lt' | 'eq' | 'ne' | 'truthy';
  value?: string | number | boolean;
}

/**
 * One summary tile, as data.
 *
 * These were seven closures keyed by an EPA id, with the label and the arithmetic both written into the
 * engine — so "Tons shipped to VLS" was a tile every dataset had and only one could mean.
 */
export interface KpiSpec {
  key: string;
  label: string;
  /** `rows` counts the population; the rest read `field`. */
  agg: 'rows' | 'sum' | 'count_true' | 'count_eq';
  field?: string;
  /** The value `count_eq` matches. */
  value?: string;
  format?: ValueFormat;
  /** Applied when the tile is non-zero — a count of nothing is not a warning. */
  tone?: 'bad' | 'warn';
}

/**
 * How this dataset's rows are read: the declaration that lets one engine draw two datasets.
 *
 * Everything here was a literal in the engine — `p.generator` as the row label, `p.risk` as the tone,
 * `p.cd` as a pill, a `switch` over three scope ids, a table of seven tiles. Each was right for the
 * fixture the prototype was vendored with and wrong for any other, and wrong *silently*: a column a
 * dataset does not have reads as a blank cell rather than as a column that does not exist here.
 */
export interface RowModel {
  /** The column that names a row — a chart's axis label, a table's first cell. */
  label: string;
  /**
   * A second line under that name in a table, as a template over the row's own columns:
   * `"{evals} evaluations · last enforcement {last_enf}"`. Null where a row has nothing to add —
   * interpolated the way the What-if lens interpolates `{room}`, so the words stay the dataset's.
   */
  sublabel: string | null;
  /** Columns drawn as a yes/no pill, with the words each state takes. */
  pills: Record<string, { on: string; off: string }>;
  /** The categorical column carrying state, or null where a row has none. */
  status: string | null;
  /** That column's values mapped to a tone. A value not listed draws no tone. */
  tones: Record<string, 'over' | 'warn' | 'ok'>;
  /** Scope option id → the rows it admits. Every id in `opts.scope` needs one. */
  scopes: Record<string, ScopeRule>;
  /** The columns a chart may rank by, in the order they are offered. */
  measures: string[];
  /** The tiles a `kpis` block may name. */
  kpis: KpiSpec[];
  /** How each column prints. */
  formats: Record<string, ValueFormat>;
  /** Value relabelling, per column — `risk: { high: 'High' }`. */
  labels: Record<string, Record<string, string>>;
  /** The block kinds this dataset can draw; a roster it has no rows for is legitimately absent. */
  blocks: BlockType[];
  /** A table's closing sentence: each column summed, with the noun that follows it. */
  footer: { field: string; label: string }[];
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

/* Both are the *dataset's* vocabulary, so neither can be a union written here: EPA ranks by penalty and
   tonnage, CAPEX by variance against an authorized envelope. `RowModel` is what says which are real, and
   the validator checks a block against it — a union in this file could only ever describe one fixture. */
export type MeasureKey = string;
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
export type ReportTab = 'library' | 'author' | 'audience';

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
  /** The same noun for one row — "1 capital project", not "1 capital projects". */
  entity_singular: string;
  /** The example question the Ask step shows. The dataset's own, because it names its own columns. */
  ask_placeholder: string;
  scope_line: string;
  source_trace: string;
}
