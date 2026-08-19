import React, { useState } from 'react'
import { Modal, Note, NeedsResolver } from '../Primitives.jsx'
import { reportById } from '../../lib/db.js'

/* ══════════════════════════════════════════════════════════ EXPORT PRE-FLIGHT ══
   WHAT LEAVES THE BUILDING, BEFORE IT LEAVES.

   An export can never reveal more than the matching on-screen view: it writes out
   the run that is already on the screen, under the same data access and the same
   as-of. It is not a second trip to the sources, because a second path to the same
   numbers is a second place to get someone's permissions wrong.

   EVERYTHING IN THIS DIALOG IS SERVED. The formats come off the report spec, the
   four counts and the watermark off the resolved view — the watermark especially
   is the server's own line and not one this dialog composed, so what the reader
   sees here is byte for byte what the file would carry. An export that leaves
   without its scope and as-of becomes an unattributable number in someone's board
   pack.

   Generating the file is the one part that needs the resolver, and it says so
   rather than offering a button that produces nothing.
   ========================================================================== */
const EXP_DESC = {
  pdf: 'Fixed layout, watermarked with who ran it, what they could see and as of when. What most board packs actually need.',
  xlsx: 'Values only, at the level of detail your access permits. Hidden figures export as hidden, not as blanks — a blank is indistinguishable from a zero.',
  csv: 'Flat rows, same level of detail, same access. No formatting.',
  pptx: 'Slide-ready blocks. Same figures, same watermark.',
}

export default function ExportModal({ view: v, onClose }) {
  const spec = reportById(v.reportId) || {}
  const formats = (spec.exportFormats || v.exportFormats || []).map(f => String(f).toLowerCase())
  const [picked, setPicked] = useState(formats[0] || null)

  return (
    <Modal title="Export" wide onClose={onClose}
           sub={'An export can never reveal more than the matching on-screen view. The counts below '
             + 'are the export’s contents, computed under your scope predicate before anything is '
             + 'generated.'}>
      <Note kind="info" glyph="⛨" style={{ marginBottom: 15 }}
            title="An export can never reveal more than the matching on-screen view">
        The export writes out the run that is already on your screen — same data access, same as-of.
        It is not a second trip to the sources, because a second path to the same numbers is a second
        place to get someone’s permissions wrong.
      </Note>

      {formats.length ? formats.map(f => (
        <label className={'expOpt' + (f === picked ? ' sel' : '')} key={f}
               onClick={() => setPicked(f)}>
          <input type="radio" name="expf" checked={f === picked} onChange={() => setPicked(f)} />
          <div>
            <div className="eo-b">{f.toUpperCase()}</div>
            <div className="eo-d">{EXP_DESC[f] || 'Governed export.'}</div>
          </div>
        </label>
      )) : (
        <div className="empty">No export formats are enabled for this report.</div>
      )}

      <div className="sectLbl">What this export will contain</div>
      <dl className="dl">
        <dt>Rows included</dt><dd>{v.rowsAdmitted}</dd>
        <dt>Rows your access excludes</dt><dd>{v.rowsTotal - v.rowsAdmitted}</dd>
        <dt>Figures masked</dt><dd>{v.masked}</dd>
        <dt>Blocks withheld</dt><dd>{(v.withheldBlocks || []).length}</dd>
      </dl>

      <div className="wmark" style={{ marginTop: 12 }}>{v.watermark}</div>
      <div className="mini" style={{ marginTop: 6 }}>
        Every page carries this watermark, and it is the server’s line rather than one this dialog
        composed — what you are reading here is byte for byte what the file will carry. An export
        that leaves the building without its scope and as-of becomes an unattributable number in
        someone’s board pack.
      </div>

      <NeedsResolver title="Generating the file needs the resolver">
        The export runs the same spec under the same predicate and the same digest as the run on
        screen, seals the manifest and writes a row to the governance audit trail — an export nobody
        can account for later is the leak, not the file. None of that can happen in a build that
        ships the output of one run, so the pre-flight above is real and the file is not offered.
      </NeedsResolver>

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
