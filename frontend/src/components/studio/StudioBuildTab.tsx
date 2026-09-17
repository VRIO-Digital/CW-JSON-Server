import { BuildOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Input, Progress, Row, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { BridgeBuild, DgbJob, SgbBuild, StudioUseCase } from '../../api/client'
import { SP } from '../../theme'
import DocumentPipeline from './DocumentPipeline'
import StructuredPipeline from './StructuredPipeline'
import { dur } from '../../data/duration'

/**
 * Where a use case's graphs are built — **both lanes, one button, in order.**
 *
 * The structured lane and the document lane are still two graphs: they build separately, draw
 * separately, and neither resolves its entities against the other. What this tab unifies is the
 * *act* — a use case with both lanes is built by one press rather than by knowing which of two
 * screens to visit first, which is the arrangement this replaced.
 *
 * **A build never publishes.** It records what it produced and stops; putting a version in front of
 * readers is a button on the Versions tab, for every graph. A build that published itself was
 * reported from use as a graph that "automatically got published", and it also stepped around the
 * gate rather than through it.
 */

/** The wait a run has left, from the server's own pace — never a number typed in here. */
const remaining = (build: SgbBuild) =>
  dur(Math.max(0, (build.stepTotal - build.cursor) * build.stepMs))

function LaneCard({
  title,
  subtitle,
  children,
  extra,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <Card
      size="small"
      title={
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {subtitle}
          </Typography.Text>
        </Space>
      }
      extra={extra}
      styles={{ header: { padding: SP.md }, body: { padding: SP.md } }}
    >
      {children}
    </Card>
  )
}

/**
 * The Bridge formation, narrated in the unit it really runs in.
 *
 * **One model call is one Concept**, put to the model against every Entity Type the corpus holds —
 * so the percentage is over calls, a denominator that exists, and the links figure is the product of
 * the two rather than a third number counted beside them. Every figure is the server's: a client
 * that worked out how many calls a grid needs would be a second answer to how long this takes.
 */
function BridgeFormation({ bridge }: { bridge: BridgeBuild }) {
  const pct =
    bridge.modelCallsTotal > 0
      ? Math.round((bridge.modelCallsDone / bridge.modelCallsTotal) * 100)
      : 0
  return (
    <Alert
      type="info"
      showIcon
      title={
        <Space wrap size={SP.sm} align="center">
          <Typography.Text strong>Asking the model</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {`${bridge.modelCallsDone} of ${bridge.modelCallsTotal} model calls · ${bridge.conceptCount} Concepts × ${bridge.entityTypeCount} Entity Types`}
          </Typography.Text>
        </Space>
      }
      description={
        <>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {/* Said because it is otherwise read as a run that is deciding nothing: the
                correspondences are committed together at the end, so the list stays empty
                throughout however far the bar has gone. */}
            {`${bridge.linksWritten.toLocaleString()} links written so far — they appear below all at once when the run commits.`}
          </Typography.Text>
        </>
      }
    />
  )
}

export default function StudioBuildTab({
  useCase,
  sgbBuild,
  dgbJob,
  formingBridge,
  bridgeFollows,
  story,
  storyDraft,
  drafting,
  building,
  busy,
  onBuild,
  onDraft,
  onSaveStory,
}: {
  useCase: StudioUseCase
  sgbBuild: SgbBuild | null
  dgbJob: DgbJob | null
  /** The Bridge formation in flight, where one is — the run's own last stage. */
  formingBridge: BridgeBuild | null
  /** True across the whole of it, including the beat between the lanes landing and the formation
   *  appearing: a strip that blinked out there would read as a run that stopped. */
  bridgeFollows: boolean
  story: { story: string; editedByUser: boolean; uncertainties: string[] } | null
  storyDraft: string | null
  drafting: boolean
  building: boolean
  busy: boolean
  onBuild: (story?: string) => void
  onDraft: () => void
  onSaveStory: (story: string) => void
}) {
  const [text, setText] = useState('')

  /*
   * The editor follows whichever account of the story is current — a fresh draft wins over the
   * stored one, because the reader just asked for it. Reset on the use case changing as well as on
   * the text, or switching use cases would leave one graph's story in the box under another's name.
   */
  useEffect(() => {
    setText(storyDraft ?? story?.story ?? '')
  }, [storyDraft, story?.story, useCase.useCaseId])

  const nothingAttached = !useCase.hasStructured && !useCase.hasDocuments
  /* The Bridge formation counts: it is the same act's last stage, and a button offering a rebuild
     while the model is still being asked would start a run that discards the one in flight. */
  const running =
    sgbBuild?.status === 'running' || dgbJob?.status === 'running' || building || bridgeFollows

  return (
    <Space direction="vertical" size={SP.base} style={{ width: '100%' }}>
      {nothingAttached ? (
        <Alert
          type="warning"
          showIcon
          title="Nothing is attached to this use case"
          description={
            'A graph with no inputs can answer nothing. Pick a source — a BigQuery project, a drive ' +
            'or a mailbox — on step 2 of New Graph, then come back and build.'
          }
        />
      ) : null}

      {/*
       * What the use case has, stated rather than implied by which panels happen to be drawn. A lane
       * a reader expected and does not have is the question this tab has to answer, and a missing
       * card is not an answer.
       */}
      {/* The run's last stage, above the lanes it was formed from. Drawn for the whole formation —
          `bridgeFollows` covers the beat before the build row exists, where a strip that waited for
          it would blink out between the lanes landing and the model being asked. */}
      {formingBridge ? (
        <BridgeFormation bridge={formingBridge} />
      ) : bridgeFollows ? (
        <Alert
          type="info"
          showIcon
          title="Both lanes have landed. Forming the Bridge between them."
        />
      ) : null}

      <Space size={SP.sm} wrap>
        <Tag color={useCase.hasStructured ? 'blue' : 'default'}>
          {useCase.hasStructured
            ? `Structured lane · ${useCase.structuredTableCount} table${useCase.structuredTableCount === 1 ? '' : 's'}`
            : 'No structured lane'}
        </Tag>
        <Tag color={useCase.hasDocuments ? 'purple' : 'default'}>
          {useCase.hasDocuments
            ? `Document lane · ${useCase.documentCount} document${useCase.documentCount === 1 ? '' : 's'}`
            : 'No document lane'}
        </Tag>
      </Space>

      <Row gutter={[SP.base, SP.base]}>
        {useCase.hasStructured ? (
          <Col xs={24} xl={12}>
            <LaneCard
              title="Structured lane"
              subtitle="Tables, the columns profiled on them, and the concepts those realise."
              extra={
                sgbBuild ? (
                  <Tag color={sgbBuild.status === 'complete' ? 'green' : 'processing'}>
                    {sgbBuild.name} · {sgbBuild.status}
                  </Tag>
                ) : null
              }
            >
              {sgbBuild ? (
                <>
                  {/* The lane's own trace, not the shared stage list: these are phases of a build
                      rather than things done to a corpus, so they read as a log. */}
                  <StructuredPipeline build={sgbBuild} />
                  {sgbBuild.status === 'running' ? (
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', marginTop: SP.sm, fontSize: 12.5 }}
                    >
                      {`About ${remaining(sgbBuild)} left, at the server's own pace.`}
                    </Typography.Text>
                  ) : null}
                  {sgbBuild.status === 'complete' ? (
                    <Space size={SP.sm} wrap style={{ marginTop: SP.md }}>
                      {/* Nullable counts are printed as an em dash rather than 0: an unfinished
                          build has counted nothing, and 0 would say the graph is empty. */}
                      <Tag>{sgbBuild.tableCount ?? '—'} tables</Tag>
                      <Tag>{sgbBuild.columnCount ?? '—'} columns</Tag>
                      <Tag>{sgbBuild.conceptCount ?? '—'} concepts</Tag>
                      <Tag>{sgbBuild.relationCount ?? '—'} edges</Tag>
                    </Space>
                  ) : null}
                </>
              ) : (
                <Typography.Text type="secondary">
                  Not built yet. The build reads this use case's profiled tables and the columns
                  recorded against them.
                </Typography.Text>
              )}
            </LaneCard>
          </Col>
        ) : null}

        {useCase.hasDocuments ? (
          <Col xs={24} xl={12}>
            <LaneCard
              title="Document lane"
              subtitle="The corpus, the entities extracted from it, and what each resolved to."
              extra={
                dgbJob ? (
                  <Tag color={dgbJob.status === 'complete' ? 'green' : 'processing'}>
                    {dgbJob.status}
                  </Tag>
                ) : null
              }
            >
              {dgbJob ? (
                /* Its own component rather than the shared stage list: this lane reports a
                   percentage over stages, a running count over the corpus, and a live phrase under
                   whichever stage is in flight — none of which the structured lane has. */
                <DocumentPipeline job={dgbJob} />
              ) : (
                <Typography.Text type="secondary">
                  Not built yet. {useCase.documentCount} document
                  {useCase.documentCount === 1 ? '' : 's'} are in scope for this use case.
                </Typography.Text>
              )}
            </LaneCard>
          </Col>
        ) : null}
      </Row>

      {useCase.hasStructured ? (
        <Card
          size="small"
          title="The story this graph is extracted from"
          styles={{ header: { padding: SP.md }, body: { padding: SP.md } }}
          extra={
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={drafting}
              onClick={onDraft}
            >
              {/* The busy label narrates the act rather than repeating the control's name, which is
                  the rule every paced run here keeps. */}
              {drafting ? 'Reading the data model' : 'Draft from my data model'}
            </Button>
          }
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
            This is the structured lane's human-in-the-loop surface: the words the graph's structure
            is derived from. Editing it re-runs the extraction — the build goes back to running and
            the stages above narrate it again.{' '}
            {story?.editedByUser
              ? 'These are your own words.'
              : 'Nothing has been typed here yet, so this is composed from the use case’s business need. ' +
                '“Draft from my data model” replaces it with a description of the data itself — the tables in ' +
                'scope, the grain each states, the columns profiled against them and the joins Data Modeling ' +
                'holds. No model wrote either: every clause is read out of this dataset’s own document.'}
          </Typography.Paragraph>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Describe what this data is, in your own words."
          />
          {story && story.uncertainties.length > 0 ? (
            <Alert
              style={{ marginTop: SP.md }}
              type="info"
              showIcon
              title="What the derivation could not settle"
              description={story.uncertainties.join(' · ')}
            />
          ) : null}
          <Space style={{ marginTop: SP.md }}>
            <Button
              onClick={() => onSaveStory(text)}
              loading={busy}
              disabled={!sgbBuild || running || !text.trim()}
            >
              Save and re-extract
            </Button>
            {sgbBuild?.publishedAt ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                This build is published, so its story is frozen — unpublish the version first.
              </Typography.Text>
            ) : null}
          </Space>
        </Card>
      ) : null}

      <Space>
        <Button
          type="primary"
          icon={<BuildOutlined />}
          loading={running}
          disabled={nothingAttached}
          onClick={() => onBuild(text.trim() || undefined)}
        >
          {running ? 'Building' : sgbBuild || dgbJob ? 'Rebuild graph' : 'Build graph'}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          Runs every lane this use case has at the same time, then forms the Bridge once both have
          finished — a Bridge is formed FROM two finished graphs, so it cannot run beside them. A lane
          that fails does not stop the other, and no Bridge is formed unless both succeed.
          Nothing is published by building: publishing approves all three together, on the Bridge tab.
        </Typography.Text>
      </Space>
    </Space>
  )
}
