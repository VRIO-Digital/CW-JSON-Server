import { FIELDS, LABEL_FIELD, META, MEASURE_KEYS, UNIT } from '../../data';
import { field, fieldLabel, fmt, numVal, rowLabel, rowPill } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, MeasureKey, Row } from '../../types';

/**
 * One cell, marked by the column it sits in — and the marks are the dataset's, not EPA's.
 *
 * It used to special-case `generator`, `risk` and `cd` by name, which meant three EPA columns rendered
 * richly and every other tenant's rendered as bare text. What survives is the *shape* of those three
 * decisions, keyed on what the dataset declares rather than on a field name: the row's own label field
 * gets no pill and no sub-line it cannot fill, the field nominated as the row's **state** renders as a
 * tinted pill, and a boolean renders as a pair of pills rather than the word "false".
 */
function Cell({ p, col, toneField }: { p: Row; col: string; toneField: string | null }) {
  if (col === LABEL_FIELD) return <td>{rowLabel(p)}</td>;

  if (toneField && col === toneField) {
    const pill = rowPill(p);
    return (
      <td>
        <span className={'pill ' + (pill ?? 'rp-neutral')}>{fmt(col, p[col])}</span>
      </td>
    );
  }

  const raw = p[col];
  if (typeof raw === 'boolean') {
    return <td>{raw ? <span className="pill warn">Yes</span> : <span className="pill ok">No</span>}</td>;
  }

  const isNum = field(col)?.kind === 'num';
  return <td className={isNum ? 'num' : undefined}>{fmt(col, raw)}</td>;
}

/**
 * The register, as a table.
 *
 * **The default columns and the footer total were EPA's**, so a tenant without `penalty` or `tons` got
 * a table whose totals line read `$NaN`. The defaults now come from the dataset — the label field plus
 * whatever it says its measures are — and the footer states the total of **each measure actually in
 * the table**, which is the only set it can honestly add up.
 */
export function TableBlock({
  block,
  rows,
  measure,
}: {
  block: Block;
  rows: Row[];
  measure: MeasureKey;
}) {
  const toneField = FIELDS.some((f) => f.key === 'status') ? 'status' : null;
  const cols = block.cols ?? [LABEL_FIELD, ...MEASURE_KEYS.slice(0, 4)].filter(Boolean);
  const ranked = rankBy(rows, measure);
  const noun = META.entity_plural || 'rows';

  /* Only the numeric columns on screen — a total for a column nobody asked for is noise, and a
     total for a column the register does not carry is `NaN`. */
  const totalled = cols.filter((c) => field(c)?.kind === 'num');

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {ranked.length} {ranked.length === 1 ? noun.replace(/s$/, '') : noun} · sorted by{' '}
        {fieldLabel(measure).toLowerCase()}
        {UNIT ? ` · money in ${UNIT.toLowerCase()}` : ''}
      </div>
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className={field(c)?.kind === 'num' ? 'num' : undefined}>
                {fieldLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ranked.map((p) => (
            <tr key={rowLabel(p)}>
              {cols.map((c) => (
                <Cell key={c} p={p} col={c} toneField={toneField} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && <div className="emptyBlock">Nothing matches this slice.</div>}
      {ranked.length > 0 && totalled.length > 0 && (
        <div className="footNote">
          Totals across these rows:{' '}
          {totalled
            .map((c) => `${fmt(c, ranked.reduce((t, p) => t + numVal(p, c), 0))} ${fieldLabel(c).toLowerCase()}`)
            .join(' · ')}
          .
        </div>
      )}
    </div>
  );
}
