import React, { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Shell from '../components/Shell.jsx'
import ReportView from '../components/report/ReportView.jsx'
import LineageDrawer from '../components/report/LineageDrawer.jsx'
import SpecModal from '../components/report/SpecModal.jsx'
import ExportModal from '../components/report/ExportModal.jsx'
import { Note } from '../components/Primitives.jsx'
import { useReportState } from '../state/ReportState.jsx'
import { reportBySlug, resolvedById, personaOf } from '../lib/db.js'

/* ══════════════════════════════════════════════════════════════ ONE REPORT ══
   Ordered for someone answering a business question, not for someone auditing the
   architecture. Three things sit above the numbers — the title, what you can vary,
   and one line of trust context. Everything an auditor needs is one click into the
   lineage drawer, in full, rather than sprayed across the reading path.

   THE PAGE IS THE SAME PAGE FOR ALL THREE REPORTS. The prototype's three
   standalone HTML files are one file with a different `REPORT_ID` on one line, and
   the reason that worked is that dispatch is on block type and no renderer looks at
   the report id. That property is what this route inherits: a fourth report added
   to db.json gets a page without a line of code here changing.
   ========================================================================== */
export default function ReportPage() {
  const { slug } = useParams()
  const [search] = useSearchParams()
  const { modal, setModal, lin, linDispatch } = useReportState()

  const spec = reportBySlug(slug)
  const view = spec ? resolvedById(spec.id) : null

  /* Closing the drawer and any modal on navigation. A drawer left open across a
     report change would show the previous report's lineage under the new report's
     title, which is worse than a closed one. */
  useEffect(() => {
    linDispatch({ type: 'close' })
    setModal(null)
    window.scrollTo({ top: 0 })
  }, [slug, linDispatch, setModal])

  /* Escape closes whichever overlay is open, outermost last. */
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape') return
      if (modal) setModal(null)
      else if (lin.open) linDispatch({ type: 'close' })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [modal, lin.open, setModal, linDispatch])

  if (!spec || !view) {
    return (
      <Shell crumb={<><Link to="/">Reports</Link> / <b>Not found</b></>}>
        <Note kind="warn" title="No report is published at this address">
          The library lists what this build carries. A report id in the fixture with no resolved run
          behind it would open on an empty page, so it is refused here rather than drawn hollow.
          <div style={{ marginTop: 11 }}>
            <Link className="btn sec sm" to="/">← All reports</Link>
          </div>
        </Note>
      </Shell>
    )
  }

  /* A COORDINATE MAY ARRIVE IN THE URL, from the calendar's drill into Project
     360. The run this build carries is resolved at one coordinate; if the URL asks
     for another, say so on the page rather than showing one project's figures
     under another project's name. */
  const seedMismatch = findSeedMismatch(view, search)

  return (
    <Shell persona={personaOf(view)} scopeLabel={(view.scope || {}).predicateBusinessLanguage}
           crumb={<><Link to="/">Reports</Link> / <b>{view.name}</b></>}>
      <Link className="tinyBtn" style={{ marginBottom: 14, display: 'inline-block' }} to="/">
        ← All reports
      </Link>

      <ReportView view={view} seedMismatch={seedMismatch} />

      <LineageDrawer view={view} onShowSpec={() => setModal('spec')} />

      {modal === 'spec' ? <SpecModal view={view} onClose={() => setModal(null)} /> : null}
      {modal === 'export' ? <ExportModal view={view} onClose={() => setModal(null)} /> : null}
    </Shell>
  )
}

/* The comparison is against `activeParams`, which is the resolver's own record of
   what the run was resolved at — not against a param's `selected`, which a spec
   default can populate without the run being narrowed to it. */
function findSeedMismatch(view, search) {
  const active = view.activeParams || {}
  for (const [key, value] of search.entries()) {
    const have = active[key]
    if (!have) continue
    const haveList = Array.isArray(have) ? have : [have]
    if (haveList.indexOf(value) > -1) continue
    /* Say it in the label the report uses for the coordinate, not in the raw id. */
    const p = (view.params || []).find(x => x.id === key) || {}
    const labelOf = v => (p.labels && p.labels[v]) || v
    return {
      param: String(p.label || key).toLowerCase(),
      have: haveList.map(labelOf).join(', '),
      want: labelOf(value),
    }
  }
  return null
}
