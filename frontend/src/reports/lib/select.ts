import { GENERATORS, ROW_MODEL } from '../data';
import { catVal, numVal } from './format';
import type { Assumptions, Filter, Generator, MeasureKey, ScopeRule } from '../types';

/**
 * Does one row satisfy one scope rule?
 *
 * A rule with no `field` is the "every row" case — the default scope every dataset has — rather than a
 * rule that matches nothing, which is the reading that would empty a report without saying so.
 */
function admits(row: Generator, rule: ScopeRule): boolean {
  if (!rule.field) return true;
  const raw = row[rule.field];
  switch (rule.op) {
    case 'gt':
      return Number(raw ?? 0) > Number(rule.value ?? 0);
    case 'lt':
      return Number(raw ?? 0) < Number(rule.value ?? 0);
    case 'eq':
      return String(raw ?? '') === String(rule.value ?? '');
    case 'ne':
      return String(raw ?? '') !== String(rule.value ?? '');
    case 'truthy':
      return Boolean(raw);
    default:
      return true;
  }
}

/**
 * The population the report is about, before any slicing filters.
 *
 * **The rules are the dataset's, not this function's.** This was a `switch` over EPA's three scope ids
 * reading EPA's three columns, with `default:` returning everything — so CAPEX's `major` (projects over
 * $5M) fell through and a report claiming to cover the largest projects covered all of them, with
 * nothing on screen saying so. A scope the dataset does not declare is the same silent widening, so it
 * is an empty selection instead: a report with no rows reads as a scope that selected nothing, which is
 * what happened.
 */
export function scopeSet(scope: string): Generator[] {
  const rule = ROW_MODEL.scopes?.[scope];
  if (!rule) return [];
  return GENERATORS.filter((p) => admits(p, rule));
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
