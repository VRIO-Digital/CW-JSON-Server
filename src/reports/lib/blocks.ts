import { KPIS, MEASURE_KEYS } from '../data';
import { fmt, numVal } from './format';
import { sum } from './select';
import type { Block, BlockSpec, BlockType, KpiSpec, MeasureKey, Row } from '../types';

let seq = 0;

/** Gives a spec an identity so it can be selected, moved and removed. */
export function instantiate(spec: BlockSpec): Block {
  return { ...JSON.parse(JSON.stringify(spec)), id: 'b' + ++seq };
}

/** Identifies a block by what it shows, so we don't re-offer one already present. */
export function blockSig(b: BlockSpec): string {
  if (b.type === 'chart') return `chart:${b.measure}`;
  if (b.type === 'quarterly') return `quarterly:${b.metric ?? 'tons'}`;
  return b.type;
}

export const BLOCK_TAG: Record<BlockType, string> = {
  kpis: 'Summary tiles',
  chart: 'Chart',
  table: 'Table',
  facilities: 'Facility comparison',
  quarterly: 'Trend',
  traces: 'Manifest traces',
};

/* -------------------------------------------------------------- KPI tiles */

/**
 * The summary tiles, resolved from the dataset.
 *
 * **They were seven closures over EPA's fields** — penalty exposure, tons shipped to VLS, under consent
 * decree — so every tenant's summary strip was that tenant's. A closure cannot be served, which is why
 * they were in code; expressed as `{ agg, field, against, format }` they can be, and
 * `dataset.kpis` is where they live. `server.mjs` does exactly this for the report section's own
 * `summary_catalog`, for exactly this reason.
 *
 * The three `*_over` aggregations are the shape both packages' tiles actually take — one field compared
 * against another ("projects over their envelope"), rather than a bare sum.
 */
export interface KpiDef {
  label: string;
  value: (rows: Row[]) => string;
  tone?: (rows: Row[]) => 'bad' | 'warn' | undefined;
}

const overs = (rows: Row[], spec: KpiSpec) =>
  spec.field && spec.against
    ? rows
        .map((r) => numVal(r, spec.field as string) - numVal(r, spec.against as string))
        .filter((d) => d > 0)
    : [];

function compute(rows: Row[], spec: KpiSpec): number {
  switch (spec.agg) {
    case 'rows':
      return rows.length;
    case 'sum':
      return spec.field ? sum(rows, spec.field) : 0;
    case 'count_true':
      return spec.field ? rows.filter((r) => r[spec.field as string] === true).length : 0;
    case 'count_positive':
      return spec.field ? rows.filter((r) => numVal(r, spec.field as string) > 0).length : 0;
    case 'count_over':
      return overs(rows, spec).length;
    case 'sum_over':
      return overs(rows, spec).reduce((t, d) => t + d, 0);
    case 'max_over': {
      const d = overs(rows, spec);
      return d.length ? Math.max(...d) : 0;
    }
    default:
      return 0;
  }
}

/**
 * A tile's definition, built from its spec.
 *
 * The tone is applied only where the figure is non-zero, which is what the closures did: "0 projects
 * over envelope" is good news and colouring it red would be the tile shouting at a clean slice.
 */
export function kpiDef(spec: KpiSpec): KpiDef {
  return {
    label: spec.label,
    value: (rows) => fmt(spec.format === 'int' ? '' : (spec.field ?? ''), compute(rows, spec)) ,
    tone: spec.tone
      ? (rows) => (compute(rows, spec) > 0 ? (spec.tone as 'bad' | 'warn') : undefined)
      : undefined,
  };
}

/** Every tile the dataset declares, by key. */
export const kpiDefs = (): Record<string, KpiDef> =>
  Object.fromEntries(KPIS.map((spec) => [spec.key, kpiDef(spec)]));

/** The keys, in the order the dataset states them. */
export const kpiOrder = (): string[] => KPIS.map((spec) => spec.key);

/* ------------------------------------------------------------- measures */

/**
 * Whether a key is a measure a chart may plot — checked against the served list.
 *
 * It was EPA's six, written down here. The pool is the dataset's `measures`, derived from its field
 * catalogue, so a tenant whose numbers are `auth`/`comm`/`proj` is not being asked to describe them in
 * a vocabulary that cannot hold them.
 */
export function isMeasure(key: string): key is MeasureKey {
  return MEASURE_KEYS.includes(key);
}

/** The measures on offer, in the dataset's order. */
export const measures = (): MeasureKey[] => MEASURE_KEYS;
