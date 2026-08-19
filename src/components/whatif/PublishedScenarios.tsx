import { Button, Modal, Tag } from 'antd'
import type { WhatIfFrame, WhatIfSaved } from '../../api/client'
import './PublishedScenarios.css'

/*
 * The scenarios that have been published, as cards.
 *
 * **Separate from the library, because "saved" and "published" are different
 * states.** The library lists everything somebody kept; this lists what has been
 * told to somebody, which is the only one of the two that names readers, binds a
 * graph version and carries a schedule. A published scenario appears in both —
 * it is still a library entry — and only here does it state who can read it.
 *
 * **Two dates, and they date two acts.** `createdAt` is when the scenario was
 * made; `published.publishedAt` is when it was told. A scenario can sit in the
 * library for a week before anybody publishes it, so a card showing one figure
 * would be dating the other decision.
 *
 * **The card states, and never counts.** No figure a reader would see appears
 * here: a publication stores the frame and each case's admitted load, never the
 * numbers, so a card that showed a tonnage would be showing something the
 * publication does not hold. The details view recomputes nothing either — it
 * reports the record.
 */

/** `2026-08-18T09:12:44.512Z` → `18 Aug 2026, 09:12`. */
function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const readerNames = (frame: WhatIfFrame, emails: string[]): string[] =>
  emails.map((email) => frame.readers.find((r) => r.email === email)?.name ?? email)

/**
 * The details of one published scenario.
 *
 * Its own component rather than a panel behind the grid's state: a body inside a
 * parent's `useState` renders closed under `renderToString`, so every check about
 * what it contains would pass over nothing. Same split as
 * `ConnectSourceWizard` / `ConnectSourceModal`.
 */
export function PublishedScenarioDetails({
  scenario,
  frame,
}: {
  scenario: WhatIfSaved
  frame: WhatIfFrame
}) {
  const published = scenario.published
  const poolLabel = frame.pools.find((p) => p.key === scenario.pool)?.label ?? scenario.pool
  const measures = scenario.watch.map(
    (key) => frame.measures.find((m) => m.key === key)?.label ?? key,
  )
  const preset = published
    ? frame.publishing.freshness.presets.find((p) => p.id === published.freshness.preset)
    : null

  return (
    <div className="pubd">
      <section className="pubd-sec">
        <div className="pubd-label">The frame</div>
        <dl className="pubd-rows">
          <div className="pubd-row">
            <dt>Pool</dt>
            <dd>{poolLabel}</dd>
          </div>
          <div className="pubd-row">
            <dt>Watching</dt>
            {/* The measures by name, because a count says nothing about what was
                judged. */}
            <dd>{measures.length > 0 ? measures.join(', ') : '—'}</dd>
          </div>
          <div className="pubd-row">
            <dt>Created</dt>
            <dd>{when(scenario.createdAt)}</dd>
          </div>
          <div className="pubd-row">
            <dt>Last written</dt>
            <dd>{when(scenario.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="pubd-sec">
        <div className="pubd-label">
          Cases · {scenario.cases.length}
        </div>
        {/* The admitted load per case — its name and which generator it draws in.
            No figure: the publication stores neither. */}
        <ul className="pubd-cases">
          {scenario.cases.map((c) => {
            const generator = frame.generators.find((g) => g.id === c.generatorId)
            return (
              <li className="pubd-case" key={`${c.name}-${c.generatorId}`}>
                <strong>{c.name}</strong>
                <span className="pubd-dim">
                  {generator ? `${generator.name} · ${generator.state}` : c.generatorId}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {published ? (
        <>
          <section className="pubd-sec">
            <div className="pubd-label">Readers · {published.readers.length}</div>
            <ul className="pubd-readers">
              {published.readers.map((email) => {
                const reader = frame.readers.find((r) => r.email === email)
                return (
                  <li className="pubd-reader" key={email}>
                    <span className="pubd-who">
                      <strong>{reader?.name ?? email}</strong>
                      <span className="pubd-dim">{email}</span>
                    </span>
                    <span className="pubd-scope">
                      {/* A persona is a category, never a state. */}
                      <Tag>{reader?.roleLabel ?? '—'}</Tag>
                      <span className="pubd-dim">{reader?.accessNote ?? ''}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
            {/* The gate-1 caveat travels with the roster wherever it is shown. */}
            <p className="pubd-caveat">{frame.publishing.readers.caveat}</p>
          </section>

          <section className="pubd-sec">
            <div className="pubd-label">The publication</div>
            <dl className="pubd-rows">
              <div className="pubd-row">
                <dt>Published</dt>
                <dd>{when(published.publishedAt)}</dd>
              </div>
              <div className="pubd-row">
                <dt>By</dt>
                <dd>{published.publishedBy}</dd>
              </div>
              <div className="pubd-row">
                <dt>Bound to</dt>
                {/* Version *and* content hash, because "which build did a reader
                    see" is a question a reader is entitled to ask. */}
                <dd>
                  {published.graphName}
                  {published.graphVersion ? ` · ${published.graphVersion}` : ''}
                  {published.graphSha256 ? (
                    <span className="pubd-dim"> · {published.graphSha256.slice(0, 12)}</span>
                  ) : null}
                </dd>
              </div>
              <div className="pubd-row">
                <dt>Freshness</dt>
                <dd>{preset?.label ?? published.freshness.preset}</dd>
              </div>
            </dl>
            <p className="pubd-help">{frame.publishing.graph.note}</p>
          </section>
        </>
      ) : null}
    </div>
  )
}

/** The details in antd's dialog chrome. Nothing but framing lives here. */
export function PublishedScenarioModal({
  open,
  scenario,
  frame,
  onManage,
  onOpenInRuntime,
  onClose,
}: {
  open: boolean
  scenario: WhatIfSaved | null
  frame: WhatIfFrame
  onManage: (savedId: string) => void
  /**
   * Loads the scenario back into Runtime.
   *
   * Here because the library row no longer states anything about a publication —
   * so this is where a published scenario is re-opened, and removing it from the
   * library costs nothing. It is a *recomputation*, not a restore: the
   * publication stores the admitted load, never the figures.
   */
  onOpenInRuntime: (savedId: string) => void
  onClose: () => void
}) {
  if (!scenario) return null
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      title={scenario.name}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
        <Button key="open" onClick={() => onOpenInRuntime(scenario.savedId)}>
          Open in Runtime
        </Button>,
        <Button key="manage" type="primary" onClick={() => onManage(scenario.savedId)}>
          {frame.publishing.buttons.manage}
        </Button>,
      ]}
    >
      <PublishedScenarioDetails scenario={scenario} frame={frame} />
    </Modal>
  )
}

/**
 * The grid.
 *
 * Absent entirely when nothing is published — an empty "Published" heading over a
 * sentence reads as a section that failed to load, and the library above already
 * says what a scenario is before it has been told to anybody.
 */
export default function PublishedScenarios({
  frame,
  saved,
  onOpenDetails,
}: {
  frame: WhatIfFrame
  saved: WhatIfSaved[]
  onOpenDetails: (savedId: string) => void
}) {
  const published = saved.filter((s) => s.published !== null)
  if (published.length === 0) return null

  return (
    <div className="wi-card">
      <div className="wi-label">Published scenarios · {published.length}</div>
      <p className="wi-help pubs-lead">
        What has been told to somebody, and to whom. Opening one states its frame, its
        cases and its readers — it stores no figures, so there is nothing here to go
        stale.
      </p>

      <div className="pubs-grid">
        {published.map((s) => {
          const pub = s.published!
          const poolLabel = frame.pools.find((p) => p.key === s.pool)?.label ?? s.pool
          const names = readerNames(frame, pub.readers)
          return (
            /*
             * The whole card is the control. A card that only responds on a small
             * "Details" link makes the reader hunt for the target that the cursor
             * already implies is the card.
             */
            <button
              type="button"
              key={s.savedId}
              className="pubs-card"
              onClick={() => onOpenDetails(s.savedId)}
              aria-label={`Open the details of ${s.name}`}
            >
              <div className="pubs-head">
                <strong className="pubs-name">{s.name}</strong>
                <Tag color="success">
                  {pub.readers.length} reader{pub.readers.length === 1 ? '' : 's'}
                </Tag>
              </div>

              <div className="pubs-meta">
                {poolLabel} pool · watching {s.watch.length} measure
                {s.watch.length === 1 ? '' : 's'} · {s.cases.length} case
                {s.cases.length === 1 ? '' : 's'}
              </div>

              {/* Named, not counted: three names is a roster a reader can check, and
                  "3 readers" is not. Capped, and the cap says so. */}
              <div className="pubs-meta">
                Readers: {names.slice(0, 3).join(', ')}
                {names.length > 3 ? ` + ${names.length - 3} more` : ''}
              </div>

              <dl className="pubs-dates">
                <div className="pubs-date">
                  <dt>Created</dt>
                  <dd>{when(s.createdAt)}</dd>
                </div>
                <div className="pubs-date">
                  <dt>Published</dt>
                  <dd>{when(pub.publishedAt)}</dd>
                </div>
              </dl>

              <div className="pubs-foot">
                {pub.graphName}
                {pub.graphVersion ? ` · ${pub.graphVersion}` : ''} · published by{' '}
                {pub.publishedBy}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
