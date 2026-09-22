import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useMemo, useState } from 'react'
import type { TypeLink, TypeLinkDecision } from '../../api/client'
import { typeLinkNeedsReview } from '../../api/client'
import { SP } from '../../theme'

/**
 * Type Links — the kinds of thing that correspond, and how. **This is the Bridge's entire output.**
 *
 * Each row says a document entity type corresponds to a structured concept as `identity` or
 * `attribute`, or does not (`reject`). No row names a column, and nothing projects one onto
 * individual entities.
 *
 * Three things this screen must not misrepresent, because each is a rule rather than a preference:
 *
 * - **The decision is three-way.** A person and a place are both "not a facility", but one rejects
 *   while the other corresponds as an attribute. Accept/reject cannot express that, so the control
 *   is a three-way select.
 * - **Rejects are part of the record**, not noise to hide. The list is what was *considered*, which
 *   is what makes "the deriver declined this" distinguishable from "nobody asked".
 * - **The original recommendation is kept beside an override**, so the deriver can be measured over
 *   time rather than silently corrected.
 *
 * **Volume is why the filter is load-bearing rather than a convenience.** Every (entity type ×
 * concept) pair gets a row, so a list is `types × concepts` and the large majority are rejects. The
 * default view hides them and the count line says how many, so nobody mistakes the filter for the
 * whole answer.
 *
 * Rows arrive **low-confidence first** from the server and are never re-sorted here — that ordering
 * is the answer to "where was the judgement closest?".
 */

const { Text, Paragraph } = Typography

const DECISION_MEANING: Record<string, string> = {
  identity: 'a thing of this kind IS what one row of the concept represents',
  attribute: 'a thing of this kind is a VALUE of an attribute of such a row',
  reject: 'neither',
}

const DECISION_COLOUR: Record<string, string> = {
  identity: 'geekblue',
  attribute: 'cyan',
  reject: 'default',
}

const DECISION_OPTIONS = (['identity', 'attribute', 'reject'] as TypeLinkDecision[]).map((d) => ({
  value: d,
  label: `${d} — ${DECISION_MEANING[d]}`,
}))

/**
 * `needs-review` and `low` both cut **across** the decision filters.
 *
 * Every "decision" value selects by `decision`. `low` selects by `confidence`, so a low-confidence
 * identity link appears under both *Identity* and *Low confidence* — that is the point of it, and it
 * is the only way to reach a low-confidence **reject**, which is where a missed correspondence hides.
 *
 * `needs-review` selects on one thing: nobody has decided it. It is the publish gate made visible,
 * so it is the default while there is work — but never the only view, because the record of what was
 * considered is the other half of what this screen is for. It covers rejects, so before anybody
 * decides anything it counts exactly what *All* does.
 */
type Filter =
  | 'needs-review'
  | 'corresponding'
  | 'identity'
  | 'attribute'
  | 'reject'
  | 'low'
  | 'all'

/**
 * The per-row control: accept what the deriver decided, or change it.
 *
 * **One action, not two.** Accept and change are the same write — the decision either stays what was
 * proposed or does not — and the button says which one the current selection amounts to. Splitting
 * them would imply accepting is a lesser act than changing, when the record they write is identical:
 * your name, the time, and the verdict that now stands.
 */
function DecisionForm({
  link,
  onSave,
  saving,
  frozen,
}: {
  link: TypeLink
  onSave: (decision: TypeLinkDecision) => void
  saving: boolean
  frozen: boolean
}) {
  const [decision, setDecision] = useState<TypeLinkDecision>(link.decision)

  /* Reset-on-prop-change during render rather than in an effect: after a save the row comes back with
     a new effective value and the form must follow, or the next edit starts from what the person
     chose last time instead of from what now stands. */
  const [lastSeen, setLastSeen] = useState(link.updatedAt)
  if (link.updatedAt !== lastSeen) {
    setLastSeen(link.updatedAt)
    setDecision(link.decision)
  }

  const changed = decision !== link.decision
  const outstanding = typeLinkNeedsReview(link)

  return (
    <Space direction="vertical" size={SP.xs} style={{ width: '100%' }}>
      <Space wrap size={SP.sm}>
        <Select<TypeLinkDecision>
          size="small"
          style={{ minWidth: 300 }}
          value={decision}
          onChange={setDecision}
          options={DECISION_OPTIONS}
          optionRender={(o) => <span>{String(o.value)}</span>}
        />
        <Tooltip
          title={
            frozen && changed
              ? 'This Bridge is published, so the change goes to a new draft copy rather than to the Bridge that is answering.'
              : undefined
          }
        >
          <Button
            size="small"
            type={outstanding || changed ? 'primary' : 'default'}
            loading={saving}
            /*
             * Only a no-op is disabled: nothing to change **and** already decided by a person. An
             * outstanding row's unchanged selection is *not* a no-op — accepting it is exactly the
             * act the gate is waiting for. Never disabled merely because the Bridge is published: a
             * change is the very thing that creates the draft to make it on.
             */
            disabled={!changed && !outstanding}
            onClick={() => onSave(decision)}
          >
            {changed ? (frozen ? 'Change in a draft' : 'Save change') : outstanding ? 'Accept' : 'Revise'}
          </Button>
        </Tooltip>
      </Space>
      <Text type="secondary" style={{ fontSize: 11.5 }}>
        {frozen
          ? 'This Bridge is answering. Changing a decision creates a draft copy to make it on — this one keeps answering until you publish the draft.'
          : outstanding
            ? 'Accepting records the derived verdict as your decision — that is what publishing needs. Change it first if you disagree.'
            : 'Decided. The decision is the only thing this sets — a Type Link names no column and no entity.'}
      </Text>
    </Space>
  )
}

export default function BridgeTypeLinks({
  links,
  unreviewedCount,
  frozen,
  savingId,
  sweeping,
  onDecide,
  onAcceptAll,
}: {
  links: TypeLink[]
  /** **The server's own count**, never derived here: a second expression of the gate's predicate is
   *  a screen reading "nothing left" over a server that refuses the publish. */
  unreviewedCount: number
  frozen: boolean
  savingId: string | null
  sweeping: boolean
  onDecide: (link: TypeLink, decision: TypeLinkDecision) => void
  onAcceptAll: () => void
}) {
  /* `null` until a filter is chosen, because the default *depends* on whether there is work: landing
     on the queue for a fully-reviewed Bridge would show an empty state as its opening frame. */
  const [filter, setFilter] = useState<Filter | null>(null)

  const counts = useMemo(() => {
    const by = { identity: 0, attribute: 0, reject: 0, low: 0 }
    for (const l of links) {
      if (l.decision === 'identity') by.identity += 1
      else if (l.decision === 'attribute') by.attribute += 1
      else if (l.decision === 'reject') by.reject += 1
      if (l.confidence === 'low') by.low += 1
    }
    return by
  }, [links])

  /* Land on the work while there is work; on the record once there is none. A reviewer opening a
     cleared Bridge later wants to see what corresponds, not an empty queue. */
  const active: Filter = filter ?? (unreviewedCount > 0 ? 'needs-review' : 'corresponding')

  const shown = useMemo(() => {
    if (active === 'all') return links
    /* The two cross-cutting filters first, so neither can be mistaken for a decision match. */
    if (active === 'needs-review') return links.filter(typeLinkNeedsReview)
    if (active === 'low') return links.filter((l) => l.confidence === 'low')
    if (active === 'corresponding') return links.filter((l) => l.decision !== 'reject')
    return links.filter((l) => l.decision === active)
  }, [links, active])

  if (links.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            No Type Links. Either this corpus has no entity types or this build has no concepts — an
            honest empty answer, not a failure.
          </Text>
        }
      />
    )
  }

  /** Every pair put to the deriver — the denominator the review progress is measured against, and
   *  the same set the *Needs review* chip counts, because the gate now covers rejects too. Measuring
   *  progress over a narrower set than the gate blocks on is a bar at 100% over a refused publish. */
  const corresponding = links.length
  const reviewed = corresponding - unreviewedCount

  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      {/* Review progress, above the record: what a reviewer needs first is how much is left and how
          to finish it. The composition of the list is context for that, not the headline. */}
      {corresponding > 0 ? (
        <Card size="small" styles={{ body: { padding: SP.md } }}>
          <Space direction="vertical" size={SP.sm} style={{ width: '100%' }}>
            <Space wrap size={SP.md} align="center">
              <Text strong style={{ fontSize: 13 }}>
                {unreviewedCount === 0
                  ? `All ${corresponding} correspondence${corresponding === 1 ? '' : 's'} decided`
                  : `${unreviewedCount} of ${corresponding} correspondence${corresponding === 1 ? '' : 's'} still to decide`}
              </Text>
              <Progress
                percent={corresponding === 0 ? 100 : Math.round((reviewed / corresponding) * 100)}
                size="small"
                status={unreviewedCount === 0 ? 'success' : 'active'}
                style={{ minWidth: 180, maxWidth: 260, marginBottom: 0 }}
              />
              {unreviewedCount > 0 && !frozen ? (
                <Popconfirm
                  title="Accept the rest as proposed?"
                  description={
                    <span style={{ maxWidth: 320, display: 'inline-block' }}>
                      {`${unreviewedCount} correspondence${unreviewedCount === 1 ? '' : 's'} will be recorded as your decision, with the verdict that was proposed. Rows you already decided are untouched.`}
                    </span>
                  }
                  okText="Accept all"
                  cancelText="Cancel"
                  onConfirm={onAcceptAll}
                >
                  {/*
                    * **Primary, like the row's own Accept**, because it is the same act at a
                    * different scale — and with the gate covering every pair it is the act a reader
                    * arrives to make. A default button beside a row of orange ones read as the
                    * lesser control, which is the reverse of true here.
                    *
                    * It is not destructive and needs no danger tint: it records the verdict already
                    * proposed on each row, every one keeps its own Reject as the way back, and the
                    * `Popconfirm` states the count before anything is written.
                    */}
                  <Button size="small" type="primary" loading={sweeping}>
                    {`Accept all (${unreviewedCount})`}
                  </Button>
                </Popconfirm>
              ) : null}
            </Space>
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {unreviewedCount === 0
                ? 'Publishing is no longer blocked by review — every pair the deriver was put has somebody’s decision on it.'
                : 'Publishing a version naming this Bridge is refused until every pair has been decided — accepting the derived verdict counts. Rejected pairs are counted too: a decline is the deriver’s proposal, and disagreeing with one is where a missed correspondence is found.'}
            </Text>
          </Space>
        </Card>
      ) : null}

      <Text type="secondary" style={{ fontSize: 12 }}>
        {`◈ ${links.length} pair${links.length === 1 ? '' : 's'} considered, low confidence first — ${counts.identity} identity · ${counts.attribute} attribute · ${counts.reject} reject${counts.low > 0 ? ` · ${counts.low} decided with low confidence` : ''}. Every (entity type × concept) pair is put to the deriver, so the rejects are the record of what it declined, not gaps.`}
      </Text>

      <Segmented<Filter>
        size="small"
        value={active}
        onChange={setFilter}
        options={[
          { value: 'needs-review', label: `Needs review (${unreviewedCount})` },
          { value: 'corresponding', label: 'Corresponding' },
          { value: 'identity', label: `Identity (${counts.identity})` },
          { value: 'attribute', label: `Attribute (${counts.attribute})` },
          { value: 'reject', label: `Rejected (${counts.reject})` },
          { value: 'low', label: `Low confidence (${counts.low})` },
          { value: 'all', label: `All (${links.length})` },
        ]}
      />

      {shown.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {`Nothing under this filter.${
                active === 'needs-review'
                  ? ' Every pair has been decided — nothing here is blocking a publish.'
                  : active === 'corresponding'
                    ? ' Every pair was rejected — the documents and this warehouse may simply describe different things.'
                    : ''
              }`}
            </Text>
          }
        />
      ) : null}

      {shown.map((link) => (
        <Card key={link.typeLinkId} size="small" styles={{ body: { padding: SP.md } }}>
          <Space direction="vertical" size={SP.sm} style={{ width: '100%' }}>
            <Space wrap size={SP.sm} align="center">
              <Text strong>{link.entityType}</Text>
              <Text type="secondary">→</Text>
              <Text strong>{link.conceptName}</Text>
              <Tooltip
                title={
                  link.conceptDeclared
                    ? 'A declared concept: named by the use case’s own brief, so it cannot move underneath this link.'
                    : 'A derived concept: read off the canvas rather than declared by the brief.'
                }
              >
                <Tag>{link.conceptDeclared ? 'declared' : 'derived'}</Tag>
              </Tooltip>
              <Tooltip title={DECISION_MEANING[link.decision] ?? ''}>
                <Tag color={DECISION_COLOUR[link.decision] ?? 'default'}>{link.decision}</Tag>
              </Tooltip>
              <Tag color={link.confidence === 'low' ? 'warning' : 'default'}>
                {`${link.confidence} confidence`}
              </Tag>
              <Tag color={link.decidedBy === 'human' ? 'purple' : 'blue'}>
                {`decided by ${link.decidedBy}`}
              </Tag>
            </Space>

            <Paragraph style={{ marginBottom: 0, fontSize: 13 }}>{link.reason}</Paragraph>

            {/* The original recommendation, kept beside the override rather than replaced — which is
                what lets the deriver be measured over time instead of silently corrected. */}
            {link.originalDecision !== null ? (
              <Alert
                type="info"
                style={{ fontSize: 12 }}
                title={`The deriver originally said “${link.originalDecision}”${
                  link.originalConfidence ? ` (${link.originalConfidence} confidence)` : ''
                }`}
                description={<Text style={{ fontSize: 12 }}>{link.originalReason}</Text>}
              />
            ) : null}

            <DecisionForm
              link={link}
              saving={savingId === link.typeLinkId}
              frozen={frozen}
              onSave={(decision) => onDecide(link, decision)}
            />
          </Space>
        </Card>
      ))}
    </Space>
  )
}
