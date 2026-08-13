import { field, fieldLabel, fmt, numVal, riskPill } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, Generator, MeasureKey } from '../../types';

function Cell({ p, col }: { p: Generator; col: string }) {
  if (col === 'generator') {
    return (
      <td>
        {p.generator}
        <div className="sub">
          {p.evals} evaluations · last enforcement {p.last_enf || '—'}
        </div>
      </td>
    );
  }
  if (col === 'risk') {
    return (
      <td>
        <span className={'pill ' + riskPill(p.risk)}>{fmt('risk', p.risk)}</span>
      </td>
    );
  }
  if (col === 'cd') {
    return <td>{p.cd ? <span className="pill warn">Decree</span> : <span className="pill ok">None</span>}</td>;
  }
  const isNum = field(col)?.kind === 'num';
  const raw = (p as unknown as Record<string, unknown>)[col];
  return <td className={isNum ? 'num' : undefined}>{fmt(col, raw)}</td>;
}

export function TableBlock({ block, rows, measure }: { block: Block; rows: Generator[]; measure: MeasureKey }) {
  const cols = block.cols ?? ['generator', 'state', 'risk', 'viols', 'penalty', 'cd'];
  const ranked = rankBy(rows, measure);

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {ranked.length} generator{ranked.length === 1 ? '' : 's'} · sorted by {fieldLabel(measure).toLowerCase()}
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
            <tr key={p.generator}>
              {cols.map((c) => (
                <Cell key={c} p={p} col={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length === 0 && <div className="emptyBlock">No generators match this slice.</div>}
      {ranked.length > 0 && (
        <div className="footNote">
          Totals across these rows: {fmt('penalty', ranked.reduce((t, p) => t + p.penalty, 0))} penalty exposure ·{' '}
          {fmt('tons', ranked.reduce((t, p) => t + p.tons, 0))} received · {ranked.reduce((t, p) => t + numVal(p, 'manifests'), 0)}{' '}
          manifests.
        </div>
      )}
    </div>
  );
}
