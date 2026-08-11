import type { AnswerBlock } from '../api/client'
import './AnswerBlocks.css'

/*
 * Charts for an answer, drawn by hand in SVG.
 *
 * No chart library, for the reason the ontology canvas has none and the mock
 * server has no dependencies: the audit gate makes a package expensive, and four
 * chart forms are less code than the argument for adding one.
 *
 * **The form is chosen by the data's job, not by the `chart` field.** The query
 * set names a kind, and its own note says the rendering team picks the library —
 * so where a named kind would be unreadable, the job wins:
 *
 *   bar                → horizontal bars. Labels here are facility names; a
 *                        vertical axis of those is unreadable at any width.
 *   line               → line over time, 2px, with a marked and labelled peak.
 *   pie, ≤ 4 slices    → a 100% stacked bar. Part-to-whole, and a stack compares
 *                        the shares that a pie makes the eye estimate.
 *   pie, > 4 slices    → horizontal bars. Past ~7 classes the guidance is a
 *                        table or bars, never more colours; the 10-slice
 *                        waste-code pie is the case this exists for, and its
 *                        answer already ships a table beside it.
 *   donut, 2 slices    → a meter. A single ratio against a whole is a meter, not
 *                        a two-slice donut.
 *
 * Colour does one job each time. A single-series magnitude chart is ONE hue —
 * length already encodes the value, so varying hue per bar would imply an
 * identity the data does not have. Only the stacked bar is categorical, and its
 * four hues are the validated set (blue, orange, aqua, yellow) in fixed order,
 * with every segment directly labelled because their contrast against the surface
 * is below 3:1.
 *
 * Status colours never appear here: a share is not a state.
 */

/** One hue for magnitude, and its light track. Not the brand — that means "act". */
const DATA_HUE = '#2a78d6'
const DATA_TRACK = '#e6eefb'
/** Fixed order, never cycled. Four is the cap this file needs; a fifth is a bar chart. */
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const

/* Ink comes from the stylesheet — text wears text tokens, never a series hue —
   so only the grid and the two data colours are needed here. */
const GRID = '#eef1f5'

type ChartBlock = Extract<AnswerBlock, { type: 'chart' }>

/** 27310.8 → "27,310.8"; 0.42 → "0.42". Never scientific notation in a chart. */
const num = (v: number) =>
  Math.abs(v) >= 1000 || Number.isInteger(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : String(v)

export default function AnswerChart({ block }: { block: ChartBlock }) {
  const data = block.data
  const form =
    block.chart === 'line'
      ? 'line'
      : block.chart === 'donut' && data.length === 2
        ? 'meter'
        : (block.chart === 'pie' || block.chart === 'donut') && data.length <= 4
          ? 'stack'
          : 'bars'

  return (
    <figure className="ab-chart">
      <figcaption className="ab-chart-title">{block.title}</figcaption>
      {form === 'bars' ? <Bars block={block} /> : null}
      {form === 'line' ? <Line block={block} /> : null}
      {form === 'stack' ? <Stack block={block} /> : null}
      {form === 'meter' ? <Meter block={block} /> : null}
      {block.note ? <p className="ab-chart-note">{block.note}</p> : null}
      {/*
        The table view the guidance requires: identity is never colour-alone, and
        a reader who cannot use the chart can still read every value.
      */}
      <details className="ab-chart-data">
        <summary>Values</summary>
        <table>
          <thead>
            <tr>
              <th>{block.x_label ?? 'Item'}</th>
              <th>{block.y_label ?? 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="ab-num">{num(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars, one hue, value labelled at the end of each. */
function Bars({ block }: { block: ChartBlock }) {
  const data = block.data
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  const ROW = 20
  const GAP = 5
  const LABEL_W = 150
  const VALUE_W = 66
  const width = 520
  const plot = width - LABEL_W - VALUE_W
  const height = data.length * (ROW + GAP)

  return (
    <svg
      className="ab-svg"
      viewBox={`0 0 ${width} ${height}`}
      /*
       * Capped at its own viewBox width, so the drawing is never scaled *up*.
       * `width: 100%` with `height: auto` had it filling the answer column — on a
       * wide screen that meant a 2.5× upscale, and an SVG upscales its text with
       * everything else, so 11px labels rendered at nearly 30px. It still shrinks
       * below this width, which is the direction that has to keep working.
       */
      style={{ maxWidth: width }}
      role="img"
      aria-label={`${block.title}. ${data.length} values, largest ${data[0]?.label ?? ''}.`}
    >
      {data.map((d, i) => {
        const y = i * (ROW + GAP)
        // 2px shy of full width so adjacent fills never touch, per the spec.
        const w = Math.max(2, (d.value / max) * (plot - 2))
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${num(d.value)}`}</title>
            <text x={LABEL_W - 8} y={y + ROW / 2 + 4} textAnchor="end" className="ab-cat">
              {/* Sized to the narrower label column, so a name is elided rather
                  than overrunning into the bars. */}
              {d.label.length > 23 ? `${d.label.slice(0, 22)}…` : d.label}
            </text>
            <rect x={LABEL_W} y={y + 4} width={plot} height={ROW - 8} rx="3" fill={GRID} />
            {/* Rounded only at the data end; the baseline end stays square so the
                bar reads as anchored rather than floating. */}
            <path
              d={`M${LABEL_W} ${y + 4} h${w - 4} a4 4 0 0 1 4 4 v${ROW - 16} a4 4 0 0 1 -4 4 h${-(w - 4)} z`}
              fill={DATA_HUE}
            />
            <text x={LABEL_W + plot + 8} y={y + ROW / 2 + 4} className="ab-val">
              {num(d.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** A line over time, with the peak marked and labelled — not every point. */
function Line({ block }: { block: ChartBlock }) {
  const data = block.data
  const width = 520
  const height = 170
  const PAD = { top: 16, right: 16, bottom: 26, left: 48 }
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const max = Math.max(...data.map((d) => d.value)) || 1
  const min = Math.min(...data.map((d) => d.value), 0)
  const x = (i: number) => PAD.left + (i / Math.max(1, data.length - 1)) * plotW
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min || 1)) * plotH
  const peak = data.reduce((a, d) => (d.value > a.value ? d : a), data[0])
  const peakIndex = data.indexOf(peak)

  return (
    <svg
      className="ab-svg"
      viewBox={`0 0 ${width} ${height}`}
      /* Same cap as the bars, for the same reason. */
      style={{ maxWidth: width }}
      role="img"
      aria-label={`${block.title}. ${data.length} points, peak ${peak?.label} at ${num(peak?.value ?? 0)}.`}
    >
      {/* Three gridlines, recessive — enough to read a level, few enough to ignore. */}
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + plotH * t}
            y2={PAD.top + plotH * t}
            stroke={GRID}
            strokeWidth="1"
          />
          <text x={PAD.left - 8} y={PAD.top + plotH * t + 4} textAnchor="end" className="ab-axis">
            {num(min + (max - min) * (1 - t))}
          </text>
        </g>
      ))}

      <polyline
        points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ')}
        fill="none"
        stroke={DATA_HUE}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {data.map((d, i) => (
        <circle key={d.label} cx={x(i)} cy={y(d.value)} r="4" fill={DATA_HUE}>
          <title>{`${d.label}: ${num(d.value)}`}</title>
        </circle>
      ))}
      {/* The peak gets a 2px surface ring so it reads over the line, and a label. */}
      {peak ? (
        <>
          <circle
            cx={x(peakIndex)}
            cy={y(peak.value)}
            r="5"
            fill={DATA_HUE}
            stroke="#fff"
            strokeWidth="2"
          />
          <text
            x={Math.min(x(peakIndex), width - PAD.right - 60)}
            y={Math.max(y(peak.value) - 10, 12)}
            className="ab-val"
          >
            {num(peak.value)}
          </text>
        </>
      ) : null}

      {/* First and last only: 14 quarter labels would collide. */}
      {[0, data.length - 1].map((i) =>
        data[i] ? (
          <text
            key={i}
            x={x(i)}
            y={height - 10}
            textAnchor={i === 0 ? 'start' : 'end'}
            className="ab-axis"
          >
            {data[i].label}
          </text>
        ) : null,
      )}
    </svg>
  )
}

/** Part-to-whole as one 100% bar, every segment directly labelled. */
function Stack({ block }: { block: ChartBlock }) {
  const total = block.data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <div className="ab-stack">
      <div className="ab-stack-bar" role="img" aria-label={`${block.title}, as shares of the total.`}>
        {block.data.map((d, i) => (
          <span
            key={d.label}
            className="ab-stack-seg"
            style={{
              width: `${(d.value / total) * 100}%`,
              background: CATEGORICAL[i % CATEGORICAL.length],
            }}
            title={`${d.label}: ${num(d.value)}`}
          />
        ))}
      </div>
      {/* A legend AND the share on each row: the fills sit below 3:1 against the
          surface, which obliges a visible label rather than colour alone. */}
      <ul className="ab-legend">
        {block.data.map((d, i) => (
          <li key={d.label}>
            <span
              className="ab-swatch"
              style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
              aria-hidden="true"
            />
            <span className="ab-legend-label">{d.label}</span>
            <span className="ab-num">
              {num(d.value)} · {((d.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One ratio against the whole — a track and a fill, from the same hue. */
function Meter({ block }: { block: ChartBlock }) {
  const [first, second] = block.data
  const total = first.value + second.value || 1
  const share = (first.value / total) * 100
  return (
    <div className="ab-meter">
      <div
        className="ab-meter-track"
        style={{ background: DATA_TRACK }}
        role="img"
        aria-label={`${first.label}: ${share.toFixed(1)} percent of ${num(total)}.`}
      >
        <span
          className="ab-meter-fill"
          style={{ width: `${share}%`, background: DATA_HUE }}
        />
      </div>
      <div className="ab-meter-rows">
        <span>
          <strong>{share.toFixed(1)}%</strong> {first.label} · {num(first.value)}
        </span>
        <span className="ab-num">
          {second.label} · {num(second.value)}
        </span>
      </div>
    </div>
  )
}
