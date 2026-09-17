import { DownOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useState } from 'react'
import '../../pages/NewGraphPage.css'

/*
 * What the documents attached on step 1 were read as containing, offered for approval.
 *
 * **One component for steps 4 and 5**, the way `DraftedStep` serves the two drafted lists: the
 * interaction is the same one — a row states what was found, names the document, and hides its
 * evidence behind a toggle; the reader approves it into the list below or rejects it off this one.
 * What differs is the noun, which is copy, and what approving *does*, which is a callback. A second
 * copy of this markup for questions would be the third variant this repo's own rule warns about.
 *
 * **Its own component rather than a branch of `DraftedStep`.** A suggestion is two columns and
 * three acts (accept, correct the pool, dismiss); one of these is a definition *plus the evidence
 * it was read from*, and the reader's act is to judge that evidence. Folding them together would
 * give Accept two meanings.
 *
 * **Approved is derived by the caller, never held here.** A row is approved exactly while the list
 * below carries it, so removing it there puts its Approve back — one answer to "is this in", where
 * a flag in this component would be a second one that could disagree.
 */

/** One thing found in a document, in the shape this panel draws. */
export type FoundItem = {
  id: string
  /** The headline: a measure's name, or the question itself. */
  title: string
  /** A measure's name is written as the document writes it; a question is prose. */
  titleMono?: boolean
  /** `from <file>`. */
  source: string
  /** One line under the title. */
  summary: string
  /** A mark beside the title — `HIGH` on a question the document frames as one that matters. */
  badge?: string
  /** What the toggle reveals: the document's own evidence, in the order it should be read. */
  details: { label: string; text: string; code?: boolean }[]
}

export default function FoundInDocuments({
  items,
  copy,
  approved,
  onApprove,
  onReject,
}: {
  items: FoundItem[]
  copy: {
    heading: string
    showLabel: string
    hideLabel: string
    approveLabel: string
    approvedLabel: string
    rejectLabel: string
    note: string
  }
  /** Is this already in the list below? Read from that list, not held here. */
  approved: (id: string) => boolean
  onApprove: (id: string) => void
  /** Drops the row from this list. Nothing was saved, so nothing is deleted. */
  onReject: (id: string) => void
}) {
  /*
   * Which rows are open. A set rather than one id: these are evidence, and comparing two of them is
   * exactly what a reader is here to do — the one-at-a-time rule `DraftedStep`'s editor keeps is
   * about *unsaved edits*, which nothing here has.
   */
  const [open, setOpen] = useState<string[]>([])

  if (items.length === 0) return null

  const toggle = (id: string) =>
    setOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="ng-field">
      <span className="ng-label">{copy.heading}</span>
      <div className="ng-found">
        {items.map((item) => {
          const isOpen = open.includes(item.id)
          const isApproved = approved(item.id)

          return (
            <div key={item.id} className={`ng-found-row${isOpen ? ' is-open' : ''}`}>
              <div className="ng-found-head">
                {item.badge ? (
                  <span className="ng-high-badge">{item.badge}</span>
                ) : null}
                <span className={item.titleMono ? 'ng-found-name' : 'ng-found-title'}>
                  {item.title}
                </span>
                <span className="ng-found-source">{item.source}</span>
                <span className="ng-found-actions">
                  {/*
                    The toggle is text, not an icon alone: what it opens is evidence, and a bare
                    chevron beside two buttons reads as a third act. One icon, rotated — it was an
                    up glyph and a down one, whose metrics sit near the bottom and the top of the
                    line box, so the mark rode below the label when shut and above it when open.
                  */}
                  <button
                    type="button"
                    className="ng-found-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggle(item.id)}
                  >
                    <DownOutlined className="ng-found-chevron" aria-hidden="true" />
                    {isOpen ? copy.hideLabel : copy.showLabel}
                  </button>
                  <Button
                    type="primary"
                    size="small"
                    disabled={isApproved}
                    onClick={() => onApprove(item.id)}
                  >
                    {isApproved ? copy.approvedLabel : copy.approveLabel}
                  </Button>
                  {/* Reject stays offered after an approval, because it is the way back out —
                      the rule the relations dialog keeps for the same pair of acts. */}
                  <Button size="small" onClick={() => onReject(item.id)}>
                    {copy.rejectLabel}
                  </Button>
                </span>
              </div>

              <div className="ng-found-desc">{item.summary}</div>

              {isOpen ? (
                <div className="ng-found-body">
                  {item.details.map((d) => (
                    <div key={d.label}>
                      <span className="ng-found-label">{d.label}</span>
                      {/* `pre` where the document's own layout is how the text is read — a query
                          wrapped at an arbitrary column is a different statement. */}
                      {d.code ? (
                        <pre className="ng-found-query">{d.text}</pre>
                      ) : (
                        <div className="ng-found-note">{d.text}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <span className="ng-help">{copy.note}</span>
    </div>
  )
}
