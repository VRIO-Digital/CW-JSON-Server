import { GENERATORS } from '../data';
import { catVal, numVal } from './format';
import type { Assumptions, Filter, Generator, MeasureKey, Row } from '../types';

/**
 * The population the report is about, before any slicing filters.
 *
 * **The three narrowing scopes were EPA's predicates** — enforcement history, out of state, under
 * decree — reading fields another tenant's register does not carry, so under CAPEX each one silently
 * returned nothing. They are kept for the dataset that declares them and each now checks that the
 * field is actually there: a scope whose field is absent returns the whole register rather than an
 * empty one, because "no rows" is a statement about the data and this would have been a statement
 * about the code.
 *
 * A scope this function has never heard of is likewise the whole register. The set a scope *should*
 * narrow to is the dataset's to declare, and neither package declares one yet.
 */
export function scopeSet(scope: string): Row[] {
  const has = (key: string) => GENERATORS.length > 0 && GENERATORS[0][key] !== undefined;
  switch (scope) {
    case 'enf':
      return has('enf') ? GENERATORS.filter((p) => numVal(p, 'enf') > 0) : GENERATORS;
    case 'oos':
      return has('state') ? GENERATORS.filter((p) => p.state !== 'TX') : GENERATORS;
    case 'cd':
      return has('cd') ? GENERATORS.filter((p) => p.cd === true) : GENERATORS;
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
