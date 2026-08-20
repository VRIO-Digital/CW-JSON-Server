import type { AnswerBlock } from '../../api/client'
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
 *   column             → vertical bars, for the one case horizontal loses: a short label
 *                        over a series that reads left to right, like a quarter. The
 *                        report section asks for this by name on quarterly volumes; a
 *                        long label still gets `bar`.
 *   grouped            → paired vertical columns with a legend, for two measures over the
 *                        same rows. The one form that is categorical by *series*: the
 *                        scorecard's evaluations and violations are a comparison, and two
 *                        separate charts make it two findings instead of one.
 *   line               → line over time, 2px, with a marked and labelled peak.
 *   pie, ≤ 4 slices    → a 100% stacked bar. Part-to-whole, and a stack compares
 *                        the shares that a pie makes the eye estimate.
 *   pie, > 4 slices    → horizontal bars. Past ~7 classes the guidance is a
 *                        table or bars, never more colours; the 10-slice
 *                        waste-code pie is the case this exists for, and its
 *                        answer already ships a table beside it.
 *   donut, 2–4 slices  → a ring, every slice named in the legend. It was a meter, and a
 *                        meter reads as *progress toward* something — a share of inbound
 *                        tonnage is not progress, and the package draws a donut.
 *
 * Colour does one job each time. A single-series magnitude chart is ONE hue —
 * length already encodes the value, so varying hue per bar would imply an
 * identity the data does not have. Two things may vary it, and both are named on the
 * drawing: a point's **tone**, which is a state (a generator's compliance risk), and a
 * **series** on a grouped chart, which is a measure and gets a legend. Otherwise only the
 * stacked bar is categorical, and its four hues are the validated set (blue, orange, aqua,
 * yellow) in fixed order, with every segment directly labelled because their contrast against
 * the surface is below 3:1.
 *
 * Status colours never appear here: a share is not a state.
 */

/** One hue for magnitude, and its light track. Not the brand — that means "act". */
const DATA_HUE = '#2a78d6'
/*
 * The exception, and the only one: a data point may carry a **tone**, which is a state — the
 * register's bars are coloured by compliance risk, as the package's own report colours them.
 * Length still encodes the value, the caption says what the colour means, and the table beside
 * the chart repeats the tier as a tag with an icon and a word, so nothing is colour-alone.
 */
const TONE_HUE = { good: '#1a8a5a', warn: '#b06a00', crit: '#c0392b' } as const
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
    /* Two series over the same rows. The only form here that is categorical by *series*
       rather than by slice, which is why it is the only one with a legend of measures. */
    block.chart === 'grouped' && (block.series?.length ?? 0) > 1
      ? 'grouped'
      : block.chart === 'line'
        ? 'line'
      : /* Columns where few enough labels fit under them — a name is elided to fit, which
             works for four generators and not for thirty-six. Past that a vertical axis of
             names is the thing horizontal bars exist to avoid. */
        block.chart === 'column' && data.length <= 8
        ? 'columns'
        : /* An explicit donut of two to four slices is drawn as a ring, each slice labelled
             in the legend. It replaced a meter: a meter reads as progress toward something,
             and a share of inbound tonnage is not progress. */
          block.chart === 'donut' && data.length >= 2 && data.length <= 4
          ? 'ring'
          : block.chart === 'pie' && data.length <= 4
            ? 'stack'
            : 'bars'

  return (
    <figure className="ab-chart">
      <figcaption className="ab-chart-title">{block.title}</figcaption>
      {form === 'bars' ? <Bars block={block} /> : null}
      {form === 'columns' ? <Columns block={block} /> : null}
      {form === 'grouped' ? <Grouped block={block} /> : null}
      {form === 'line' ? <Line block={block} /> : null}
      {form === 'stack' ? <Stack block={block} /> : null}
      {form === 'ring' ? <Ring block={block} /> : null}
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
              {/* One column per series where there are several, so the table under a grouped
                  chart carries the same numbers the drawing does. */}
              {block.series && block.series.length > 1 ? (
                block.series.map((s) => <th key={s.key}>{s.label}</th>)
              ) : (
                <th>{block.y_label ?? 'Value'}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                {block.series && block.series.length > 1 ? (
                  block.series.map((s) => (
                    <td key={s.key} className="ab-num">
                      {num(d.values?.[s.key] ?? 0)}
                    </td>
                  ))
                ) : (
                  <td className="ab-num">{num(d.value)}</td>
                )}
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
  /* The payload may ask for a wider drawing — a report card is the page's full width, where
     an answer's column is not. Absent, the answer's own width stands. */
  const width = block.width ?? 520
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
              fill={d.tone ? TONE_HUE[d.tone] : DATA_HUE}
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

/**
 * Vertical bars, one hue, the value above each.
 *
 * The mirror of `Bars`, and it exists for one case: a short label under a series that reads
 * left to right. Every bar is labelled on both axes, so nothing here depends on colour.
 */
function Columns({ block }: { block: ChartBlock }) {
  const data = block.data
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  const width = 520
  const height = 200
  const PAD = { top: 22, right: 8, bottom: 30, left: 8 }
  const plotH = height - PAD.top - PAD.bottom
  const slot = (width - PAD.left - PAD.right) / Math.max(1, data.length)
  const barW = Math.min(slot - 6, 34)

  return (
    <svg
      className="ab-svg"
      viewBox={`0 0 ${width} ${height}`}
      /* Capped at its own viewBox width, for the reason every other chart here is. */
      style={{ maxWidth: width }}
      role="img"
      aria-label={`${block.title}. ${data.length} values, largest ${
        data.reduce((a, d) => (d.value > a.value ? d : a), data[0])?.label ?? ''
      }.`}
    >
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * plotH)
        const x = PAD.left + i * slot + (slot - barW) / 2
        const y = PAD.top + plotH - h
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${num(d.value)}`}</title>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="3"
              /*
               * Four or fewer columns, each with its own label beneath it, take the categorical
               * hues — which is how the package draws its four decree-bound generators. Past
               * that the hue would be decoration on a series the eye already reads by length,
               * so it stays one colour.
               */
              /*
               * Identity first at four columns or fewer, tone after.
               *
               * The package colours its four decree-bound generators by *which generator*, and
               * its thirty-six-row register by risk tier — so with a handful of directly
               * labelled columns the hue names the row, and beyond that it names the state.
               * Either way the tier is a tag in the table beside the chart, never colour alone.
               */
              fill={
                data.length <= 4
                  ? CATEGORICAL[i % CATEGORICAL.length]
                  : d.tone
                    ? TONE_HUE[d.tone]
                    : DATA_HUE
              }
            />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="ab-val">
              {num(d.value)}
            </text>
            <text
              x={x + barW / 2}
              y={height - 10}
              textAnchor="middle"
              className="ab-axis"
            >
              {/* Elided rather than rotated: a row of angled names is harder to read than a
                  shortened one, and the values table carries the full label. */}
              {d.label.length > 16 ? `${d.label.slice(0, 15)}…` : d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Two measures per row, as paired vertical columns with a legend.
 *
 * The one chart here that is categorical by **series**: each measure gets one of the validated
 * hues, in fixed order, and the legend names both — so the colour says which measure, never
 * which value. Gridlines and a labelled axis, because comparing two heights across five rows
 * is what this form is for; the values table below repeats every figure.
 */
function Grouped({ block }: { block: ChartBlock }) {
  const series = block.series ?? []
  const data = block.data
  const width = block.width ?? 520
  const height = 260
  const PAD = { top: 34, right: 12, bottom: 34, left: 34 }
  const plotH = height - PAD.top - PAD.bottom
  const max =
    Math.max(...data.flatMap((d) => series.map((s) => d.values?.[s.key] ?? 0)), 0) || 1
  const slot = (width - PAD.left - PAD.right) / Math.max(1, data.length)
  const barW = Math.min((slot - 12) / series.length, 26)

  return (
    <svg
      className="ab-svg"
      viewBox={`0 0 ${width} ${height}`}
      /* Capped at its own viewBox width, like every other drawing here. */
      style={{ maxWidth: width }}
      role="img"
      aria-label={`${block.title}. ${series.map((s) => s.label).join(' and ')} across ${data.length} rows.`}
    >
      {/* Three gridlines and their levels — enough to read a height, few enough to ignore. */}
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
          <text x={PAD.left - 6} y={PAD.top + plotH * t + 4} textAnchor="end" className="ab-axis">
            {num(max * (1 - t))}
          </text>
        </g>
      ))}

      {/* The legend, inside the drawing where the package puts it. */}
      {series.map((s, si) => (
        <g key={s.key}>
          <circle cx={PAD.left + 8 + si * 170} cy={14} r="5" fill={CATEGORICAL[si % CATEGORICAL.length]} />
          <text x={PAD.left + 18 + si * 170} y={18} className="ab-cat">
            {s.label}
          </text>
        </g>
      ))}

      {data.map((d, i) => (
        <g key={d.label}>
          {series.map((s, si) => {
            const v = d.values?.[s.key] ?? 0
            const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH)
            const x = PAD.left + i * slot + (slot - barW * series.length) / 2 + si * barW
            return (
              <g key={s.key}>
                <title>{`${d.label} · ${s.label}: ${num(v)}`}</title>
                <rect
                  x={x}
                  y={PAD.top + plotH - h}
                  width={barW - 2}
                  height={h}
                  rx="2"
                  fill={CATEGORICAL[si % CATEGORICAL.length]}
                />
              </g>
            )
          })}
          <text
            x={PAD.left + i * slot + slot / 2}
            y={height - 12}
            textAnchor="middle"
            className="ab-axis"
          >
            {/* Elided rather than rotated: a row of angled names is harder to read than a
                shortened one, and the values table carries the full label. */}
            {d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label}
          </text>
        </g>
      ))}
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

/**
 * A ring: part-to-whole for two to four slices, each directly labelled.
 *
 * Drawn as one circle with a dashed stroke per slice, because that needs no arc maths and no
 * library. It replaced a meter — a meter reads as *progress toward* something, and a share of
 * inbound tonnage is not progress; the package draws a donut and the legend names both sides.
 */
function Ring({ block }: { block: ChartBlock }) {
  const total = block.data.reduce((s, d) => s + d.value, 0) || 1
  const size = 210
  const r = 74
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="ab-ring">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ maxWidth: size }}
        role="img"
        aria-label={`${block.title}. ${block.data
          .map((d) => `${d.label} ${((d.value / total) * 100).toFixed(1)} percent`)
          .join(', ')}.`}
      >
        {block.data.map((d, i) => {
          const share = d.value / total
          const dash = share * circumference
          const el = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={CATEGORICAL[i % CATEGORICAL.length]}
              strokeWidth="26"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              /* Twelve o'clock, clockwise — where a reader starts on a dial. */
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${d.label}: ${num(d.value)}`}</title>
            </circle>
          )
          offset += dash
          return el
        })}
      </svg>
      {/* The legend and the share on each row: the fills sit below 3:1 against the surface,
          which obliges a visible label rather than colour alone. */}
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

