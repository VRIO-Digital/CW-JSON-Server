import { LABEL_FIELD, MEASURE_KEYS, META } from '../../data';
import { fieldLabel, fmt, numVal, pct, rowLabel, rowTone } from '../../lib/format';
import { rankBy } from '../../lib/select';
import type { Block, MeasureKey, Row } from '../../types';

const TOP_N = 12;

/*
 * The line form, ported from the package's own prototype rather than invented.
 *
 * Hand-drawn SVG, like every other chart in this app: an area under the trace so the shape
 * reads at a glance, the polyline itself, and a point per row so the reader can see how
 * many there are. The geometry is the prototype's — a 620×180 box with a 24-unit pad — and the
 * only change is that `n === 1` centres its single point instead of dividing by zero.
 *
 * `preserveAspectRatio="none"` is deliberate: the box stretches to the panel's width while the
 * height stays fixed, which is what keeps the trace readable in a narrow column.
 */
const LINE = { w: 620, h: 180, pad: 24 };

function LineChart({ points, measure, max }: { points: Row[]; measure: MeasureKey; max: number }) {
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
      aria-label={`${fieldLabel(measure)} across ${n} ${META.entity_plural}, highest first`}
    >
      <path
        d={`M${pad},${h - pad} L${pts.join(' L')} L${w - pad},${h - pad} Z`}
        fill="var(--orange-soft)"
      />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--orange)" strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle key={rowLabel(p)} cx={x(i)} cy={y(numVal(p, measure))} r={3.5} fill="var(--orange)" />
      ))}
    </svg>
  );
}

/**
 * One chart over the register.
 *
 * **Every EPA name is gone from it.** The measure defaulted to `penalty`, the row label was
 * `p.generator`, the bar tone was `p.risk` and the caption said "bar colour is compliance risk" — so
 * pointed at a register of capital projects it drew a chart about neither. The measure now defaults to
 * the first the dataset offers, the label comes from the field the dataset nominates, and the tone
 * comes from the field it nominates as a state **or from nothing at all**: a tenant that names no
 * state field gets one colour, because a hue that encodes a state the data does not carry is the
 * mistake this repo refuses on chips and on graph nodes too. The caption says which of the two it is.
 */
export function ChartBlock({ block, rows }: { block: Block; rows: Row[] }) {
  const measure: MeasureKey = block.measure ?? MEASURE_KEYS[0] ?? LABEL_FIELD;
  const ranked = rankBy(rows, measure).filter((p) => numVal(p, measure) > 0);
  const shown = ranked.slice(0, TOP_N);
  const max = shown.length ? numVal(shown[0], measure) : 0;
  const toned = shown.some((p) => rowTone(p) !== null);
  const noun = META.entity_plural || 'rows';

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {shown.length
          ? `Top ${shown.length} of ${rows.length} in scope · ranked by ${fieldLabel(measure).toLowerCase()}` +
            (toned ? ' · bar colour is delivery state' : '')
          : `Ranked by ${fieldLabel(measure).toLowerCase()}`}
      </div>

      {shown.length === 0 && (
        <div className="emptyBlock">
          Nothing to plot — nothing in this slice has a non-zero {fieldLabel(measure).toLowerCase()}.
        </div>
      )}

      {block.chartType === 'line' && shown.length > 0 ? (
        <LineChart points={shown} measure={measure} max={max} />
      ) : block.chartType === 'column' ? (
        <div className="cols">
          {shown.map((p) => (
            <div className="col" key={rowLabel(p)}>
              <div className="colV">{fmt(measure, numVal(p, measure))}</div>
              <div
                className={'colBar' + (rowTone(p) === 'over' ? ' over' : '')}
                style={{ height: Math.max(4, (numVal(p, measure) / max) * 140) }}
              />
              <div className="colN">{rowLabel(p)}</div>
            </div>
          ))}
        </div>
      ) : (
        shown.map((p) => (
          <div className="barRow" key={rowLabel(p)}>
            <div className="nm" title={rowLabel(p)}>
              {rowLabel(p)}
            </div>
            <div className="barTrack">
              {/* One colour where the tenant names no state field — see the note above. */}
              <div
                className={'barFill ' + (rowTone(p) ?? 'ok')}
                style={{ width: pct(numVal(p, measure), max) }}
              />
            </div>
            <div className={'barVal' + (rowTone(p) === 'over' ? ' bad' : '')}>
              {fmt(measure, numVal(p, measure))}
            </div>
          </div>
        ))
      )}

      {ranked.length > shown.length && (
        <div className="footNote">
          {ranked.length - shown.length} further {noun} with a non-zero{' '}
          {fieldLabel(measure).toLowerCase()} are not plotted — they&rsquo;re all in the table below.
        </div>
      )}
    </div>
  );
}
