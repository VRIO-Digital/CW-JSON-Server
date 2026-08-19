import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import {
  reports, reportDrafts, removedReports, resolvedById, personaOf, people, statusLabel,
} from '../lib/db.js'

/* ══════════════════════════════════════════════════════════════ THE LIBRARY ══
   A report here is a saved, governed, RE-EXECUTABLE QUESTION — not a chart with
   numbers stored inside it. That is why the same report renders differently for
   each viewer, why every figure can name its source, and why a refresh changes the
   answer without changing the definition.

   THE CARD CARRIES NO ROW COUNT, and that is deliberate rather than a gap:
   producing one means resolving every report to draw a list of cards, and a card
   that shows a number has already delivered the figure the scope gate exists to
   withhold. What it carries instead is the one thing a reader needs BEFORE opening
   — the as-of floor, the version, who wrote it, how many personas are entitled and
   how often it refreshes.

   TWO GATES, NEVER MERGED, and the bar at the top names them separately because
   they are separate decisions: whether this persona is an audience for the report
   at all, and which rows their predicate admits. A reader who cannot tell those
   apart cannot tell an empty report from a forbidden one.
   ========================================================================== */
export default function LibraryPage() {
  const [category, setCategory] = useState('all')

  /* The persona is read off a resolved run rather than picked here. Every run in
     this build was resolved for the same session, which is how the three
     standalone pages were produced. */
  const anyView = resolvedById(reports[0].id)
  const persona = personaOf(anyView)

  const cats = []
  reports.forEach(r => { if (cats.indexOf(r.category) < 0) cats.push(r.category) })
  const rows = category === 'all' ? reports : reports.filter(r => r.category === category)

  return (
    <Shell persona={persona} scopeLabel={(anyView.scope || {}).predicateBusinessLanguage}
           crumb={<><b>Reports</b></>}>
      <div className="pageHead">
        <div>
          <h1>Reports</h1>
          <div className="sub">
            A report here is a saved, governed, re-executable question — not a chart with numbers
            stored inside it. That is why the same report renders differently for each viewer, why
            every figure can name its source, and why a refresh changes the answer without changing
            the definition.
          </div>
        </div>
      </div>

      <div className="entBar">
        <span className="eg">
          <b>①</b> {reports.length} report{reports.length === 1 ? '' : 's'} entitled to{' '}
          <b>{anyView.personaLabel}</b>
        </span>
        <span className="eg">
          <b>②</b> {(anyView.scope || {}).label}
          <code>{(anyView.scope || {}).predicate}</code>
          <span className="dim">{(anyView.scope || {}).predicateBusinessLanguage}</span>
        </span>
      </div>

      <div className="filters" style={{ marginBottom: 14 }}>
        <button className={'fchip' + (category === 'all' ? ' on' : '')}
                onClick={() => setCategory('all')}>
          All <span className="fn">{reports.length}</span>
        </button>
        {cats.map(c => (
          <button key={c} className={'fchip' + (category === c ? ' on' : '')}
                  onClick={() => setCategory(c)}>
            {c} <span className="fn">{reports.filter(r => r.category === c).length}</span>
          </button>
        ))}
      </div>

      <div className="repGrid">
        {rows.map(r => <Card r={r} key={r.id} />)}
      </div>

      {/* DRAFTS ARE LISTED AND ARE NOT OPENABLE HERE. They are unpublished, in
          nobody's audience, and the authoring surface that would open them is not
          part of this build — so they are named with their blocker rather than
          given a button that goes nowhere. */}
      {reportDrafts.length ? (
        <>
          <div className="sectLbl">Drafts — not published, not visible to any audience</div>
          <div className="list">
            {reportDrafts.map(d => (
              <div className="rowCard" key={d.id}>
                <div className="rowTop">
                  <b style={{ fontSize: 13 }}>{d.name}</b>
                  <span className="pill neu">{d.state || 'draft'}</span>
                  <span className="mini" style={{ marginLeft: 'auto' }}>
                    {(people[d.author] || {}).name || d.author}
                  </span>
                </div>
                <div className="rowSub">{d.note || ''}</div>
                <div className="mini" style={{ marginTop: 6 }}>
                  {d.blocks} block{d.blocks === 1 ? '' : 's'}
                  {d.basedOn ? ' · based on ' + d.basedOn : ''}
                  {d.supersededBy ? ' · superseded by ' + d.supersededBy : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* A REMOVED REPORT IS STILL A LIFECYCLE STATE, not an absence. Listing it
          is what stops a reader who remembers it concluding the library lost it. */}
      {removedReports.length ? (
        <>
          <div className="sectLbl">Removed from this package</div>
          <div className="list">
            {removedReports.map(r => (
              <div className="rowCard" key={r.id}>
                <div className="rowTop">
                  <b style={{ fontSize: 13 }}>{r.name}</b>
                  <span className={'stChip st-' + r.status}>{statusLabel(r.status)}</span>
                  <span className="mini" style={{ marginLeft: 'auto' }}>v{r.version}</span>
                </div>
                <div className="rowSub">{r.subtitle}</div>
                {r.approvalNote ? (
                  <div className="mini" style={{ marginTop: 6 }}>{r.approvalNote}</div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Shell>
  )
}

function Card({ r }) {
  const v = resolvedById(r.id)
  /* The as-of on the card is computed by the SAME RULE the viewer will see —
     taken off the resolved run rather than recomputed here, so the card and the
     trust bar cannot disagree about which dataset is holding the report back. */
  const asOf = (v || {}).asOf || {}
  const author = people[r.author] || {}
  const selfApproved = ((v || {}).publication || {}).selfApproval === true
  const parameterized = ((r.spec || {}).viewParams || []).length > 0

  return (
    <Link className="repCard" to={'/reports/' + r.slug}>
      <div className="rTop">
        <div style={{ flex: 1 }}>
          <div className="rName">{r.name}</div>
          <div className="rQ">“{r.subtitle}”</div>
        </div>
        <span className={'stChip st-' + r.status}>{statusLabel(r.status)}</span>
      </div>

      <div className="rPurpose">{(r.spec || {}).objective || ''}</div>

      <div className="rFresh"
           title="The as-of floor: the OLDEST contributing dataset, computed by the same rule the viewer will see">
        <span className="dot" /> as-of {asOf.display || '—'}
        {asOf.floorName ? (
          <span className="dim">
            {' · '}
            {asOf.datasetCount === 1
              ? 'its only dated input: ' + asOf.floorName
              : 'floor set by ' + asOf.floorName + ' of ' + asOf.datasetCount + ' datasets'}
          </span>
        ) : null}
      </div>

      <div className="rMeta">
        <span>v{r.version}</span><span className="sep">·</span>
        <span>{author.name || r.author}</span><span className="sep">·</span>
        <span>{(r.audience || []).length} persona{(r.audience || []).length === 1 ? '' : 's'} entitled</span>
        <span className="sep">·</span>
        <span>{(r.refresh || {}).label}</span>
        {parameterized ? <><span className="sep">·</span><span>parameterized</span></> : null}
        {r.embeddedAsk ? (
          <><span className="sep">·</span><span style={{ color: 'var(--orange-hi)' }}>✦ ask</span></>
        ) : null}
        {selfApproved ? (
          <><span className="sep">·</span><span style={{ color: 'var(--amber)' }}>self-approved</span></>
        ) : null}
      </div>
    </Link>
  )
}
