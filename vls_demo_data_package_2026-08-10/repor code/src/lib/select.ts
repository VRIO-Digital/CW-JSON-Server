import { GENERATORS } from '../data';
import { catVal, numVal } from './format';
import type { Assumptions, Filter, Generator, MeasureKey } from '../types';

/** The population the report is about, before any slicing filters. */
export function scopeSet(scope: string): Generator[] {
  switch (scope) {
    case 'enf':
      return GENERATORS.filter((p) => p.enf > 0);
    case 'oos':
      return GENERATORS.filter((p) => p.state !== 'TX');
    case 'cd':
      return GENERATORS.filter((p) => p.cd);
    default:
      return GENERATORS;
  }
}

/** Scope narrowed by the active filter chips. `'All'` chips are no-ops. */
export function applyFilters(rows: Generator[], filters: Filter[]): Generator[] {
  return rows.filter((p) => filters.every((f) => f.val === 'All' || catVal(p, f.key) === f.val));
}

export function selectRows(assumptions: Assumptions, filters: Filter[]): Generator[] {
  return applyFilters(scopeSet(assumptions.scope.value), filters);
}

export function rankBy(rows: Generator[], measure: MeasureKey): Generator[] {
  return [...rows].sort((a, b) => numVal(b, measure) - numVal(a, measure));
}

export function sum(rows: Generator[], key: MeasureKey): number {
  return rows.reduce((t, p) => t + numVal(p, key), 0);
}

export function hasFilter(filters: Filter[], key: string): boolean {
  return filters.some((f) => f.key === key);
}
