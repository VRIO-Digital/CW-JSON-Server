/** Domain + UI types for the Context·Weave report authoring flow. */

export type RiskLevel = 'high' | 'med' | 'low';

/** Drives the coloured dot in the field picker. */
export type FieldKind = 'cat' | 'num' | 'cta';

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

export interface Generator {
  generator: string;
  state: string;
  risk: RiskLevel;
  evals: number;
  viols: number;
  enf: number;
  penalty: number;
  tons: number;
  manifests: number;
  cd: boolean;
  last_enf: string;
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

export type MeasureKey = 'penalty' | 'tons' | 'viols' | 'enf' | 'evals' | 'manifests';
export type KpiKey = 'count' | 'enf' | 'penalty' | 'cd' | 'tons' | 'manifests' | 'viols';
export type ChartType = 'bar' | 'column';
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
