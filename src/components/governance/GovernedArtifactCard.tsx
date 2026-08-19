import { Button, Popconfirm, Select, Space, Tag } from 'antd'
import { useState } from 'react'
import type { GovernanceArtifact, GovernanceBasis, GovernancePerson } from '../api/client'
import AccessRuleEditor from './AccessRuleEditor'
import { SP } from '../theme'

/*
 * One published artifact, and who can open it.
 *
 * **Both gates on one card, which is the point of the page.** The reader rows are gate 1 — who is
 * told it exists — and opening one reveals gate 2, that persona's access rule, edited in place.
 * The rule follows the *person*, so a change here applies to everything published to them; the
 * card says so rather than leaving it to be discovered.
 *
 * **A row offers only what it can carry out.** A report's audience is persona ids and a scenario's
 * is addresses, so the note under the readers says which — and Unpublish appears only where the
 * server has that act, which is scenarios. A report has no unpublish; its equivalent is an
 * audience of nobody, and the refusal says so if anything asks.
 */
export default function GovernedArtifactCard({
  artifact,
  people,
  bases,
  pending,
  openFor,
  onToggleAccess,
  onAddReader,
  onRemoveReader,
  onUnpublish,
  onScope,
}: {
  artifact: GovernanceArtifact
  people: GovernancePerson[]
  bases: GovernanceBasis[]
  pending: string | null
  /** Which reader's access panel is open on this card, or null. A prop, so it is assertable. */
  openFor: string | null
  onToggleAccess: (email: string | null) => void
  onAddReader: (email: string) => void
  onRemoveReader: (email: string) => void
  onUnpublish: () => void
  onScope: (
    roleId: string,
    input: { rule?: { basis: string; values: string[] } | null; full?: boolean; mask?: boolean },
  ) => void
}) {
  const [adding, setAdding] = useState<string | undefined>(undefined)
  const available = people.filter((p) => !artifact.readers.includes(p.email))

  return (
    <div className="gv-card">
      <div className="gv-card-head">
        {/* The kind is a category — a scenario is not a worse artifact than a report. */}
        <Tag>{artifact.kindLabel}</Tag>
        <span className="gv-card-name">{artifact.name}</span>
        <Tag color={artifact.live ? 'success' : undefined}>{artifact.statusLabel}</Tag>
      </div>

      <div className="gv-card-meta">
        {artifact.publishedBy ? (
          <>
            Published by <strong>{artifact.publishedBy}</strong>
          </>
        ) : (
          'Publisher not recorded'
        )}
        {artifact.freshness ? ` · ${artifact.freshness}` : ''}
        {artifact.cases && artifact.cases.length > 0 ? (
          <div>Cases: {artifact.cases.join(' · ')}</div>
        ) : null}
      </div>

      <div className="gv-readers">
        {artifact.readers.length === 0 ? (
          <p className="gv-help">
            Nobody can open this — an audience of nobody, which is a decision rather than a gap.
          </p>
        ) : (
          artifact.readers.map((email) => {
            const person = people.find((p) => p.email === email) ?? null
            const open = openFor === email
            return (
              <div key={email} className="gv-reader">
                <div className="gv-reader-row">
                  <span className="gv-avatar" aria-hidden="true">
                    {(person?.name ?? email)
                      .split(/[\s.@]+/)
                      .slice(0, 2)
                      .map((w) => (w[0] ?? '').toUpperCase())
                      .join('')}
                  </span>
                  <span className="gv-reader-who">
                    <span className="gv-reader-name">{person?.name ?? email}</span>
                    <span className="gv-reader-mail">{email}</span>
                  </span>
                  {/* What their rule would admit. A category chip, not a status: a narrower
                      scope is not a worse one. */}
                  <Tag>{person ? person.resolution.summary : 'Not in the directory'}</Tag>
                  {person ? (
                    <Button size="small" onClick={() => onToggleAccess(open ? null : email)}>
                      {open ? 'Close' : 'Manage access'}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    aria-label={`Remove ${person?.name ?? email}`}
                    loading={pending === `${artifact.artifactId}|${email}`}
                    onClick={() => onRemoveReader(email)}
                  >
                    ✕
                  </Button>
                </div>

                {open && person ? (
                  <div className="gv-access">
                    <AccessRuleEditor
                      person={person}
                      bases={bases}
                      saving={pending === person.roleId}
                      onChange={(input) => onScope(person.roleId, input)}
                    />
                  </div>
                ) : null}
              </div>
            )
          })
        )}

        <div className="gv-add">
          <Select
            size="small"
            className="gv-add-select"
            value={adding}
            placeholder="Give somebody access…"
            /* The directory is the server's — Settings' users. A list written here would be a
               second answer to "who exists" and could name somebody the API refuses. */
            options={available.map((p) => ({
              value: p.email,
              label: `${p.name} · ${p.roleLabel}`,
            }))}
            disabled={available.length === 0 || pending === artifact.artifactId}
            onChange={(email: string) => {
              setAdding(undefined)
              onAddReader(email)
            }}
            showSearch
            optionFilterProp="label"
          />
          {available.length === 0 ? (
            <span className="gv-help">Everyone in Settings can already open this.</span>
          ) : null}
        </div>

        {/* Which pool this artifact's audience is actually made of. The two kinds differ, and
            saying so is what stops one being read as the other. */}
        <p className="gv-help">{artifact.audienceNote}</p>
      </div>

      <div className="gv-card-foot">
        <span className="gv-help">
          Access follows the <strong>person</strong>, not this{' '}
          {artifact.kind === 'whatif' ? 'scenario' : 'report'} — a rule changed here applies to
          everything published to them.
        </span>
        {/* Offered only where the server has the act. */}
        {artifact.canUnpublish ? (
          <Popconfirm
            title="Withdraw it?"
            description="Readers lose it immediately. The author keeps the scenario in their library."
            okText="Yes, unpublish"
            cancelText="Keep it"
            onConfirm={onUnpublish}
          >
            <Button size="small" danger loading={pending === artifact.artifactId}>
              Unpublish
            </Button>
          </Popconfirm>
        ) : null}
      </div>

      <Space size={SP.xs} />
    </div>
  )
}
