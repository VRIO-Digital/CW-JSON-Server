import { FIELDS, ROW_MODEL } from '../data';
import type { Field, Generator, ValueFormat } from '../types';

export function field(key: string): Field | undefined {
  return FIELDS.find((f) => f.key === key);
}

export function fieldLabel(key: string): string {
  return field(key)?.label ?? key;
}

export function money(v: number): string {
  return '$' + Math.round(v).toLocaleString('en-US');
}

/** Money already expressed in millions — CAPEX's fixture states its own unit and it is not dollars. */
export function moneyM(v: number): string {
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
}

export function tons(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' t';
}

/**
 * Formats a raw value for display, keyed by the field it came from.
 *
 * **How a column prints is the dataset's declaration**, not a list of column names known here. This was
 * `if (key === 'penalty') … 'tons' … 'cd' … 'risk'`, which is EPA's dictionary written into the engine:
 * CAPEX's `auth` is money in millions and printed as a bare `42`, and its `varP` is a percentage that
 * printed as `12.4`. Anything the dataset does not list still prints as its plain value, which is the
 * right answer for a name or a region.
 */
export function fmt(key: string, v: unknown): string {
  return formatAs(ROW_MODEL.formats?.[key], key, v);
}

/** The same, given the format outright — what a summary tile states rather than reads off a column. */
export function formatAs(how: ValueFormat | undefined, key: string, v: unknown): string {
  if (how === 'money') return money(Number(v));
  if (how === 'money_m') return moneyM(Number(v));
  if (how === 'tons') return tons(Number(v));
  if (how === 'count') return Number(v).toLocaleString('en-US');
  if (how === 'pct') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
  if (how === 'yesno') return v ? 'Yes' : 'No';
  if (how === 'text') return labelize(key, v as string) || '—';
  return String(v ?? '');
}

/** A column's own value labels, where it has them — `risk: { high: 'High' }`. */
export function labelize(key: string, v: string | boolean): string {
  if (ROW_MODEL.formats?.[key] === 'yesno') return v ? 'Yes' : 'No';
  return ROW_MODEL.labels?.[key]?.[String(v)] ?? String(v);
}

/** Categorical display value for a row — what filters match against. */
export function catVal(p: Generator, key: string): string {
  const raw = p[key];
  if (ROW_MODEL.formats?.[key] === 'yesno') return raw ? 'Yes' : 'No';
  if (ROW_MODEL.labels?.[key]) return labelize(key, String(raw ?? ''));
  return String(raw ?? '');
}

export function numVal(p: Generator, key: string): number {
  return Number(p[key] ?? 0);
}

/** Distinct values a categorical field takes, for the filter menu. */
export function catValues(rows: Generator[], key: string): string[] {
  return Array.from(new Set(rows.map((p) => catVal(p, key)))).sort();
}

export type Tone = 'over' | 'warn' | 'ok';

/**
 * What a row's state colours it.
 *
 * The dataset names the column and maps its values, so EPA's `risk` and CAPEX's `status` are the same
 * mechanism. A row whose value is unlisted draws no tone rather than the lowest one: "not one of the
 * states this dataset declares" and "fine" are different facts, and only one of them is good news.
 */
export function rowTone(p: Generator): Tone | undefined {
  const key = ROW_MODEL.status;
  if (!key) return undefined;
  return ROW_MODEL.tones?.[String(p[key] ?? '')];
}

/** The same, as the pill class the table draws. */
export function rowPill(p: Generator): 'bad' | 'warn' | 'ok' | undefined {
  const tone = rowTone(p);
  return tone === 'over' ? 'bad' : tone;
}

/** The column that names a row, as text. */
export function rowLabel(p: Generator): string {
  return String(p[ROW_MODEL.label] ?? '');
}

export function pct(v: number, max: number): string {
  if (max <= 0) return '0%';
  return Math.max(v > 0 ? 2 : 0, (v / max) * 100).toFixed(1) + '%';
}
