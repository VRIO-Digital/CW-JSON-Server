import { FIELDS, FORMATS, LABEL_FIELD, TONE_FIELD, UNIT } from '../data';
import type { Field, Row, ValueFormat } from '../types';

/**
 * Formatting for the register the authoring flow composes over.
 *
 * **Every rule here used to name one of EPA's fields** — `penalty` was money, `tons` carried a unit,
 * `risk` had three labels — so pointed at another tenant's register the flow printed raw numbers under
 * headings that did not apply. The dataset declares the format per field now (`FORMATS`), which field
 * names a row (`LABEL_FIELD`) and which one carries a state, if any (`TONE_FIELD`). Nothing in this
 * file knows a field name.
 */

export function field(key: string): Field | undefined {
  return FIELDS.find((f) => f.key === key);
}

export function fieldLabel(key: string): string {
  return field(key)?.label ?? key;
}

/** Whole dollars — EPA's penalties are stated to the dollar. */
export function money(v: number): string {
  return '$' + Math.round(v).toLocaleString('en-US');
}

/** Millions, to one decimal — the unit Northline's capital figures are held in. */
export function moneyM(v: number): string {
  return '$' + v.toFixed(1) + 'M';
}

export function tons(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' t';
}

const signed = (v: number, body: string) => (v >= 0 ? '+' : '') + body;

/**
 * A value written the way its field declares.
 *
 * The fallback is the value as text rather than a guess: a field the dataset says nothing about is one
 * whose format nobody stated, and inventing a currency for it would be the invented-figure failure this
 * repo keeps refusing. A numeric field with no declared format still reads as a number.
 */
export function fmt(key: string, v: unknown): string {
  const how: ValueFormat | undefined = FORMATS[key];
  if (v === null || v === undefined || v === '') return '—';

  switch (how) {
    case 'money':
      return money(Number(v));
    case 'moneyM':
      return moneyM(Number(v));
    case 'signedMoneyM':
      return signed(Number(v), moneyM(Math.abs(Number(v))));
    case 'percent':
      return Number(v).toFixed(0) + '%';
    case 'signedPercent':
      return signed(Number(v), Math.abs(Number(v)).toFixed(0) + '%');
    case 'tons':
      return tons(Number(v));
    case 'int':
      return Number(v).toLocaleString('en-US');
    case 'yesno':
      return v ? 'Yes' : 'No';
    case 'text':
      return String(v);
    default:
      break;
  }

  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (field(key)?.kind === 'num' && typeof v === 'number') return v.toLocaleString('en-US');
  return String(v);
}

/** The unit the register's money is held in, for a caption that would otherwise be ambiguous. */
export function unitNote(): string {
  return UNIT;
}

export function labelize(key: string, v: string | boolean): string {
  return fmt(key, v);
}

/** Categorical display value for a row — what filters match against. */
export function catVal(p: Row, key: string): string {
  const v = p[key];
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v ?? '');
}

export function numVal(p: Row, key: string): number {
  return Number(p[key] ?? 0);
}

/** Distinct values a categorical field takes, for the filter menu. */
export function catValues(rows: Row[], key: string): string[] {
  return Array.from(new Set(rows.map((p) => catVal(p, key)))).sort();
}

export type Tone = 'over' | 'warn' | 'ok';

/**
 * A row's tone, from the field the dataset nominates as its state — or none.
 *
 * EPA nominates `risk` (`high`/`med`/`low`); Northline nominates `status` (`Delayed`/`At risk`/`On
 * track`). A tenant that nominates nothing gets no tone, and a bar is drawn in one colour rather than
 * in a colour that means something it never said. **A hue that encodes a state the data does not carry
 * is the mistake this repo refuses on chips, on nodes and here.**
 */
const TONE_BY_VALUE: Record<string, Tone> = {
  high: 'over',
  med: 'warn',
  low: 'ok',
  Delayed: 'over',
  'At risk': 'warn',
  'On track': 'ok',
};

export function rowTone(p: Row): Tone | null {
  if (!TONE_FIELD) return null;
  return TONE_BY_VALUE[String(p[TONE_FIELD] ?? '')] ?? null;
}

export function rowPill(p: Row): 'bad' | 'warn' | 'ok' | null {
  const tone = rowTone(p);
  return tone === 'over' ? 'bad' : tone === 'warn' ? 'warn' : tone === 'ok' ? 'ok' : null;
}

/** The value that names a row — the label on a bar, the first cell of a table. */
export function rowLabel(p: Row): string {
  return String(p[LABEL_FIELD] ?? '');
}

export function pct(v: number, max: number): string {
  if (max <= 0) return '0%';
  return Math.max(v > 0 ? 2 : 0, (v / max) * 100).toFixed(1) + '%';
}
