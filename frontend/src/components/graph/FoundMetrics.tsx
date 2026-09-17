import { DownOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useState } from 'react'
import {
  foundMetricSource,
  foundMetricsCopy,
  type DocumentMetric,
} from '../../data/documentReadings'
import '../../pages/NewGraphPage.css'

/*
 * The measures an attached document defines, offered on the Metrics step for approval.
 *
 * **Its own component rather than a fourth branch of `DraftedStep`.** A suggestion is two columns
 * and three acts (accept, edit the pool, dismiss); one of these is a definition *plus the evidence
 * it was read from* — the query the document printed and the sentence explaining the calculation —
 * and the reader's act is to approve or reject that evidence. Forcing it into `DraftedStep` would
 * mean a fourth optional slot and a second meaning for Accept, which is how one component comes to
 * describe two different decisions.
 *
 * **Approved is derived from the metric list, never held here.** A row is approved exactly while
 * the list below carries its name, so removing a metric there puts its Approve back — one answer
 * to "is this in", where a local flag beside it would be a second one that could disagree.
 */
export default function FoundMetrics({
  metrics,
  approved,
  onApprove,
  onReject,
}: {
  metrics: DocumentMetric[]
  /** Is this measure already in the list below? Read from the metrics, not held here. */
  approved: (metric: DocumentMetric) => boolean
  onApprove: (metric: DocumentMetric) => void
  /** Drops the row from this list. Nothing was saved, so nothing is deleted. */
  onReject: (id: string) => void
}) {
  /*
   * Which rows are open. A set rather than one id: these are evidence, and comparing two
   * definitions is exactly what a reader is here to do — the one-at-a-time rule `DraftedStep`'s
   * editor keeps is about *unsaved edits*, which nothing here has.
   */
  const [open, setOpen] = useState<string[]>([])

  if (metrics.length === 0) return null

  const toggle = (id: string) =>
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="ng-field">
      <span className="ng-label">{foundMetricsCopy.heading}</span>
      <div className="ng-found">
        {metrics.map((m) => {
          const isOpen = open.includes(m.id)
          const isApproved = approved(m)

          return (
            <div key={m.id} className={`ng-found-row${isOpen ? ' is-open' : ''}`}>
              <div className="ng-found-head">
                <span className="ng-found-name">{m.name}</span>
                <span className="ng-found-source">{foundMetricSource(m)}</span>
                <span className="ng-found-actions">
                  {/*
                    The toggle is text, not an icon alone: what it opens is a query and a
                    sentence, and a bare chevron beside two buttons reads as a third act.

                    **One icon, rotated, rather than an up glyph and a down one.** It was
                    `⌄` / `⌃` (U+2304 / U+2303), whose metrics sit near the bottom and the top
                    of the line box — so the mark rode below the label when shut and above it
                    when open, which reads as a broken row rather than as a chevron. An antd
                    icon is a sized SVG and the button is a flex row, so it centres on the
                    label whatever the font does with it.
                  */}
                  <button
                    type="button"
                    className="ng-found-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggle(m.id)}
                  >
                    <DownOutlined className="ng-found-chevron" aria-hidden="true" />
                    {isOpen ? foundMetricsCopy.hideLabel : foundMetricsCopy.showLabel}
                  </button>
                  <Button
                    type="primary"
                    size="small"
                    disabled={isApproved}
                    onClick={() => onApprove(m)}
                  >
                    {isApproved
                      ? foundMetricsCopy.approvedLabel
                      : foundMetricsCopy.approveLabel}
                  </Button>
                  {/* Reject stays offered after an approval, because it is the way back out —
                      the rule the relations dialog keeps for the same pair of acts. */}
                  <Button size="small" onClick={() => onReject(m.id)}>
                    {foundMetricsCopy.rejectLabel}
                  </Button>
                </span>
              </div>

              <div className="ng-found-desc">{m.description}</div>

              {isOpen ? (
                <div className="ng-found-body">
                  <span className="ng-found-label">{foundMetricsCopy.queryLabel}</span>
                  {/* `pre`, because the document's own layout is how a query is read — the
                      same reason a CAPEX metric's definition renders `pre-wrap`. */}
                  <pre className="ng-found-query">{m.query}</pre>
                  <span className="ng-found-label">{foundMetricsCopy.noteLabel}</span>
                  <div className="ng-found-note">{m.note}</div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <span className="ng-help">{foundMetricsCopy.note}</span>
    </div>
  )
}
