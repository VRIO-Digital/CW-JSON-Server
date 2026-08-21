import { App, Button, Modal } from 'antd'
import { Link } from 'react-router-dom'
import { appPath } from '../../api/dataset'
import type { WhatIfFrame, WhatIfSaved } from '../../api/client'
import { readerNames } from '../../data/whatifReaders'
import './PublishedConfirm.css'

/*
 * The receipt a publish leaves behind.
 *
 * **It reports what was recorded, and nothing else.** A publication stores the frame,
 * each case's admitted load, the readers, the graph it is bound to and how fresh the
 * figures stay — never a number — so every line here is one of those decisions read
 * back. That is the same rule the Published tab keeps, applied at the moment the
 * decision is made: a confirmation that summarised figures would be summarising
 * something the record does not hold.
 *
 * **Its words are the tenant's and its values are the record's.** `publishing.done`
 * carries the title, the sentence, every row label and both buttons; `{name}`, `{n}`
 * and `{when}` are filled here the way `runtime.headroom.sentence` fills `{room}`. A
 * count or a date typed into this component would be a second source for a figure the
 * publication already states.
 *
 * **The link is the server's.** `published.link` is composed once, where the
 * publication is written, so the address copied out of this dialog and the address
 * stored on the record cannot disagree. Nothing here builds a URL.
 *
 * **And it says where scope is administered rather than implying it applies it.** A
 * reader opens the scenario through the access their persona already carries; this
 * dialog runs no filter, so it names Audit & Governance instead of claiming one.
 */

/** `2026-08-10T…` → `Aug 10, 2026`. Empty for a date the record does not carry. */
function day(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The panel — the dialog's body, extracted.
 *
 * antd's `Modal` renders through a portal `renderToString` will not traverse, so a check
 * about what this confirmation states would pass over nothing if it lived inside one.
 * The `PublishScenarioPanel` / `PublishScenarioDialog` split, for the same reason.
 */
export function PublishedConfirmPanel({
  scenario,
  frame,
  onAgain,
  onClose,
}: {
  scenario: WhatIfSaved
  frame: WhatIfFrame
  onAgain: () => void
  onClose: () => void
}) {
  const { message } = App.useApp()
  const done = frame.publishing.done
  const pub = scenario.published
  if (!pub) return null

  const names = readerNames(frame, pub.readers)
  const count = `${pub.readers.length} reader${pub.readers.length === 1 ? '' : 's'}`
  const body = done.body.replace('{name}', scenario.name).replace('{n}', count)

  /* The bound graph's own build date, from the live list. A graph that has since been
     unpublished is no longer on it, and then the line names the version without dating
     a build it can no longer read. */
  const graph = frame.graphs.find((g) => g.useCaseId === pub.graphUseCaseId)
  const built = day(graph?.builtAt)
  const graphLine =
    `${pub.graphName}${pub.graphVersion ? ` · ${pub.graphVersion}` : ''}` +
    (built ? ` — ${done.graphNote.replace('{when}', built)}` : '')

  const preset = frame.publishing.freshness.presets.find((p) => p.id === pub.freshness.preset)

  /* Copying can fail — a page without clipboard permission, or an insecure origin — and
     a button that says nothing then has silently done nothing. */
  const copy = () => {
    void navigator.clipboard
      ?.writeText(pub.link)
      .then(() => message.success(done.link.copied))
      .catch(() => message.error(`Could not copy the link. It is ${pub.link}`))
  }

  return (
    <div className="pc">
      <div className="pc-tick" aria-hidden>
        ✓
      </div>
      <h3 className="pc-title">{done.title}</h3>
      <p className="pc-body">{body}</p>

      <div className="pc-link">
        <span className="pc-url" title={pub.link}>
          {pub.link}
        </span>
        <Button size="small" onClick={copy}>
          {done.link.label}
        </Button>
      </div>

      <dl className="pc-rows">
        <div className="pc-row">
          <dt>{done.labels.cases}</dt>
          {/* Named, never counted — the cases are what was admitted, and "2 cases" is
              not checkable. */}
          <dd>{scenario.cases.map((c) => c.name).join(' · ')}</dd>
        </div>
        <div className="pc-row">
          <dt>{done.labels.readers}</dt>
          <dd>{names.join(', ')}</dd>
        </div>
        <div className="pc-row">
          <dt>{done.labels.graph}</dt>
          <dd>{graphLine}</dd>
        </div>
        <div className="pc-row">
          <dt>{done.labels.numbers}</dt>
          {/* The preset's own label and its own sentence: what was chosen, and what that
              choice means, both in the tenant's words. */}
          <dd>{preset ? `${preset.label} — ${preset.sentence}` : pub.freshness.preset}</dd>
        </div>
        <div className="pc-row">
          <dt>{done.labels.access}</dt>
          <dd>{done.accessNote}</dd>
        </div>
      </dl>

      <Link className="pc-audit" to={appPath('/audit')}>
        {done.auditLink}
      </Link>

      <div className="pc-foot">
        <Button onClick={onAgain}>{done.buttons.again}</Button>
        <Button type="primary" onClick={onClose}>
          {done.buttons.close}
        </Button>
      </div>
    </div>
  )
}

/** The panel in antd's dialog chrome. Nothing but framing lives here. */
export default function PublishedConfirmDialog({
  open,
  scenario,
  frame,
  onAgain,
  onClose,
}: {
  open: boolean
  scenario: WhatIfSaved | null
  frame: WhatIfFrame
  onAgain: () => void
  onClose: () => void
}) {
  if (!scenario || !scenario.published) return null
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      /* No title bar: the tick and the tenant's own heading are the title, and a chrome
         title beside them would state the act twice. */
      title={null}
      destroyOnHidden
      aria-label={frame.publishing.done.title}
    >
      <PublishedConfirmPanel
        scenario={scenario}
        frame={frame}
        onAgain={onAgain}
        onClose={onClose}
      />
    </Modal>
  )
}
