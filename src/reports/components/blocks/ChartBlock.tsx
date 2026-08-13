import { fieldLabel, fmt, numVal, pct, riskTone } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, Generator, MeasureKey } from '../../types';

const TOP_N = 12;

/*
 * The line form, ported from the package's own prototype rather than invented.
 *
 * Hand-drawn SVG, like every other chart in this app: an area under the trace so the shape
 * reads at a glance, the polyline itself, and a point per generator so the reader can see how
 * many there are. The geometry is the prototype's — a 620×180 box with a 24-unit pad — and the
 * only change is that `n === 1` centres its single point instead of dividing by zero.
 *
 * `preserveAspectRatio="none"` is deliberate: the box stretches to the panel's width while the
 * height stays fixed, which is what keeps the trace readable in a narrow column.
 */
const LINE = { w: 620, h: 180, pad: 24 };

function LineChart({
  points,
  measure,
  max,
}: {
  points: Generator[];
  measure: MeasureKey;
  max: number;
}) {
  const { w, h, pad } = LINE;
  const n = points.length;
  const x = (i: number) => pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v: number) => h - pad - (h - 2 * pad) * (max === 0 ? 0 : v / max);
  const pts = points.map((p, i) => `${x(i)},${y(numVal(p, measure))}`);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: '100%', height: 200 }}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${fieldLabel(measure)} across ${n} generators, highest first`}
    >
      <path
        d={`M${pad},${h - pad} L${pts.join(' L')} L${w - pad},${h - pad} Z`}
        fill="var(--orange-soft)"
      />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--orange)" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle
          key={p.generator}
          cx={x(i)}
          cy={y(numVal(p, measure))}
          r={3.5}
          fill="var(--orange)"
        />
      ))}
    </svg>
  );
}

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

      {block.chartType === 'line' && shown.length > 0 ? (
        <LineChart points={shown} measure={measure} max={max} />
      ) : block.chartType === 'column' ? (
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
