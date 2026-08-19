import React, { useEffect, useRef, useState } from 'react'
import { useReportState } from './ReportState.jsx'

/* ═════════════════════════════════════════════════════════════ FILTER BAR ══
   ONLY THE DIMENSIONS THE SPEC DECLARED, with domains resolved from the fact set
   and a row count per value. No free-form filter surface — if any viewer could
   filter on anything, every viewer's report is a different question and the
   approved spec stops describing what people actually read.

   ONE STICKY BAR. There were two strips before: a row of dropdown chips, and
   beneath it a "Showing …" row repeating the same selections as removable tags.
   Together with the title and the trust line that put four bands of chrome above
   the first number, and the two filter bands said the same thing twice — the only
   thing the second row added was a × and the population count. Both now live on
   the chip itself and at the right-hand end of the bar, and the bar sticks so the
   filters stay reachable when the reader has scrolled to the figure they are
   questioning.

   ── WHAT A SELECTION DOES IN THIS BUILD ────────────────────────────────────
   In the product, changing a selection re-aggregates the rows that were ALREADY
   SERVED — no source is queried again, which is why the change is instant — and a
   coordinate param (the period, the plan adoption, which project) re-resolves.
   Both go through the resolver.

   This build ships one resolved run per report. So the menus open, the domains and
   their per-value row counts are shown — that is served information a reader wants
   before spending a click — and choosing a value states what it would take rather
   than silently redrawing the same numbers. The prototype's own comments are
   emphatic about the alternative: a control that accepts a click and leaves the
   screen byte-identical lets the reader conclude the report is stuck.
   ========================================================================== */
export default function FilterBar({ view: v }) {
  const ps = v.params || []
  const vts = v.viewTypes || []
  const [openMenu, setOpenMenu] = useState(null)
  const { setPop, toast } = useReportState()
  const barRef = useRef(null)

  useEffect(() => {
    const away = e => {
      if (barRef.current && !barRef.current.contains(e.target)) setOpenMenu(null)
    }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [])

  if (!ps.length && !vts.length) return null

  /* COUNTS ONLY WHAT CLEARING WOULD ACTUALLY REMOVE. A coordinate param is always
     in force, so summing every selection made an untouched report open on "Clear
     1 filter" — a control naming a filter the reader had not set, which on being
     pressed removed nothing and left the button still reading "Clear 1 filter".
     The count and the promise now agree: no clearable selection, no button. */
  const activeCount = ps.reduce((n, p) => n + (p.single ? 0 : (p.selected || []).length), 0)
  const narrowed = v.rowsAdmitted !== v.rowsScoped

  const lockedWhy = (e, label, why) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setPop({
      title: label + ' — fixed for this report',
      body: why,
      rule: 'Shown fixed rather than hidden. A control you cannot find is a defect; a control that '
        + 'tells you why it will not move is a decision you can argue with.',
      x: Math.min(r.left, window.innerWidth - 340),
      y: r.bottom + window.scrollY + 8,
    })
  }

  return (
    <div className="filtBar" id="repFiltBar" ref={barRef}>
      {vts.length ? (
        <div className="fgroup vt">
          <span className="fglbl">View</span>
          {/* Served as bare strings on this payload — the spec's declared
              re-aggregation axes. The one in force is the report's own grain, so
              none is lit: lighting one would claim a selection the reader did not
              make. */}
          {vts.map(t => {
            const label = typeof t === 'string' ? t : t.label
            const enabled = typeof t === 'string' ? true : t.enabled
            const id = typeof t === 'string' ? t : t.id
            return (
              <button className={'vtChip' + (id === v.viewType ? ' on' : '') + (enabled ? '' : ' lk')}
                      key={id}
                      onClick={e => enabled
                        ? reaggregateRefused(e, toast, 'View by ' + label)
                        : lockedWhy(e, label, t.disabledReason)}>
                {label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="fgroup">
        {ps.map(p => p.locked
          ? <LockedChip p={p} onWhy={lockedWhy} key={p.id} />
          : (
            <ParamChip p={p} key={p.id}
                       open={openMenu === p.id}
                       onToggle={() => setOpenMenu(m => (m === p.id ? null : p.id))}
                       onPick={() => { setOpenMenu(null); reaggregateRefusedToast(toast, p) }} />
          ))}
      </div>

      <div className="fspace" />
      <div className={'fCount' + (narrowed ? ' narrowed' : '')}
           title="Rows admitted by your data access AND your current filters, out of the rows this report makes available to you">
        <b>{v.rowsAdmitted}</b> of {v.rowsScoped} available projects
      </div>
    </div>
  )
}

/* An active chip carries its own value and its own ×. Inactive it is one button;
   active it becomes a two-part control, so the reader never has to open a menu to
   find out what a filter is currently set to.

   A COORDINATE HAS NO ×, BECAUSE THERE IS NOTHING TO CLEAR IT TO. `single` is
   served for params with no 'All' in their vocabulary — the period, the plan
   adoption, which project. One of their values is always in force by definition:
   they are the coordinate the report is resolved at, not a filter over it. The
   chip showed a × anyway, and pressing it deleted the id and re-ran — whereupon
   the default fell back and put the identical value straight back. The control
   rendered, accepted the click, and left the screen byte-identical. */
function ParamChip({ p, open, onToggle, onPick }) {
  const on = (p.selected || []).length > 0
  const clearable = on && !p.single
  return (
    <div className={'fWrap' + (on ? ' fTag' : '') + (p.single ? ' coord' : '')}>
      <button className={'fBtn' + (on ? ' on' : '')}
              onClick={e => { e.stopPropagation(); onToggle() }}>
        <i className="fi">{p.icon || '◦'}</i>
        <span>{p.chipLabel || p.label}</span>
        <i className="fcar">▾</i>
      </button>
      {clearable ? (
        <button className="fx" title={'Clear ' + p.label}
                onClick={e => { e.stopPropagation(); onPick() }}>×</button>
      ) : null}
      <div className={'fMenu' + (open ? ' open' : '')}>
        {open ? <ParamMenu p={p} onPick={onPick} /> : null}
      </div>
    </div>
  )
}

/* The menu is built from the domain the SERVER resolved — counts included, so a
   viewer can see a value exists and holds two rows before they spend a click on
   it.

   AN OPTION WITH NO ROWS IS DIMMED, NOT REMOVED, and it says which kind of empty
   it is. "Your other filters exclude it", "this report does not cover it" and
   "your access has none of these" lead to three different next actions and a grey
   zero says none of them. Removing the option would be worse than all three: a
   reader who knows their portfolio has PFAS projects and cannot find PFAS in the
   list concludes the data is missing. */
function ParamMenu({ p, onPick }) {
  const [q, setQ] = useState('')
  const sel = p.selected || []
  const values = p.values || []
  const ql = q.trim().toLowerCase()
  const shown = ql ? values.filter(x => String(x.label).toLowerCase().indexOf(ql) > -1) : values

  return (
    <>
      <div className="fmHead">
        {p.label}
        <span className="mini">{p.n} value{p.n === 1 ? '' : 's'} in your data</span>
      </div>
      {values.length > 8 ? (
        <input className="fmFind" placeholder="Find…" value={q}
               onChange={e => setQ(e.target.value)} onClick={e => e.stopPropagation()} />
      ) : null}
      <div className="fmList">
        {shown.length ? shown.map(x => (
          <button className={'fmOpt' + (sel.indexOf(x.value) > -1 ? ' on' : '')
            + (x.empty ? ' none' : '') + (x.absent || x.outOfSpec ? ' gone' : '')}
                  key={String(x.value)} title={x.why || undefined}
                  onClick={e => { e.stopPropagation(); onPick(x) }}>
            <i className="fmBox">{sel.indexOf(x.value) > -1 ? '✓' : ''}</i>
            <span>{x.label}</span><b>{x.n}</b>
          </button>
        )) : (
          <div className="mini" style={{ padding: '8px 11px' }}>
            No value here matches “{q}”.
          </div>
        )}
      </div>
      {p.single ? (
        <div className="fmFoot">
          <span className="mini">
            One at a time — this report is written for a single {String(p.label).toLowerCase()}.
          </span>
        </div>
      ) : null}
      {/* A refresh param is not a filter, and the menu says so in the fixture's
          own words. Changing it moves a coordinate — the period frame, the
          record/projection split — so every figure re-resolves rather than the
          same figures being re-added up. A control that looks like a filter and
          is not teaches the viewer the wrong thing about the number underneath. */}
      {p.requiresRefresh && p.note ? (
        <div className="fmFoot">
          <span className="mini"><b>Re-runs the report.</b> {p.note}</span>
        </div>
      ) : null}
    </>
  )
}

/* NO PADLOCK GLYPH — the dashed border already carries it. The padlock read as a
   permission denial, something being kept from the reader, when the fact it states
   is much smaller: this report is scoped to one value of this dimension and the
   value is on the chip. The affordance itself stays; the chip still takes a click
   and answers with the served reason. What is gone is a glyph that made an
   ordinary scoping decision look like a governance refusal, on a surface that has
   real governance refusals elsewhere and needs the distinction to stay legible. */
function LockedChip({ p, onWhy }) {
  return (
    <div className="fWrap">
      <button className="fBtn lk" title="Fixed for this report — press to see why"
              onClick={e => onWhy(e, p.label, p.lockedReason)}>
        <i className="fi">{p.icon || '◦'}</i>
        <span>{p.label}: {p.current || '—'}</span>
        <i className="fcar">?</i>
      </button>
    </div>
  )
}

const REAGG_MSG = 'Re-aggregating needs the resolver. In the product this narrows the rows that were '
  + 'already served — no source is queried again — and a coordinate re-resolves the run. This build '
  + 'ships one resolved run per report, so the selection is shown rather than applied.'

function reaggregateRefused(e, toast, what) {
  e.stopPropagation()
  toast(what + ' — ' + REAGG_MSG, 'warn')
}
function reaggregateRefusedToast(toast, p) {
  toast(p.label + ' — ' + REAGG_MSG, 'warn')
}
