import React from 'react'
import { Empty } from './BlockFrame.jsx'

/* ──────────────────────────────────────────────────────────────── BUBBLE ──
   x, y and r are each a figure with its own coordinate; the axes are labelled
   with their basis, and the quadrant lines carry their stated meaning.

   THE AXES CARRY NO NUMERIC TICKS. Producing them would mean this file inventing
   number formatting — and that is not a technicality: the resolver's fmt() is
   where scale, sign and currency live, and a second formatter in the browser is
   a second answer. Each axis is anchored at its ends with the SERVED display
   string of the extreme point on that axis, which is a real formatted figure
   that came from the resolver. The quadrant lines are labelled with their
   meaning rather than their value, which is what the reader is reading them for.
   ========================================================================== */
export default function Bubble({ block: b }) {
  const pts = b.points || []
  const ax = b.axes || []
  const AX = d => ax.filter(a => a.dim === d)[0] || {}

  if (!pts.length) return (
    <Empty>
      No projects your data access admits are plotted here. That is an answer, not an error.
    </Empty>
  )

  const ext = d => {
    const vs = pts.map(p => (p[d] || {}).raw).filter(v => typeof v === 'number')
    return { lo: Math.min.apply(null, vs), hi: Math.max.apply(null, vs) }
  }
  const X = ext('x'), Y = ext('y'), R = ext('r')
  const q = b.quadrant || {}
  const padx = ((X.hi - X.lo) || 1) * 0.08
  const pady = ((Y.hi - Y.lo) || 1) * 0.10
  const x0 = Math.min(X.lo - padx, q.xAt != null ? q.xAt : X.lo)
  const x1 = Math.max(X.hi + padx, q.xAt != null ? q.xAt : X.hi)
  const y0 = Math.min(Y.lo - pady, q.yAt != null ? q.yAt : Y.lo)
  const y1 = Math.max(Y.hi + pady, q.yAt != null ? q.yAt : Y.hi)
  const px = v => ((v - x0) / ((x1 - x0) || 1)) * 100
  const py = v => 100 - ((v - y0) / ((y1 - y0) || 1)) * 100
  /* Area, not radius: a value twice as large drawn at twice the radius reads as
     four times as much. */
  const pr = v => 5 + Math.sqrt(Math.max(0, v - R.lo) / ((R.hi - R.lo) || 1)) * 15

  const cats = []
  pts.forEach(p => { if (p.colorBy && cats.indexOf(p.colorBy) < 0) cats.push(p.colorBy) })

  const endLabel = (d, which) => {
    const want = which === 'lo' ? Math.min : Math.max
    const v = want.apply(null, pts.map(p => (p[d] || {}).raw))
    const hit = pts.filter(p => (p[d] || {}).raw === v)[0]
    return hit ? (hit[d] || {}).display : ''
  }

  const axLabel = d => AX(d).label || d
  const figLine = (p, d) =>
    axLabel(d) + ': ' + ((p[d] || {}).display || '') + ' · ' + ((p[d] || {}).coordStated || '')

  return (
    <>
      <div className="bub">
        <div className="bubYl">
          <b>{AX('y').label || ''}</b>
          <span>{AX('y').coordStated || ''}</span>
        </div>

        <div className="bubPlot">
          {q.yAt != null ? <i className="bubQL h" style={{ top: py(q.yAt).toFixed(2) + '%' }} /> : null}
          {q.xAt != null ? <i className="bubQL v" style={{ left: px(q.xAt).toFixed(2) + '%' }} /> : null}

          {(q.labels && q.xAt != null && q.yAt != null)
            ? ['tl', 'tr', 'bl', 'br'].map(k => (
              <span className={'bubQ ' + k} key={k}>
                {q.labels[k] || ''}
                {(q.counts && q.counts[k] != null) ? <> <b>{q.counts[k]}</b></> : null}
              </span>
            ))
            : null}

          {pts.map((p, i) => {
            const ci = Math.max(0, cats.indexOf(p.colorBy)) % 8
            const tip = [p.label, figLine(p, 'x'), figLine(p, 'y'), figLine(p, 'r'),
              p.quadrantLabel || ''].filter(Boolean).join('\n')
            const d = pr((p.r || {}).raw) * 2
            return (
              <i className={'bubPt sc' + ci} key={p.label || i} title={tip} style={{
                left: px((p.x || {}).raw).toFixed(2) + '%',
                top: py((p.y || {}).raw).toFixed(2) + '%',
                width: d.toFixed(1) + 'px',
                height: d.toFixed(1) + 'px',
              }} />
            )
          })}
        </div>

        <div className="bubYe lo">{endLabel('y', 'lo')}</div>
        <div className="bubYe hi">{endLabel('y', 'hi')}</div>
        <div className="bubXax">
          <span>{endLabel('x', 'lo')}</span>
          <span>{endLabel('x', 'hi')}</span>
        </div>
        <div className="bubXl">
          <b>{AX('x').label || ''}</b>
          <span>{AX('x').coordStated || ''}</span>
        </div>
      </div>

      <div className="bubLeg">
        {cats.map((c, i) => <span key={c}><i className={'sc' + (i % 8)} />{c}</span>)}
        <span className="bubR">
          bubble size — {AX('r').label || ''}
          <em>{AX('r').coordStated || ''}</em>
        </span>
      </div>

      {q.why ? (
        <div className="bubWhy"><b>Why the quadrants are where they are.</b> {q.why}</div>
      ) : null}
      {b.axesNote ? <div className="mini" style={{ marginTop: 9 }}>{b.axesNote}</div> : null}
      {b.admitted != null ? (
        <div className="mini">
          {b.admitted} project{b.admitted === 1 ? '' : 's'} plotted — every one your data access
          admits and that carries all three figures.
        </div>
      ) : null}
    </>
  )
}
