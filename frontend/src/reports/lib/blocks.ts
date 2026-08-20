import { money, tons } from './format';
import { sum } from './select';
import type { Block, BlockSpec, BlockType, Generator, KpiKey, MeasureKey } from '../types';

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

export interface KpiDef {
  label: string;
  value: (rows: Generator[]) => string;
  tone?: (rows: Generator[]) => 'bad' | 'warn' | undefined;
}

export const KPI_DEFS: Record<KpiKey, KpiDef> = {
  count: {
    label: 'Generators in scope',
    value: (rows) => rows.length.toLocaleString('en-US'),
  },
  enf: {
    label: 'Enforcement actions',
    value: (rows) => sum(rows, 'enf').toLocaleString('en-US'),
    tone: (rows) => (sum(rows, 'enf') > 0 ? 'bad' : undefined),
  },
  penalty: {
    label: 'Penalty exposure',
    value: (rows) => money(sum(rows, 'penalty')),
    tone: (rows) => (sum(rows, 'penalty') > 0 ? 'bad' : undefined),
  },
  cd: {
    label: 'Under consent decree',
    value: (rows) => rows.filter((p) => p.cd).length.toLocaleString('en-US'),
    tone: (rows) => (rows.some((p) => p.cd) ? 'warn' : undefined),
  },
  viols: {
    label: 'Open violations',
    value: (rows) => sum(rows, 'viols').toLocaleString('en-US'),
    tone: (rows) => (sum(rows, 'viols') > 0 ? 'warn' : undefined),
  },
  tons: {
    label: 'Tons shipped to VLS',
    value: (rows) => tons(sum(rows, 'tons')),
  },
  manifests: {
    label: 'Manifests',
    value: (rows) => sum(rows, 'manifests').toLocaleString('en-US'),
  },
};

export const KPI_ORDER: KpiKey[] = ['count', 'enf', 'penalty', 'cd', 'viols', 'tons', 'manifests'];

/* ------------------------------------------------------------- measures */

export const MEASURES: MeasureKey[] = ['penalty', 'tons', 'viols', 'enf', 'evals', 'manifests'];

export function isMeasure(key: string): key is MeasureKey {
  return (MEASURES as string[]).includes(key);
}
