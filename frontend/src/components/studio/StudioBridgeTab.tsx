import { CheckCircleOutlined, LinkOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { BridgeBuild, TypeLink, TypeLinkDecision } from '../../api/client'
import { SP } from '../../theme'
import BridgeTypeLinks from './BridgeTypeLinks'
import LaneStages from './LaneStages'

/**
 * The Bridge — **the third artifact, beside the two graphs.**
 *
 * Shown only for a use case with both lanes, and that condition is derived from what is attached
 * rather than read off a declared field that could disagree. With only structured sources there is
 * nothing to bridge from; with only documents there is nothing to bridge to.
 *
 * **Forming a Bridge is its own step, triggered explicitly.** Two ordinary situations need it
 * re-formed without rebuilding either graph: one lane was rebuilt and the other is still good, and a
 * reviewer changed a decision and wants the record re-stated. So the trigger here is the real entry
 * point, and the Build tab's one press is the convenience that calls it last.
 *
 * **A Bridge is reviewed here and published from here.** A build no longer publishes what it
 * produced, and publishing is refused while any correspondence is undecided — so this tab carries
 * the two acts the flow follows, in order: clear the queue, then publish. They are two buttons rather
 * than one "publish as proposed" because they are two *scopes*: a reviewer who can decide but not
 * approve clears the queue here and hands over.
 *
 * **A published Bridge is frozen, and changing a decision forks it.** Nothing may change underneath
 * an approval without a version number moving to say so. Re-forming from scratch would be the wrong
 * price for correcting one link — a fresh run, and every human decision discarded — so the edit goes
 * to a copy over the same pair with every other decision carried across, and the published Bridge
 * keeps answering until that copy is published in its turn.
 *
 * **The fork happens on the edit, and the version on the publish.** Both orderings are the design
 * rather than details, and both come from the same mistake: creating something durable before the
 * user had finished saying what they wanted. No change, no copy; no approval, no version.
 */

const { Text } = Typography

const STATUS_TONE: Record<string, string> = {
  succeeded: 'green',
  running: 'processing',
  queued: 'default',
  failed: 'red',
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

export default function StudioBridgeTab({
  bridges,
  bridgeId,
  typeLinks,
  unreviewedCount,
  busy,
  sweeping,
  savingLinkId,
  publishing,
  canForm,
  laneNote,
  publishedBridgeId,
  pendingVersionNumber,
  onSelectBridge,
  onForm,
  onDecide,
  onAcceptAll,
  onPublish,
}: {
  bridges: BridgeBuild[]
  bridgeId: string | null
  typeLinks: TypeLink[]
  unreviewedCount: number
  busy: boolean
  sweeping: boolean
  savingLinkId: string | null
  publishing: boolean
  canForm: boolean
  laneNote: string | null
  publishedBridgeId: string | null
  /** The version this Bridge would publish as, where one is already recorded. `null` for a draft —
   *  which is normal, because a version is minted when somebody approves rather than when they made
   *  their first edit. */
  pendingVersionNumber: number | null
  onSelectBridge: (id: string) => void
  onForm: () => void
  onDecide: (link: TypeLink, decision: TypeLinkDecision) => void
  onAcceptAll: () => void
  onPublish: () => void
}) {
  const selected = bridges.find((b) => b.bridgeBuildId === bridgeId) ?? null
  const frozen = publishedBridgeId !== null && publishedBridgeId === bridgeId
  const published = bridges.find((b) => b.bridgeBuildId === publishedBridgeId) ?? null

  if (!canForm) {
    return (
      <Alert
        type="info"
        showIcon
        title="This use case has only one lane"
        description={
          laneNote ??
          'A Bridge holds the correspondences between a structured graph and a document graph, so a ' +
            'use case needs both to have one. Attach the other kind of source in New Graph if it should.'
        }
      />
    )
  }

  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        ◈ The Bridge stands beside the two graphs and never inside either — it holds correspondences,
        not copies, so neither lane's rebuild can delete one. It records which kinds of thing in the
        documents match which kinds of row in the warehouse, and stops there: no column, no individual
        entity, no query against your data. A Bridge never outlives its pair: rebuild either graph and
        it is re-formed, not repaired.
      </Text>

      <Space wrap align="center" size={SP.sm}>
        <Button type="primary" icon={<LinkOutlined />} loading={busy} onClick={onForm}>
          Form bridge
        </Button>
        {bridges.length > 0 ? (
          <Select<string>
            style={{ minWidth: 280 }}
            value={bridgeId ?? undefined}
            onChange={onSelectBridge}
            options={bridges.map((b) => ({
              value: b.bridgeBuildId,
              label: `Bridge build ${b.buildNumber} · ${b.status}${
                b.bridgeBuildId === publishedBridgeId ? ' · answering' : ''
              }`,
            }))}
          />
        ) : null}
      </Space>

      {published === null ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No Bridge is currently answering for this use case — a normal state, not a gap. A Bridge
          answers only once a version naming it is published.
        </Text>
      ) : (
        <Alert
          type="success"
          showIcon
          title={`Bridge build ${published.buildNumber} is answering — the published version names it.`}
        />
      )}

      {selected === null ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              No Bridge has been formed for this use case yet. Forming one reads both graphs as they
              are and adds a third thing beside them.
            </Text>
          }
        />
      ) : (
        <>
          {selected.status === 'failed' ? (
            <Alert
              type="error"
              showIcon
              title="This formation run failed. Forming a new one is safe — a Bridge is re-formed rather than repaired."
            />
          ) : null}

          {selected.status !== 'succeeded' && selected.status !== 'failed' ? (
            <Card size="small" styles={{ body: { padding: SP.md } }}>
              <LaneStages
                stages={selected.stages}
                note="Forming — each concept is put to the deriver against every entity type the corpus holds."
              />
            </Card>
          ) : null}

          <Card
            size="small"
            styles={{ header: { padding: SP.md }, body: { padding: SP.md } }}
            title={
              <Space wrap size={SP.sm} align="center">
                <Text strong>{`Bridge build ${selected.buildNumber}`}</Text>
                <Tag color={STATUS_TONE[selected.status] ?? 'default'}>{selected.status}</Tag>
              </Space>
            }
          >
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2, xl: 3 }}
              items={[
                {
                  key: 'pair',
                  label: 'Formed from',
                  children: (
                    <Text style={{ fontSize: 12 }}>
                      {`structured build ${selected.sgbBuildId.slice(0, 8)}… · document graph v${selected.dgbGraphVersion}`}
                    </Text>
                  ),
                },
                { key: 'created', label: 'Formed', children: stamp(selected.createdAt) },
                { key: 'updated', label: 'Last change', children: stamp(selected.updatedAt) },
              ]}
            />
          </Card>

          {/*
            * The act a reviewer finishes with, and only once there is something to act on. It is
            * deliberately separate from accepting: accepting is a decision about correspondences and
            * publishing is an approval of three artifacts, and a reviewer may be able to do one and
            * not the other.
            */}
          {frozen ? (
            <Alert
              type="info"
              showIcon
              title={`Bridge build ${selected.buildNumber} is published and answering.`}
              description={
                <Text style={{ fontSize: 12.5 }}>
                  Nothing may change underneath an approval without a version number moving to say so
                  — so change a decision below and it goes into a new draft copy instead, which you
                  then publish in its turn. Every other decision comes across unchanged. Nothing is
                  copied until you actually change something, and this Bridge keeps answering
                  throughout.
                </Text>
              }
            />
          ) : selected.status === 'succeeded' ? (
            <Card size="small" styles={{ body: { padding: SP.md } }}>
              <Space wrap size={SP.md} align="center">
                <Tooltip
                  title={
                    unreviewedCount > 0
                      ? `${unreviewedCount} correspondence${unreviewedCount === 1 ? '' : 's'} still to decide. Decide them below, or use “Accept all”.`
                      : undefined
                  }
                >
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={publishing}
                    disabled={unreviewedCount > 0}
                    onClick={onPublish}
                  >
                    {pendingVersionNumber === null
                      ? 'Publish new version'
                      : `Publish v${pendingVersionNumber}`}
                  </Button>
                </Tooltip>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {unreviewedCount > 0
                    ? `Publishing is blocked until every correspondence has been decided — ${unreviewedCount} to go.`
                    : 'Change as many decisions as you need first — nothing is approved until you press this. It publishes the structured graph, the document graph and this Bridge together, in one transaction: all three, or none.'}
                </Text>
              </Space>
            </Card>
          ) : null}

          <BridgeTypeLinks
            links={typeLinks}
            unreviewedCount={unreviewedCount}
            frozen={frozen}
            savingId={savingLinkId}
            sweeping={sweeping}
            onDecide={onDecide}
            onAcceptAll={onAcceptAll}
          />
        </>
      )}
    </Space>
  )
}
