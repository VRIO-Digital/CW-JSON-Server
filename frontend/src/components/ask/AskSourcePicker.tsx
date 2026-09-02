import { PlusOutlined } from '@ant-design/icons'
import { Button, Checkbox, Dropdown, Tag, Tooltip, Typography } from 'antd'
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
 * **Its own component, because a dropdown's contents cannot be asserted from the page.**
 * `renderToString` renders the closed control and every check about the rows inside it would
 * pass over nothing — the rule that already put `AudiencePicker` and `ConnectSourceWizard` in
 * files of their own. The panel is exported apart from the `Dropdown` for the same reason.
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
  const count = picked.length
  return (
    <Dropdown
      trigger={['click']}
      placement="topLeft"
      /* The rows are the menu. `dropdownRender` rather than `items` because these are
         checkboxes with two lines of meta each, which a menu item cannot carry. */
      popupRender={() => (
        <AskSourceList
          sources={sources}
          picked={picked}
          onToggle={onToggle}
          disabled={disabled}
        />
      )}
    >
      <Tooltip title={askSourceCopy.buttonHint}>
        <Button
          type="text"
          className="asp-trigger"
          icon={<PlusOutlined />}
          disabled={disabled}
          aria-label={askSourceCopy.buttonHint}
        >
          {/* The count is on the control, because a shut picker with no number says nothing
              about what is behind it — the rule Ask's own history toggle follows. */}
          {count > 0 ? <Tag color="processing">{count}</Tag> : null}
        </Button>
      </Tooltip>
    </Dropdown>
  )
}
