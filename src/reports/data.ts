import { validateDataset } from './data/validate';
import type {
  Assumptions,
  Audience,
  Facility,
  Field,
  Generator,
  LibraryEntry,
  Meta,
  Preset,
  Quarter,
  SlotKey,
  SlotOptions,
  KpiSpec,
  Starter,
  Trace,
  ValueFormat,
} from './types';

/**
 * The demo dataset, **fetched** — `s3://contextweave.com/EPA/reports_prototype.json`, served by
 * `GET /reports/prototype`. Edit the figures in the bucket; no rebuild.
 *
 * It used to be `import dataset from './data/dataset.json'`, compiled into the bundle. That made it the
 * one thing on screen that editing the bucket could not change: a figure on the Authoring tab needed a
 * rebuild and a redeploy, and it could not follow the EPA/CAPEX switch either. The note this replaces
 * said "in the real product these collections are resolved graph queries — same shapes, fetched rather
 * than bundled". They are fetched now.
 *
 * **`let`, not `const`, and that is what makes it work.** ES module bindings are live: a consumer that
 * imported `GENERATORS` sees the value this module last assigned, so `hydrate` reaches every reader
 * without any of them changing. It holds because **no consumer reads these at module scope** — every one
 * is inside a component or a function — which was checked before the change rather than after.
 *
 * `validateDataset` still walks the payload, and now it earns its keep twice over: the data arrives over
 * the network, so "a typo in the file" is no longer the only way it can be wrong.
 *
 * The host must call `hydrate` before rendering the prototype, and `isHydrated` is how it knows. The
 * empty defaults below are not a fallback — nothing renders against them; they exist so that a stray
 * render during the fetch cannot throw on `undefined.map`, which would be a blank section with a stack
 * trace in the console instead of a spinner.
 */
export interface Dataset {
  meta: Meta;
  audiences: Audience[];
  library: LibraryEntry[];
  fields: Field[];
  assumptions: Assumptions;
  opts: Record<SlotKey, SlotOptions>;
  starters: Starter[];
  presets: Preset[];
  slice_default: string[];

  /*
   * ---------------- the register, and what a renderer needs to know about it ----------------
   *
   * **These five used to be compiled in as EPA's**, which is why the flow drew "Penalty exposure by
   * generator" over a register of capital projects. They are the dataset's now, so one flow serves
   * either tenant instead of one tenant's vocabulary being the code's.
   *
   * Every one of them is optional and derived when absent, because a dataset written before they
   * existed must still render: `register` falls back to `generators`, the label field to the first
   * text-ish field, the measures to every numeric one. What cannot be derived — how a number is
   * *written*, and which tiles a summary shows — degrades to plain numbers and no tiles rather than to
   * a guess.
   */

  /** The rows a report is composed over. `generators` is the same list under EPA's name for it. */
  register?: Generator[];
  generators?: Generator[];
  /** Which field names a row: the label on a bar, the first column of a table. */
  label_field?: string;
  /** The unit its money is held in — "USD millions" — for a caption that is otherwise ambiguous. */
  unit?: string;
  /** How each field is written. `kind: 'num'` cannot tell money from a percentage. */
  formats?: Record<string, ValueFormat>;
  /** Which field carries a row's state, if any. A tenant that names none gets no tone. */
  tone_field?: string | null;
  /** The summary tiles, as data — a closure cannot be served. */
  kpis?: KpiSpec[];
  /** The numeric fields a chart may plot. */
  measures?: string[];
  /** Declared filter values, where the dataset states them rather than leaving them to be scanned. */
  filter_values?: Record<string, string[]>;

  /*
   * EPA's three secondary spines. Optional: a tenant whose authoring flow has one register does not
   * carry them, and requiring them would have meant inventing three rosters to satisfy a validator.
   */
  facilities?: Facility[];
  quarters?: Quarter[];
  traces?: Trace[];
}

export let DATA = null as unknown as Dataset;

export let META = {} as Meta;
export let AUDIENCES: Audience[] = [];
export let LIBRARY: LibraryEntry[] = [];
export let FIELDS: Field[] = [];
export let ASSUMPTIONS = {} as Assumptions;
export let OPTS = {} as Record<SlotKey, SlotOptions>;
export let GENERATORS: Generator[] = [];
export let FACILITIES: Facility[] = [];
export let QUARTERS: Quarter[] = [];
export let TRACES: Trace[] = [];

/* ---- what a renderer needs to know about the register, resolved once on hydrate ---- */

/** Which field names a row. */
export let LABEL_FIELD = '';
/** The unit its money is held in, for a caption. */
export let UNIT = '';
/** How each field is written. */
export let FORMATS: Record<string, ValueFormat> = {};
/** Which field carries a row's state, or `null` where the tenant names none. */
export let TONE_FIELD: string | null = null;
/** The summary tiles, as data. */
export let KPIS: KpiSpec[] = [];
/** The numeric fields a chart may plot. */
export let MEASURE_KEYS: string[] = [];
export let STARTERS: Starter[] = [];
export let PRESETS: Preset[] = [];
export let SLICE_DEFAULT: string[] = [];

/** Whether the dataset has arrived. The host renders the prototype only once this is true. */
export let isHydrated = false;

/**
 * Take the served dataset, validate it, and publish it to every consumer.
 *
 * Throws on a malformed payload rather than rendering a partial one — a missing `generators` would
 * otherwise be a register with no rows, which reads as "no generators ship here".
 */
export function hydrate(payload: unknown): void {
  DATA = validateDataset(payload as Dataset);

  META = DATA.meta;
  AUDIENCES = DATA.audiences;
  LIBRARY = DATA.library;
  FIELDS = DATA.fields;
  ASSUMPTIONS = DATA.assumptions;
  OPTS = DATA.opts;
  /*
   * The register under either name. `register` is what a tenant-agnostic dataset calls it and
   * `generators` is what EPA's does; one falls back to the other so neither has to be rewritten.
   */
  GENERATORS = DATA.register ?? DATA.generators ?? [];
  FACILITIES = DATA.facilities ?? [];
  QUARTERS = DATA.quarters ?? [];
  TRACES = DATA.traces ?? [];

  /*
   * **Declared where the dataset says so, derived where it can be, and absent otherwise.**
   *
   * The label field falls back to the first non-numeric field, which is what names a row in both
   * packages. The measures fall back to every numeric field. Formats and tiles do not fall back to a
   * guess: a number with no declared format prints as a number, and a dataset with no tiles shows
   * none — better than a currency nobody stated or a summary nobody wrote.
   */
  LABEL_FIELD = DATA.label_field ?? DATA.fields.find((f) => f.kind !== 'num')?.key ?? '';
  UNIT = DATA.unit ?? '';
  FORMATS = DATA.formats ?? {};
  TONE_FIELD = DATA.tone_field ?? null;
  KPIS = DATA.kpis ?? [];
  MEASURE_KEYS =
    DATA.measures ?? DATA.fields.filter((f) => f.kind === 'num' && f.avail !== false).map((f) => f.key);
  STARTERS = DATA.starters;
  PRESETS = DATA.presets;
  SLICE_DEFAULT = DATA.slice_default;

  isHydrated = true;
}
