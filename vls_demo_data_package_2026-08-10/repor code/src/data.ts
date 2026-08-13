import dataset from './data/dataset.json';
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
  Starter,
  Trace,
} from './types';

/**
 * The demo dataset lives in `data/dataset.json` — edit the figures there. This
 * module is the typed boundary around it: the JSON import widens strings (a
 * `risk` of `"high"` arrives as `string`), so the assertion below pins it back
 * to the domain types.
 *
 * That assertion is NOT verified by TypeScript, so `validateDataset` walks the
 * loaded data at startup and throws on anything malformed. Keep them in step —
 * a new required field belongs in both the interface and the validator.
 *
 * In the real product these collections are resolved graph queries — same
 * shapes, fetched rather than bundled.
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
}

export const DATA = validateDataset(dataset as Dataset);

export const META = DATA.meta;
export const AUDIENCES = DATA.audiences;
export const LIBRARY = DATA.library;
export const FIELDS = DATA.fields;
export const ASSUMPTIONS = DATA.assumptions;
export const OPTS = DATA.opts;
export const GENERATORS = DATA.generators;
export const FACILITIES = DATA.facilities;
export const QUARTERS = DATA.quarters;
export const TRACES = DATA.traces;
export const STARTERS = DATA.starters;
export const PRESETS = DATA.presets;
export const SLICE_DEFAULT = DATA.slice_default;
