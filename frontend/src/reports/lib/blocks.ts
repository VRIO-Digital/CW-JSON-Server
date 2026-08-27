import { ROW_MODEL } from '../data';
import { formatAs } from './format';
import { sum } from './select';
import type { Block, BlockSpec, BlockType, Generator, KpiKey, KpiSpec, MeasureKey } from '../types';

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
 * The arithmetic behind one tile.
 *
 * **The tiles are the dataset's and the aggregations are the engine's**, which is the split that lets a
 * closure become data: a served payload cannot carry a function, but it can say *sum this column* and
 * *label it this*. This was seven closures keyed by an EPA id — "Tons shipped to VLS" was a tile every
 * dataset had and only one could mean, and a dataset without a `tons` column got a tile reading 0 t.
 */
export function kpiValue(spec: KpiSpec, rows: Generator[]): number {
  if (spec.agg === 'rows') return rows.length;
  if (!spec.field) return 0;
  if (spec.agg === 'count_true') return rows.filter((p) => Boolean(p[spec.field as string])).length;
  if (spec.agg === 'count_eq') {
    return rows.filter((p) => String(p[spec.field as string] ?? '') === String(spec.value ?? '')).length;
  }
  return sum(rows, spec.field);
}

/**
 * A tile's printed value.
 *
 * The tile states its own format rather than borrowing the column's, because the two genuinely differ:
 * a *count* of the projects whose status is Delayed is a plain number even though `status` is text.
 */
export function kpiText(spec: KpiSpec, rows: Generator[]): string {
  const v = kpiValue(spec, rows);
  return spec.format ? formatAs(spec.format, spec.key, v) : v.toLocaleString('en-US');
}

/** A tile is toned only when it has something to report — a count of nothing is not a warning. */
export function kpiTone(spec: KpiSpec, rows: Generator[]): 'bad' | 'warn' | undefined {
  return spec.tone && kpiValue(spec, rows) > 0 ? spec.tone : undefined;
}

export function kpiSpec(key: KpiKey): KpiSpec | undefined {
  return ROW_MODEL.kpis?.find((k) => k.key === key);
}

/** Every tile this dataset offers, in the order it declares them. */
export function kpiOrder(): KpiKey[] {
  return (ROW_MODEL.kpis ?? []).map((k) => k.key);
}

/* ------------------------------------------------------------- measures */

/** The columns a chart may rank by — the dataset's, in the order it offers them. */
export function measures(): MeasureKey[] {
  return ROW_MODEL.measures ?? [];
}

export function isMeasure(key: string): key is MeasureKey {
  return measures().includes(key);
}
