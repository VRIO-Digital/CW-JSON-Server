import { Alert, Button, Checkbox, InputNumber, Modal, Select, Space, Tag } from 'antd'
import { useState } from 'react'
import type { WhatIfFreshness, WhatIfPublishing, WhatIfSaved } from '../api/client'
import type { WhatIfFrame } from '../api/client'
import { SP } from '../theme'
import './PublishScenarioDialog.css'

/*
 * Publishing a What-if scenario.
 *
 * **The whole scenario travels, or nothing does.** A case is not separately shareable —
 * a figure without its frame (what was watched, which pool it was drawn from) is a
 * number without a question — so this dialog hangs off a library entry and never off a
 * column, and the copy that says so is the tenant's, served on `frame.publishing`.
 *
 * Three decisions, and each is checked against a pool the *server* owns:
 *
 *  - **Readers** are the tenant's users from Settings, served on the frame. A directory
 *    written here would be a second answer to "who exists" and could offer somebody the
 *    API then refuses — the mistake the consent screen made with its scope list.
 *  - **The graph** is one of the graphs actually published. A scenario bound to a draft
 *    would promise figures traversed from content nobody published.
 *  - **Freshness** is one of the presets `db.whatif.publishing` declares, each carrying
 *    its own sentence so the recurrence line is the tenant's words rather than this
 *    component's.
 *
 * **It is not access control, and the panel says so in those words.** The directory is
 * real, but the role is client-held and the API serves every scenario to a caller that
 * names nobody. What publishing records is who is *told*. Reader-level scope is likewise
 * *declared* — each reader's persona note is printed beside them — never applied: no
 * roster here is filtered per persona, so showing a filtered count would claim a filter
 * that never ran.
 */

/**
 * The panel — the dialog's body, extracted.
 *
 * antd's `Modal` renders through a portal that `renderToString` will not traverse, so a
 * check about what this dialog contains would pass over nothing if it lived inside one.
 * That is the `ConnectSourceWizard` / `ConnectSourceModal` split, for the same reason.
 */
export function PublishScenarioPanel({
  scenario,
  frame,
  saving,
  onPublish,
  onUnpublish,
  onCancel,
}: {
  scenario: WhatIfSaved
  frame: WhatIfFrame
  saving?: boolean
  onPublish: (input: { readers: string[]; graphUseCaseId: string; freshness: WhatIfFreshness }) => void
  onUnpublish: () => void
  onCancel: () => void
}) {
  const pub: WhatIfPublishing = frame.publishing
  const already = scenario.published !== null

  const [readers, setReaders] = useState<string[]>(scenario.published?.readers ?? [])
  const [graphId, setGraphId] = useState<string>(
    scenario.published?.graphUseCaseId ?? frame.graphs[0]?.useCaseId ?? '',
  )
  const [fresh, setFresh] = useState<WhatIfFreshness>(
    scenario.published?.freshness ?? pub.freshness.default,
  )

  const preset = pub.freshness.presets.find((p) => p.id === fresh.preset)
  const custom = fresh.preset === 'custom'
  const weeklyWithNoDay = custom && fresh.unit === 'week' && fresh.days.length === 0

  /* The refusals are the server's own sentences, shown before the request rather than
     instead of it — the route checks all three again, and its message is what a user
     sees if anything gets past this. */
  const problem = readers.length === 0
    ? pub.readers.emptyError
    : weeklyWithNoDay
      ? pub.freshness.noDayError
      : frame.graphs.length === 0
        ? pub.graph.empty
        : null

  const toggleReader = (email: string) =>
    setReaders((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]))

  const toggleDay = (day: string) =>
    setFresh((r) => ({
      ...r,
      days: r.days.includes(day)
        ? r.days.filter((d) => d !== day)
        : /* Kept in the roster's order, so Tue/Mon and Mon/Tue are the same schedule. */
          pub.freshness.days.filter((d) => d === day || r.days.includes(d)),
    }))

  /*
   * The custom sentence, interpolated from the tenant's template. `{n}`, `{when}` and
   * `{time}` are filled the way `runtime.headroom.sentence` fills `{room}` — the words
   * are the package's and only the values are this component's.
   */
  const every = fresh.every > 1 ? `${fresh.every} ${fresh.unit}s` : fresh.unit
  const when =
    fresh.unit === 'week'
      ? `on ${fresh.days.join(', ')}`
      : fresh.unit === 'month'
        ? 'on the 1st'
        : ''
  const sentence = custom
    ? weeklyWithNoDay
      ? pub.freshness.noDayError
      : (preset?.sentence ?? '')
          .replace('{n}', every)
          .replace('{when}', when)
          .replace('{time}', fresh.time)
          .replace(/\s{2,}/g, ' ')
    : (preset?.sentence ?? '')

  return (
    <div className="ps">
      {/* Why a case cannot travel on its own. Stated first because it is the rule the
          whole dialog exists to enforce. */}
      <Alert className="ps-call" type="info" showIcon description={pub.call} />

      <section className="ps-sec">
        <div className="ps-label">{pub.readers.label}</div>
        <div className="ps-readers" role="group" aria-label={pub.readers.label}>
          {frame.readers.map((r) => (
            <label className="ps-reader" key={r.email}>
              <Checkbox
                checked={readers.includes(r.email)}
                onChange={() => toggleReader(r.email)}
              />
              <span className="ps-reader-who">
                <strong>{r.name}</strong>
                <span className="ps-reader-mail">{r.email}</span>
              </span>
              <span className="ps-reader-scope">
                {/* A persona is a category, never a state, so it stays neutral. */}
                <Tag>{r.roleLabel}</Tag>
                <span className="ps-reader-note">{r.accessNote}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="ps-help">{pub.readers.scopeNote}</p>
        {/* The gate-1 caveat, at the point the decision is made rather than in a doc. */}
        <p className="ps-caveat">{pub.readers.caveat}</p>
      </section>

      <section className="ps-sec">
        <div className="ps-label">{pub.graph.label}</div>
        <Select
          className="ps-wide"
          value={graphId || undefined}
          onChange={setGraphId}
          disabled={frame.graphs.length === 0}
          placeholder={pub.graph.empty}
          options={frame.graphs.map((g) => ({
            value: g.useCaseId,
            /* Version and content hash both, because "which build answered this" is a
               question a reader is entitled to ask. */
            label: `${g.name}${g.version ? ` · ${g.version}` : ''}${
              g.sha256 ? ` · ${g.sha256.slice(0, 12)}` : ''
            }`,
          }))}
        />
        <p className="ps-help">{pub.graph.note}</p>
      </section>

      <section className="ps-sec">
        <div className="ps-label">{pub.freshness.label}</div>
        <Select
          className="ps-wide"
          value={fresh.preset}
          onChange={(id) => setFresh((r) => ({ ...r, preset: id }))}
          options={pub.freshness.presets.map((p) => ({ value: p.id, label: p.label }))}
        />

        {custom ? (
          <div className="ps-recur">
            <Space size={SP.sm} wrap>
              <span>Every</span>
              <InputNumber
                min={1}
                max={52}
                value={fresh.every}
                onChange={(v) => setFresh((r) => ({ ...r, every: Number(v) || 1 }))}
                aria-label="How often"
              />
              <Select
                value={fresh.unit}
                onChange={(u) => setFresh((r) => ({ ...r, unit: u }))}
                options={pub.freshness.units.map((u) => ({
                  value: u,
                  label: fresh.every > 1 ? `${u}s` : u,
                }))}
                aria-label="Unit"
              />
              <span>at</span>
              <Select
                value={fresh.time}
                onChange={(t) => setFresh((r) => ({ ...r, time: t }))}
                options={pub.freshness.times.map((t) => ({ value: t, label: t }))}
                aria-label="Time"
              />
            </Space>

            {fresh.unit === 'week' ? (
              <div className="ps-days">
                {pub.freshness.days.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`ps-day${fresh.days.includes(d) ? ' is-on' : ''}`}
                    onClick={() => toggleDay(d)}
                    aria-pressed={fresh.days.includes(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="ps-help">{sentence}</p>
      </section>

      <div className="ps-foot">
        <span className="ps-foot-note">{problem ?? pub.done.stored}</span>
        {already ? (
          <Button danger onClick={onUnpublish} disabled={saving}>
            {pub.buttons.unpublish}
          </Button>
        ) : null}
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="primary"
          loading={saving}
          disabled={problem !== null}
          /* Refused with the reason rather than only greyed out — a disabled button that
             says nothing is the failure this repo corrects everywhere else. */
          title={problem ?? undefined}
          onClick={() => onPublish({ readers, graphUseCaseId: graphId, freshness: fresh })}
        >
          {already ? pub.buttons.update : pub.buttons.publish}
        </Button>
      </div>
    </div>
  )
}

/** The panel in antd's dialog chrome. Nothing but framing lives here. */
export default function PublishScenarioDialog({
  open,
  scenario,
  frame,
  saving,
  onPublish,
  onUnpublish,
  onCancel,
}: {
  open: boolean
  scenario: WhatIfSaved | null
  frame: WhatIfFrame
  saving?: boolean
  onPublish: (input: { readers: string[]; graphUseCaseId: string; freshness: WhatIfFreshness }) => void
  onUnpublish: () => void
  onCancel: () => void
}) {
  if (!scenario) return null
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
      /* Remounted each time, so re-opening it shows the publication as it now stands
         rather than the state the last edit left behind. */
      destroyOnHidden
      title={`${scenario.published ? frame.publishing.manageTitle : frame.publishing.publishTitle} — ${scenario.name}`}
    >
      <PublishScenarioPanel
        scenario={scenario}
        frame={frame}
        saving={saving}
        onPublish={onPublish}
        onUnpublish={onUnpublish}
        onCancel={onCancel}
      />
    </Modal>
  )
}
