import { FIELDS } from '../data';
import type { Field, Generator, RiskLevel } from '../types';

export function field(key: string): Field | undefined {
  return FIELDS.find((f) => f.key === key);
}

export function fieldLabel(key: string): string {
  return field(key)?.label ?? key;
}

export function money(v: number): string {
  return '$' + Math.round(v).toLocaleString('en-US');
}

export function tons(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' t';
}

const COUNT_KEYS = ['evals', 'viols', 'enf', 'manifests'];

/** Formats a raw value for display, keyed by the field it came from. */
export function fmt(key: string, v: unknown): string {
  if (key === 'penalty') return money(Number(v));
  if (key === 'tons') return tons(Number(v));
  if (COUNT_KEYS.includes(key)) return Number(v).toLocaleString('en-US');
  if (key === 'cd') return v ? 'Yes' : 'No';
  if (key === 'risk') return labelize('risk', v as string);
  if (key === 'last_enf') return (v as string) || '—';
  return String(v ?? '');
}

export function labelize(key: string, v: string | boolean): string {
  if (key === 'risk') return ({ high: 'High', med: 'Med', low: 'Low' } as Record<string, string>)[String(v)] ?? String(v);
  if (key === 'cd') return v ? 'Yes' : 'No';
  return String(v);
}

/** Categorical display value for a generator row — what filters match against. */
export function catVal(p: Generator, key: string): string {
  if (key === 'cd') return p.cd ? 'Yes' : 'No';
  if (key === 'risk') return labelize('risk', p.risk);
  return String((p as unknown as Record<string, unknown>)[key] ?? '');
}

export function numVal(p: Generator, key: string): number {
  return Number((p as unknown as Record<string, unknown>)[key] ?? 0);
}

/** Distinct values a categorical field takes, for the filter menu. */
export function catValues(rows: Generator[], key: string): string[] {
  return Array.from(new Set(rows.map((p) => catVal(p, key)))).sort();
}

export type Tone = 'over' | 'warn' | 'ok';

export function riskTone(risk: RiskLevel): Tone {
  return risk === 'high' ? 'over' : risk === 'med' ? 'warn' : 'ok';
}

export function riskPill(risk: RiskLevel): 'bad' | 'warn' | 'ok' {
  return risk === 'high' ? 'bad' : risk === 'med' ? 'warn' : 'ok';
}

export function pct(v: number, max: number): string {
  if (max <= 0) return '0%';
  return Math.max(v > 0 ? 2 : 0, (v / max) * 100).toFixed(1) + '%';
}
