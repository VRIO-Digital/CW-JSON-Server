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
  RowModel,
  SlotKey,
  SlotOptions,
  Starter,
  Trace,
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
  generators: Generator[];
  facilities: Facility[];
  quarters: Quarter[];
  traces: Trace[];
  starters: Starter[];
  presets: Preset[];
  slice_default: string[];
  /** How this dataset's rows are read — see `RowModel`. Required: an absent one is an engine
   *  guessing EPA's column names against somebody else's fixture. */
  row_model: RowModel;
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
export let STARTERS: Starter[] = [];
export let PRESETS: Preset[] = [];
export let SLICE_DEFAULT: string[] = [];
export let ROW_MODEL = {} as RowModel;

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
  GENERATORS = DATA.generators;
  FACILITIES = DATA.facilities;
  QUARTERS = DATA.quarters;
  TRACES = DATA.traces;
  STARTERS = DATA.starters;
  PRESETS = DATA.presets;
  SLICE_DEFAULT = DATA.slice_default;
  ROW_MODEL = DATA.row_model;

  isHydrated = true;
}
