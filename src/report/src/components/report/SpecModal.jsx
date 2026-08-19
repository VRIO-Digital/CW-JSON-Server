import React from 'react'
import { Modal, Note } from '../Primitives.jsx'
import { reportById } from '../../lib/db.js'

/* ══════════════════════════════════════════════════════════ THE SPECIFICATION ══
   THE STORED ARTIFACT IS THE SPEC, AND IT HOLDS NO FIGURES.

   It names which measure, at which coordinate, at which grain, over which filter.
   The numbers exist only when the resolver runs it against the fact set under the
   viewer's predicate — which is why the same spec can show fifty rows to one
   person and none to another without being two reports, and why a refresh changes
   the answer without changing the definition.

   Shown as the JSON the API returns rather than as a prettified summary, because
   this dialog exists for the reader who wants to check that the report is what it
   claims to be, and a summary is one more thing that can drift.
   ========================================================================== */
export default function SpecModal({ view: v, onClose }) {
  const s = reportById(v.reportId)

  return (
    <Modal title="Report specification" wide onClose={onClose}
           sub={'The stored artifact is this spec — a question, a binding and a set of blocks. No '
             + 'numbers are stored in it. Every figure you saw was resolved at view time against the '
             + 'viewer’s scope predicate.'}>
      <Note kind="plain" glyph="◈" style={{ marginBottom: 14 }} title="This is the whole report">
        Not one number in it. Figures exist only when this spec is executed against the fact set
        under a viewer’s predicate — which is why the same spec can show fifty rows to one person and
        none to another without being two reports.
      </Note>

      {s ? (
        <>
          <div className="specBox"><Highlight value={s} /></div>
          <div className="mini" style={{ marginTop: 11 }}>
            Version {s.version} · author {s.author} ·{' '}
            {s.approvedBy ? 'approved by ' + s.approvedBy : 'not approved'}
            {(v.publication || {}).selfApproval ? ' (self-approval recorded)' : ''} · audience{' '}
            {(s.audience || []).length} roles
          </div>
        </>
      ) : (
        <div className="empty">No stored spec is carried for this report id.</div>
      )}
    </Modal>
  )
}

/* Syntax highlight for the spec. Cosmetic, and built by TOKENISING the serialised
   JSON rather than by regex-replacing markup into it — the prototype escaped
   first and then substituted spans, which is safe, and this is the same guarantee
   arrived at without producing markup at all. */
function Highlight({ value }) {
  const text = JSON.stringify(value, null, 2)
  const out = []
  /* key | string | number/bool/null | everything else */
  const re = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*(?:e[+-]?\d+)?|true|false|null)/gi
  let last = 0, m, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) {
      out.push(<span className="k" key={i++}>{m[1]}</span>)
      out.push(m[2])
    } else if (m[3]) {
      out.push(<span className="s" key={i++}>{m[3]}</span>)
    } else {
      out.push(<span className="n" key={i++}>{m[4]}</span>)
    }
    last = re.lastIndex
  }
  out.push(text.slice(last))
  return <>{out}</>
}
