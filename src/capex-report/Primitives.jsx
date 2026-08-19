/* ==========================================================================
   The small shared pieces every block renderer reaches for.
   ========================================================================== */
import React from 'react'
import { useReportState } from './ReportState.jsx'

/* ── THE PER-FIGURE PROVENANCE MARKER ───────────────────────────────────────
   UNLABELLED, deliberately. It used to print the measure name inside a bordered
   chip, which put sixteen labelled buttons on the dashboard, all opening the
   same drawer, most repeating a caption written directly underneath.

   Coverage did not drop with the ink. Every figure keeps its own marker because
   every figure has its own walk — Actual spend and % complete come from
   different systems through different joins, and one report-level button would
   have to pick one of them and call it the answer. That button exists too, in
   the trust bar, for the reader with no particular figure in mind.

   It stays in the DOM at full size for keyboard and screen-reader users rather
   than appearing on hover: an affordance you can only find with a mouse is not
   an affordance for everyone.

   WHAT CHANGED IN THE PORT. The prototype passed the opaque `prov` handle to
   getProvenance() and the server said which measure it was. There is no server
   here, and parsing a measure out of the handle is exactly what the handle
   exists to prevent — so the marker takes the `measure` key the resolver already
   serves beside every figure. Same destination, no invented round trip. */
export function ProvMark({ measure, label }) {
  const { linDispatch } = useReportState()
  const what = label ? String(label).slice(0, 40) : 'this figure'
  if (!measure) return null
  return (
    <button
      type="button" className="prov provMark"
      title={`Where ${what} came from`}
      aria-label={`Show how ${what} was produced`}
      onClick={e => {
        e.stopPropagation()
        linDispatch({ type: 'figure', keys: [measure], label: label || 'figure' })
      }}
    >◈</button>
  )
}

/* A masked figure is not a zero and not an empty cell. It says the section ran,
   the figure exists, and it is not yours to see — which is a different answer
   from "no data". */
export const Masked = ({ reason, children }) => (
  <span className="masked" title={reason || 'masked by scope'}>{children || 'masked'}</span>
)

/* The prototype's `.note` band, with its glyph in the slot the stylesheet
   expects. `kind` is one of plain | info | ok | warn | bad. */
export const Note = ({ kind = 'plain', glyph, title, children, style }) => (
  <div className={'note ' + kind} style={style}>
    <span>{glyph || (kind === 'warn' ? '⚠' : kind === 'ok' ? '✓' : kind === 'bad' ? '⛔' : 'ⓘ')}</span>
    <div className="body">{title ? <b>{title}</b> : null}{children}</div>
  </div>
)

/* ── A STATED REFUSAL, NOT A DEAD CONTROL ───────────────────────────────────
   Four things on these pages need the resolver and cannot have it in a build
   that ships the resolver's OUTPUT: refreshing, re-aggregating through a filter
   selection, generating an export file, and answering a question on the ask
   surface.

   The prototype's own rule about this is quoted in its source more than once —
   a control that fakes success is worse than one that says what it will not do,
   and a control that quietly fails lets the reader conclude the report is stuck.
   So each of those four says this, in the reader's language, naming what would
   have to run. */
export const NeedsResolver = ({ title, children }) => (
  <div className="needsResolver">
    <span>◔</span>
    <div><b>{title}</b>{children}</div>
  </div>
)

export function Toasts() {
  const { toasts } = useReportState()
  return (
    <div id="toasts">
      {toasts.map(t => (
        <div key={t.id} className={'toast on' + (t.type && t.type !== 'ok' ? ' ' + t.type : '')}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

/* The anchored popover. Position comes from the click, because the thing it
   explains is the thing that was clicked. */
export function ProvPopover() {
  const { pop, setPop } = useReportState()
  if (!pop) return null
  return (
    <div className="pvPop open" style={{ left: pop.x, top: pop.y }}>
      <h4>{pop.title}
        <button className="pvX" onClick={() => setPop(null)}>×</button>
      </h4>
      {pop.body ? <div className="pvDef">{pop.body}</div> : null}
      {pop.rule ? <div className="pvRule">{pop.rule}</div> : null}
    </div>
  )
}

/* The prototype's modal overlay. Closing on the backdrop and on Escape, because
   a dialog you can only leave through one 12px glyph is the complaint people
   file first. */
export function Modal({ title, sub, wide, onClose, children }) {
  React.useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay open" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3>{title}</h3>
          <button className="modalX" onClick={onClose} aria-label="Close">×</button>
        </div>
        {sub ? <div className="msub">{sub}</div> : null}
        {children}
      </div>
    </div>
  )
}
