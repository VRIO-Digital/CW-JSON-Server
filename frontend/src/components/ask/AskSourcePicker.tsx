import { PlusOutlined } from '@ant-design/icons'
import { Button, Checkbox, Modal, Tag, Tooltip, Typography } from 'antd'
import { useState } from 'react'
import type { AskSource } from '../../api/client'
import ConnectorIcon from '../common/ConnectorIcon'
import { askSourceCopy } from '../../data/askSources'
import './AskSourcePicker.css'

/*
 * The `+` beside the question box: which connected sources this question is read against.
 *
 * **It lists runtime sources and nothing else, and the server is what says which those are.**
 * `GET /ask` serves the list; the page renders it. A component filtering on `kind === 'gmail'`
 * would be a second answer to which sources are askable, and it would go stale the day a
 * second runtime connector lands — the reason step 4 of the New Graph wizard reads the served
 * `runtime` flag rather than testing a connector name.
 *
 * **The `+` opens a modal**, asked for as one. It was a `Dropdown` panel hanging off the
 * button, which put the rows in a popover the reader had to keep hovering to hold; a modal is
 * the surface for a decision they came to make. There is no OK: a checkbox is the act, the
 * store has it the moment it changes, and a footer offering to confirm what has already
 * happened is a control with nothing to do. Closing is done.
 *
 * **The list is exported apart from the `Modal`, because a modal portals out of
 * `renderToString`** — the rule that already put `AudiencePicker` and `ConnectSourceWizard` in
 * files of their own, and the same one that keeps this file’s words in `src/data/`. A check
 * written against the page would render the closed control and pass over nothing.
 *
 * **It is the rows and nothing else.** It opened with a heading and closed with the observation
 * rule spelled out; both were removed on request. The rule is still true and still on record —
 * in CLAUDE.md, where a decision belongs, and in the `observation` block a reader meets on the
 * answer itself, which is where it bears on something they are actually reading. A picker is a
 * control, and three lines of doctrine over two checkboxes is a paragraph in front of a click.
 *
 * **The empty state keeps its sentence**, because that branch has no rows to be: a `+` that
 * opens onto nothing reads as broken, where one naming the Sources page names the fix. Same
 * rule as the Library's ungoverned notice — a list that is merely shorter is not a message.
 */

export function AskSourceList({
  sources,
  picked,
  onToggle,
  disabled,
}: {
  sources: AskSource[]
  /** The ids currently picked. */
  picked: string[]
  onToggle: (sourceId: string, on: boolean) => void
  disabled?: boolean
}) {
  if (sources.length === 0) {
    return (
      <div className="asp-panel asp-empty">
        <Typography.Text strong>{askSourceCopy.emptyTitle}</Typography.Text>
        <Typography.Paragraph type="secondary" className="asp-note">
          {askSourceCopy.emptyDetail}
        </Typography.Paragraph>
      </div>
    )
  }

  return (
    <div className="asp-panel">
      {sources.map((s) => (
        <label className="asp-row" key={s.sourceId}>
          <Checkbox
            checked={picked.includes(s.sourceId)}
            disabled={disabled}
            onChange={(e) => onToggle(s.sourceId, e.target.checked)}
          />
          <ConnectorIcon connector={s.connector} size={18} />
          <span className="asp-text">
            <span className="asp-name">{s.name}</span>
            {/* What it connected *as*, and what is in scope — the two facts that tell two
                mailboxes apart. Neither is invented: both are served on the row. */}
            <span className="asp-meta">
              {s.account ? `${s.account} · ` : ''}
              {s.scope}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

export default function AskSourcePicker({
  sources,
  picked,
  onToggle,
  disabled,
}: {
  sources: AskSource[]
  picked: string[]
  onToggle: (sourceId: string, on: boolean) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const count = picked.length
  return (
    <>
      <Tooltip title={askSourceCopy.buttonHint}>
        <Button
          type="text"
          className="asp-trigger"
          icon={<PlusOutlined />}
          disabled={disabled}
          aria-label={askSourceCopy.buttonHint}
          onClick={() => setOpen(true)}
        >
          {/* The count is on the control, because a shut picker with no number says nothing
              about what is behind it — the rule Ask’s own history toggle follows. */}
          {count > 0 ? <Tag color="processing">{count}</Tag> : null}
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        /* No title: the heading over these rows was removed on request, and a modal title is
           the same heading one layer out. `title={null}` rather than an omitted prop, so a
           default cannot arrive from the theme — the rule `RuntimeBuildDialog` kept. */
        title={null}
        /* No footer either. Ticking a row *is* the act — it reaches the store immediately —
           so an OK button would confirm something already done, and a Cancel would promise an
           undo this dialog does not perform. The X and the mask are how it closes. */
        footer={null}
        width={420}
        destroyOnHidden
      >
        <AskSourceList
          sources={sources}
          picked={picked}
          onToggle={onToggle}
          disabled={disabled}
        />
      </Modal>
    </>
  )
}
