import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Checkbox, Col, Empty, Input, Modal, Row, Tag, Tooltip, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { AskSource } from '../../api/client'
import ConnectorIcon from '../common/ConnectorIcon'
import { askSourceCopy, filterAskSources } from '../../data/askSources'
import { SP } from '../../theme'
import './AskSourcePicker.css'

/*
 * The `+` beside the question box: which connected sources this question is read against.
 *
 * **It lists runtime sources and nothing else, and the server is what says which those are.**
 * `GET /ask` serves the list; the page renders it. A component filtering on `kind === 'gmail'`
 * would be a second answer to which sources are askable, and it would go stale the day a
 * second runtime connector lands — the reason step 4 of the New Graph wizard reads the served
 * `runtime` flag rather than testing a connector name. The search below narrows what is shown;
 * it never decides what is askable, which is why it matches on the words a card prints.
 *
 * **It is the connector directory's shape, asked for as one.** It was a `Dropdown` panel, then
 * a 420px modal holding a column of rows; it is now a wide dialog with a search field and a
 * grid of cards, the same language step 1 of the connect wizard already speaks. That is a
 * deliberate reversal of two earlier removals — the dialog has a title again and the grid has a
 * heading — and the reason they come back is that the shape changed underneath them: a heading
 * over two bare checkboxes was a label nobody needed, while a heading carrying the count above
 * a *searchable* grid is the only thing that tells a narrowed list from the whole one. The
 * count-on-the-heading rule is `ConnectorDirectory`'s own, applied for the same reason.
 *
 * **What did not come back is the doctrine.** `observationNote` — what a mailbox answer is and
 * is not — stays on the page, above a thread with no graph behind it, where it bears on
 * something the reader is actually reading. Three lines of it over a picker is still a
 * paragraph in front of a click, whatever shape the picker is.
 *
 * **There is no footer.** Ticking a card *is* the act — the store has it the moment it changes
 * — so an OK would confirm something already done and a Cancel would promise an undo this
 * dialog does not perform. The X and the mask are how it closes.
 *
 * **And there is no filter control beside the search**, which the directory has and this does
 * not. The only axis available is the connector kind, and every askable source is a runtime
 * source — today that is one kind, so the control would be a Select with a single option: the
 * thing this repo refuses everywhere, from the mailbox that has no picker to the drive kind
 * that is offered with the count that says so. If a second runtime connector lands, the filter
 * is a row of copy and a second argument to `filterAskSources`.
 *
 * **The grid is exported apart from the `Modal`, because a modal portals out of
 * `renderToString`** — the rule that already put `AudiencePicker` and `ConnectSourceWizard` in
 * files of their own, and the reason this file's words and its filtering both live in
 * `src/data/`. A check written against the page would render the closed control and pass over
 * nothing.
 *
 * **The empty state keeps its sentence**, because that branch has no cards to be: a `+` that
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
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterAskSources(sources, query), [sources, query])

  /* Nothing connected is not a search problem, so this branch is decided before the controls
     are drawn: a search box over an estate with no askable source in it offers to narrow
     nothing, and would sit above the very sentence explaining that there is nothing to narrow. */
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
      <div className="asp-controls">
        <Input
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          prefix={<SearchOutlined />}
          placeholder={askSourceCopy.searchPlaceholder}
          aria-label={askSourceCopy.searchPlaceholder}
        />
      </div>

      {shown.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <div>{askSourceCopy.noMatch(query)}</div>
              <Typography.Text type="secondary">{askSourceCopy.noMatchHint}</Typography.Text>
            </>
          }
        />
      ) : (
        <div className="asp-section">
          <Typography.Title level={5} className="asp-grid-heading">
            {askSourceCopy.heading}
            {/* The count is what tells a narrowed grid from the whole list, so it counts what
                is on screen rather than what was served. Neutral, never a status tint: how
                many sources are listed is a quantity, not a state. */}
            <span className="asp-count">{shown.length}</span>
          </Typography.Title>

          <Row gutter={[SP.sm, SP.sm]}>
            {shown.map((s) => {
              const on = picked.includes(s.sourceId)
              return (
                <Col key={s.sourceId} xs={24} sm={12} md={8}>
                  {/* A label, so the whole card is the control rather than the checkbox alone —
                      a card that looks clickable and is not is the worse half of both. */}
                  <label className={`asp-card${on ? ' is-picked' : ''}`}>
                    <span className="asp-card-head">
                      <ConnectorIcon connector={s.connector} size={22} />
                      <Checkbox
                        checked={on}
                        disabled={disabled}
                        onChange={(e) => onToggle(s.sourceId, e.target.checked)}
                      />
                    </span>
                    <span className="asp-name">{s.name}</span>
                    {/* What it connected *as*, and what is in scope — the two facts that tell two
                        mailboxes apart. Neither is invented: both are served on the row. */}
                    <span className="asp-meta">
                      {s.account ? `${s.account} · ` : ''}
                      {s.scope}
                    </span>
                  </label>
                </Col>
              )
            })}
          </Row>
        </div>
      )}
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
        title={askSourceCopy.modalTitle}
        /* No footer. Ticking a card *is* the act — it reaches the store immediately — so an OK
           button would confirm something already done, and a Cancel would promise an undo this
           dialog does not perform. The X and the mask are how it closes. */
        footer={null}
        /* The connect wizard's width, deliberately the same number: these are the two dialogs in
           the app that show a grid of connector cards, and one of them being narrower would make
           the same card two sizes. */
        width={880}
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
