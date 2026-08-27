import { META, ROW_MODEL } from '../../data';
import { field, fieldLabel, fmt, numVal, rowLabel, rowPill } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, Generator, MeasureKey } from '../../types';

/**
 * The second line under a row's name, interpolated from the row's own columns.
 *
 * EPA's is "12 evaluations · last enforcement 2025-04-02", which was written into this component and is
 * a sentence only its fixture can fill: a dataset with no `evals` column rendered "undefined evaluations
 * · last enforcement —". It is the dataset's template now, and a dataset that declares none gets no
 * second line rather than an empty one.
 */
function sublabel(p: Generator): string | null {
  const template = ROW_MODEL.sublabel;
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => fmt(key, p[key]));
}

function Cell({ p, col }: { p: Generator; col: string }) {
  /* The four rules a cell follows, in order: the column that names the row, the column that carries its
     state, a column drawn as a yes/no pill, and everything else through the dataset's own format. Each
     was a `col === '<an EPA column>'` branch, which is the same rule with one dataset's names in it. */
  if (col === ROW_MODEL.label) {
    const sub = sublabel(p);
    return (
      <td>
        {rowLabel(p)}
        {sub ? <div className="sub">{sub}</div> : null}
      </td>
    );
  }
  if (col === ROW_MODEL.status) {
    const pill = rowPill(p);
    return (
      <td>
        <span className={'pill ' + (pill ?? '')}>{fmt(col, p[col])}</span>
      </td>
    );
  }
  const pillWords = ROW_MODEL.pills?.[col];
  if (pillWords) {
    return (
      <td>
        {p[col] ? (
          <span className="pill warn">{pillWords.on}</span>
        ) : (
          <span className="pill ok">{pillWords.off}</span>
        )}
      </td>
    );
  }
  const isNum = field(col)?.kind === 'num';
  return <td className={isNum ? 'num' : undefined}>{fmt(col, p[col])}</td>;
}

export function TableBlock({ block, rows, measure }: { block: Block; rows: Generator[]; measure: MeasureKey }) {
  /* The dataset's own default columns: its name, its state, and its measures. EPA's six were written
     here, so a second dataset's table drew six empty columns under six EPA headings. */
  const cols =
    block.cols ??
    [ROW_MODEL.label, ROW_MODEL.status, ...ROW_MODEL.measures.slice(0, 3)].filter(
      (c): c is string => Boolean(c),
    );
  const ranked = rankBy(rows, measure);
  const noun = ranked.length === 1 ? META.entity_singular : META.entity_plural;

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {ranked.length} {noun} · sorted by {fieldLabel(measure).toLowerCase()}
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
                <Cell key={c} p={p} col={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && (
        <div className="emptyBlock">No {META.entity_plural} match this slice.</div>
      )}
      {/*
       * The closing totals are the dataset's own columns and nouns. EPA's read "… penalty exposure ·
       * … received · … manifests", which is three of its columns named in the engine; a dataset
       * without them summed `undefined` and printed `$NaN`. A dataset that declares no footer gets
       * none, which is the right answer for one whose columns do not add up to a sentence.
       */}
      {ranked.length > 0 && ROW_MODEL.footer?.length > 0 && (
        <div className="footNote">
          Totals across these rows:{' '}
          {ROW_MODEL.footer
            .map((f) => `${fmt(f.field, ranked.reduce((t, p) => t + numVal(p, f.field), 0))} ${f.label}`)
            .join(' · ')}
          .
        </div>
      )}
    </div>
  );
}
