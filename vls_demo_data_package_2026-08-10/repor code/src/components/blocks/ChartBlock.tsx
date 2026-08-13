import { fieldLabel, fmt, numVal, pct, riskTone } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, Generator, MeasureKey } from '../../types';

const TOP_N = 12;

export function ChartBlock({ block, rows }: { block: Block; rows: Generator[] }) {
  const measure: MeasureKey = block.measure ?? 'penalty';
  const ranked = rankBy(rows, measure).filter((p) => numVal(p, measure) > 0);
  const shown = ranked.slice(0, TOP_N);
  const max = shown.length ? numVal(shown[0], measure) : 0;

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {shown.length
          ? `Top ${shown.length} of ${rows.length} in scope · ranked by ${fieldLabel(measure).toLowerCase()} · bar colour is compliance risk`
          : `Ranked by ${fieldLabel(measure).toLowerCase()}`}
      </div>

      {shown.length === 0 && (
        <div className="emptyBlock">
          Nothing to plot — no generator in this slice has a non-zero {fieldLabel(measure).toLowerCase()}.
        </div>
      )}

      {block.chartType === 'column' ? (
        <div className="cols">
          {shown.map((p) => (
            <div className="col" key={p.generator}>
              <div className="colV">{fmt(measure, numVal(p, measure))}</div>
              <div
                className={'colBar' + (p.risk === 'high' ? ' over' : '')}
                style={{ height: Math.max(4, (numVal(p, measure) / max) * 140) }}
              />
              <div className="colN">{p.generator}</div>
            </div>
          ))}
        </div>
      ) : (
        shown.map((p) => (
          <div className="barRow" key={p.generator}>
            <div className="nm" title={p.generator}>
              {p.generator}
            </div>
            <div className="barTrack">
              <div className={'barFill ' + riskTone(p.risk)} style={{ width: pct(numVal(p, measure), max) }} />
            </div>
            <div className={'barVal' + (p.risk === 'high' ? ' bad' : '')}>{fmt(measure, numVal(p, measure))}</div>
          </div>
        ))
      )}

      {ranked.length > shown.length && (
        <div className="footNote">
          {ranked.length - shown.length} further generators with a non-zero {fieldLabel(measure).toLowerCase()} are not
          plotted — they're all in the table below.
        </div>
      )}
    </div>
  );
}
