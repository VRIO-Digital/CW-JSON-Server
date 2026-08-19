import React from 'react'
import { Failure } from './BlockFrame.jsx'

/* ──────────────────────────────────────────────────────────────── CHARTS ──
   One block type, three presentations, chosen by `b.chartType` — stacked,
   grouped, share. The presentation is a property of the SPEC, so changing it is
   a versioned spec edit rather than a viewer's private view state, and the same
   chart looks the same to everyone who opens the report.

   NOT DRAWN HERE: a trend. The fixture is a position as at an as-of date, not a
   time series, and a line through four category values is a picture of nothing.
   The prototype's author-side toggle lists the line as unavailable-with-reason
   rather than drawing a lie; this build has no authoring surface, so the toggle
   is absent rather than present and inert.

   Every value is pre-scaled and pre-formatted by the resolver. Geometry is
   computed from `raw`, because a bar POSITION is not a number a reader reads;
   every CHARACTER comes from a served `display` or `exact`.

   `baseline` is deliberately NOT a fourth series: it sits on a different
   coordinate, and drawing a commitment-basis series inside a projection-basis
   stack is precisely the mixed-coordinate failure publish validation blocks
   elsewhere. The chart must not do by default what the platform refuses.
   ========================================================================== */
export default function Bar({ block: b }) {
  if (b.failure) return <Failure block={b} />

  const axis   = b.axis || []
  const series = b.series || []
  const base   = b.baseline || null
  const at = (s, i) => (s.values || [])[i] || {}

  /* ── A KNOWN MISMATCH IN THE SOURCE, REPRODUCED ON PURPOSE ─────────────────
     The renderer's vocabulary is stacked | grouped | share. The SPECS use a
     different one: `rep_q_variance` block b1a says `column` and `rep_proj_360`
     block b3b says `group`, and the resolver passes both straight through. Neither
     matches, so both fall to `stacked` — which is what the three standalone HTML
     pages actually draw today.

     It matters most on b3b. That block is captioned "how it moved between
     adoptions" and its two series are Working plan and Mid-term plan: two
     VINTAGES of the same money, alternatives to be compared, not components to be
     summed. Stacked, the bars imply an addition that would double-count the
     programme. Nothing wrong is PRINTED — `stackTotalCombines` is false there, so
     no column total appears and the caption underneath says the sum is not
     available — but the picture reads as composition when it is a comparison.

     Left as-is because the deliverable is that this port renders what the HTML
     renders. Accepting 'group' and 'column' as aliases is a one-line change here
     (see the two comparisons below) and is a change in behaviour from the source,
     which is the kind of decision that belongs to whoever owns the fixtures. */
  const mode = b.chartType === 'grouped' ? 'grouped'
             : b.chartType === 'share'   ? 'share'
             : 'stacked'

  const colTotal = i => series.reduce((n, s) => n + (at(s, i).raw || 0), 0)
  const tops     = axis.map((_, i) => colTotal(i))
  const baseVals = base ? axis.map((_, i) => (at(base, i).raw || 0)) : []
  const hi = Math.max.apply(null, tops.concat(baseVals).concat([1]))
  const H  = v => (v / hi) * 100

  /* `share` has no absolute axis — a commitment-basis baseline line and a
     per-column total both stop meaning anything against a normalised column, so
     both are dropped in that mode rather than drawn at a coordinate that is no
     longer there. */
  const showBase = base && mode !== 'share'
  /* The per-column total prints ONLY when the segments combine. When they do
     not, the stack is still readable as composition and the number that would
     sit on top of it would be a lie. */
  const showTot = b.stackTotalCombines === true && mode === 'stacked'

  /* A series whose coordinate differs from the block's is the thing worth saying
     out loud, and it is said once per series rather than in a footnote. */
  const odd = series.filter(s => s.coordStated && b.coordStated && s.coordStated !== b.coordStated)

  const seg = (s, si, i, heightPct, extra) => (
    <i key={si} className={'sc' + si} style={{ height: heightPct + '%' }}
       title={`${s.label} · ${axis[i]} — ${at(s, i).exact || at(s, i).display || ''}${extra || ''}`} />
  )

  const columnInner = i => {
    if (mode === 'grouped') {
      return <div className="stkGroup">{series.map((s, si) => seg(s, si, i, H(at(s, i).raw || 0)))}</div>
    }
    if (mode === 'share') {
      const tot = colTotal(i) || 1
      return <div className="stkStack">{series.map((s, si) => {
        const sh = ((at(s, i).raw || 0) / tot) * 100
        return seg(s, si, i, sh, ` (${sh.toFixed(0)}% of period)`)
      })}</div>
    }
    return <div className="stkStack">{series.map((s, si) => seg(s, si, i, H(at(s, i).raw || 0)))}</div>
  }

  return (
    <div className={'stk stk-' + mode}>
      <div className="stkPlot">
        {showBase ? (
          <div className="stkBase" aria-hidden="true">
            {axis.map((_, i) => {
              const y = H(baseVals[i])
              const next = i < axis.length - 1 ? H(baseVals[i + 1]) : null
              return (
                <React.Fragment key={i}>
                  <i className="stkBpt"
                     style={{ left: ((i + 0.5) / axis.length) * 100 + '%', bottom: y + '%' }} />
                  {next == null ? null : (
                    <i className="stkBseg" style={{
                      left: ((i + 0.5) / axis.length) * 100 + '%',
                      bottom: Math.min(y, next) + '%',
                      width: (1 / axis.length) * 100 + '%',
                      height: Math.abs(next - y) + '%',
                      '--dir': next >= y ? 1 : -1,
                    }} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        ) : null}
        <div className="stkCols">
          {axis.map((a, i) => (
            <div className="stkCol" key={i}>
              {columnInner(i)}
              {showTot ? <div className="stkTot">{stackTotalDisplay(series, i)}</div> : null}
              <div className="stkX">{String(a)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="cLegend">
        {series.map((s, si) => (
          <span key={si}><i className={'sc' + si} />{s.label}
            {s.total ? <> <b>{s.total.display}</b></> : null}</span>
        ))}
        {showBase ? (
          <span><i className="lineMk" />{base.label}
            {base.total ? <> <b>{base.total.display}</b></> : null} — a line, not a bar</span>
        ) : null}
      </div>

      {mode === 'share' ? (
        <div className="stkNoTot">Shown as share of each period — every column totals 100%, so the
          bars read as composition, not amount. The absolute figures are in the legend and the
          table.</div>
      ) : (mode === 'stacked' && b.stackTotalCombines !== true) ? (
        <div className="stkNoTot">No column total. These series do not combine at one coordinate, so
          a number on top of the stack would be an addition the platform will not make. The stack is
          readable as composition; the sum is not available here.</div>
      ) : null}

      {odd.length ? (
        <div className="stkCoord">
          {odd.map((s, i) => <span key={i}><b>{s.label}</b> is {s.coordStated}</span>)}
          <span>everything else is {b.coordStated}</span>
        </div>
      ) : b.coordStated ? (
        <div className="stkCoord">
          <span>{b.coordStated}{b.axisLabel ? ' · ' + b.axisLabel : ''}</span>
        </div>
      ) : null}
    </div>
  )
}

/* The only place a column total could be composed rather than served. It is not:
   when every segment carries an `exact`, the total is the SERVED total of the
   series that reaches this far, and when it cannot be found the cell says
   nothing rather than adding the segments up in the browser. */
function stackTotalDisplay(series, i) {
  const vals = series.map(s => (s.values || [])[i] || {})
  const served = vals.filter(v => v.stackTotal != null)[0]
  if (served) return served.stackTotal
  const t = vals.filter(v => v.columnTotal != null)[0]
  return t ? t.columnTotal : ''
}
