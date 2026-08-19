import { Button, Select, Space, Switch, Tag } from 'antd'
import { useState } from 'react'
import type { GovernanceBasis, GovernancePerson } from '../api/client'
import { SP } from '../theme'

/*
 * One persona's access rule: the field a restriction runs on, and the values it admits.
 *
 * **Its own component, and its expanded state is a prop.** A panel behind the parent's `useState`
 * cannot be asserted on — `renderToString` renders the closed one — which is the rule
 * `ConnectSourceWizard` and `ReaderFinder` already follow.
 *
 * **The rule is recorded, not enforced**, and this component never says otherwise. It prints what
 * the rule *would* admit against today's register (`resolution`, computed on the server) and the
 * page states the caveat above it. A line here reading "sees 32 of 36" without that caveat would
 * be claiming a filter this app does not run.
 *
 * Two stages, like the mockup: pick the **basis**, then the **values**. The basis list is the
 * register's own — its identity column plus the fields the dictionary declares filterable — so a
 * restriction cannot run on a field no report could slice by.
 */
export default function AccessRuleEditor({
  person,
  bases,
  saving,
  onChange,
}: {
  person: GovernancePerson
  bases: GovernanceBasis[]
  saving: boolean
  onChange: (input: {
    rule?: { basis: string; values: string[] } | null
    full?: boolean
    mask?: boolean
  }) => void
}) {
  /* Which rows the resolution names. Local, because expanding a list is for reading. */
  const [showRows, setShowRows] = useState(false)
  const basis = person.rule ? (bases.find((b) => b.basis === person.rule!.basis) ?? null) : null
  const first = person.name.split(' ')[0]

  return (
    <div className="gv-rule">
      {/* What the tenant authored for this persona, beside the rule rather than instead of it —
          two different things, and collapsing them would lose the one nobody typed here. */}
      {person.declared ? (
        <p className="gv-help">
          Authored scope: <strong>{person.declared}</strong>
          {person.maskedColumns ? ` · masked: ${person.maskedColumns}` : ''}
        </p>
      ) : null}

      <div className="gv-rule-row">
        <span className="gv-label">Restrict by</span>
        <Select
          className="gv-basis"
          size="small"
          value={person.full ? '__all__' : (person.rule?.basis ?? undefined)}
          placeholder="Pick a field…"
          disabled={saving}
          onChange={(value) =>
            value === '__all__'
              ? onChange({ full: true, rule: null })
              : /* A new basis starts with no values: carrying the old ones over would silently
                   admit a set nobody picked under this field. */
                onChange({ rule: { basis: value, values: [] } })
          }
          options={[
            { value: '__all__', label: 'Nothing — sees the whole register' },
            ...bases.map((b) => ({
              value: b.basis,
              label: `${b.label} · ${b.values.length} value${b.values.length === 1 ? '' : 's'}`,
            })),
          ]}
        />

        {basis ? (
          <Select
            className="gv-values"
            size="small"
            mode="multiple"
            allowClear
            value={person.rule?.values ?? []}
            placeholder={`Which ${basis.label.toLowerCase()} values?`}
            disabled={saving}
            onChange={(values: string[]) => onChange({ rule: { basis: basis.basis, values } })}
            options={basis.values.map((v) => ({
              value: v.value,
              /* The count is on the option, so an empty value reads as "nothing qualifies"
                 rather than as a control that failed to fill. */
              label: `${v.label} · ${v.count}`,
            }))}
            optionFilterProp="label"
            maxTagCount="responsive"
          />
        ) : null}
      </div>

      <p className="gv-help">{/* Why this list and not another. */}
        {basis?.identity
          ? 'Restricting by the identity column names rows one at a time.'
          : null}
      </p>

      <div className="gv-rule-foot">
        <Space size={SP.sm} wrap>
          {/* A category, never a status: "sees everything" is not a better state than a rule. */}
          <Tag>{person.resolution.summary}</Tag>
          <span className="gv-resolves">
            Resolves to{' '}
            <strong>
              {person.resolution.count} of {person.resolution.total}
            </strong>{' '}
            generators today
          </span>
          {person.resolution.sample.length > 0 ? (
            <Button size="small" type="link" onClick={() => setShowRows((open) => !open)}>
              {showRows ? 'hide them' : 'show them'}
            </Button>
          ) : null}
        </Space>

        <label className="gv-mask">
          <Switch
            size="small"
            checked={person.mask}
            disabled={saving}
            onChange={(mask) => onChange({ mask })}
          />
          Totals only — mask row figures
        </label>
      </div>

      {/* Named rows, because "32 of 36" is not checkable and a list of names is. */}
      {showRows && person.resolution.sample.length > 0 ? (
        <p className="gv-sample">{person.resolution.sample.join(' · ')}</p>
      ) : null}

      <p className="gv-help">
        The rule belongs to <strong>{person.roleLabel}</strong>, not to {first} alone — anyone else
        signing in as that persona carries it too.
      </p>
    </div>
  )
}
