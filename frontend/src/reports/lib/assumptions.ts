import { ASSUMPTIONS, OPTS } from '../data';
import type { Assumption, Assumptions, SlotKey, Starter } from '../types';

export function optLabel(key: SlotKey, value: string): string {
  return OPTS[key].options.find((o) => o.value === value)?.label ?? value;
}

/**
 * Back to the defaults, except the published graph: that's the user's data
 * source, chosen on step 1, and it has to survive changing the question.
 */
export function freshAssumptions(keepGraph?: Assumption): Assumptions {
  const next: Assumptions = JSON.parse(JSON.stringify(ASSUMPTIONS));
  if (keepGraph) next.graph = { ...keepGraph };
  return next;
}

/** Defaults with the starter's own scope override applied. */
export function assumptionsForStarter(starter: Starter, keepGraph?: Assumption): Assumptions {
  const next = freshAssumptions(keepGraph);
  if (starter.scope) next.scope = { value: starter.scope, label: optLabel('scope', starter.scope) };
  return next;
}
