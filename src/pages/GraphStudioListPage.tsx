import {
  ArrowRightOutlined,
  DeploymentUnitOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { Button, Spin, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ApiErrorAlert from '../components/ApiErrorAlert'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import StatusTag from '../components/StatusTag'
import { selectGraphs, useStudioGraphsStore } from '../store/graphStudioStore'
import { SP } from '../theme'
import './GraphStudioPage.css'

const formatBuilt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'unknown'

/** The path from nothing to a published graph — the studio's own three steps. */
const BUILD_STEPS = [
  { title: 'Describe the need', detail: 'New Graph — seven steps, no entity names' },
  { title: 'Build it', detail: 'the AI derives entities and relationships' },
  { title: 'Review & publish', detail: 'settle what it was unsure about' },
]

/**
 * The studio's front door: the graphs that have been built.
 *
 * A use case still in the wizard is deliberately not listed — there is nothing
 * to review until it is committed — but the count of them is shown, because
 * "you have three drafts" is the answer to "where is my graph?".
 */
export default function GraphStudioListPage() {
  const navigate = useNavigate()

  const data = useStudioGraphsStore((s) => s.data)
  const loading = useStudioGraphsStore((s) => s.loading)
  const error = useStudioGraphsStore((s) => s.error)
  const load = useStudioGraphsStore((s) => s.load)
  const graphs = useStudioGraphsStore(selectGraphs)

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ApiErrorAlert error={error} onRetry={() => void load()} />

  return (
    <>
      <PageHeader
        title="Graph Studio"
        subtitle="Where a drafted graph becomes the trusted graph. Open a build to review what the deriver wasn’t sure about, shape the ontology, prove it answers — then publish."
        actions={
          <Button icon={<PlusOutlined />} onClick={() => navigate('/new-graph')}>
            New graph
          </Button>
        }
      />

      {loading && !data ? (
        <Spin />
      ) : graphs.length === 0 ? (
        /*
         * The same shell as NoSourceConnected — an empty page here is a page
         * before a step has been taken, not a failure, and the steps say which
         * step. The copy changes with the draft count, because "you have two
         * drafts" and "you have nothing" need different next actions.
         */
        <EmptyState
          icon={<DeploymentUnitOutlined />}
          title="No graphs have been built yet"
          detail={
            data?.draftCount
              ? `${data.draftCount} use case(s) are already in the wizard. Finish one and use “Save & build graph” — it will appear here with everything the deriver was unsure about.`
              : 'A graph is built from a business need you describe. Once one is built, this is where you review what the deriver was unsure about, prove it answers, and publish it.'
          }
          action={
            <Button type="primary" size="large" onClick={() => navigate('/new-graph')}>
              {data?.draftCount ? 'Finish a draft' : 'Describe a business need'}
            </Button>
          }
          steps={BUILD_STEPS}
          footnote="You never type an entity name — the AI derives the graph from your brief."
        />
      ) : (
        <>
          {graphs.map((g) => (
            <button
              key={g.useCaseId}
              type="button"
              className="gs-card"
              onClick={() => navigate(`/graph-studio/${encodeURIComponent(g.useCaseId)}`)}
            >
              <span className="gs-card-main">
                <span className="gs-card-title">{g.name}</span>

                {/* What is live, then the domain. The draft version is not
                    shown: it is an internal counter until something is
                    published, and the studio names it on the Publish button
                    when it matters. */}
                <span className="gs-card-tags">
                  {g.liveVersion ? (
                    <Tag color="success">{`live ${g.liveVersion}`}</Tag>
                  ) : (
                    <Tag>never published</Tag>
                  )}
                  {g.domainId ? <Tag>{g.domainId}</Tag> : null}
                </span>

                <span className="gs-card-note">
                  {g.businessNeed || 'No business need recorded.'}
                </span>
                <span className="gs-card-meta">built {formatBuilt(g.builtAt)}</span>
              </span>

              <span className="gs-card-right">
                {/* The one number that decides whether this graph can ship. */}
                <StatusTag tone={g.queueCount > 0 ? 'warn' : 'good'}>
                  {g.queueCount > 0
                    ? `${g.queueCount} to review`
                    : 'review complete'}
                </StatusTag>
                <ArrowRightOutlined aria-hidden="true" />
              </span>
            </button>
          ))}

          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: SP.base }}
          >
            {data?.count ?? 0} built · {data?.draftCount ?? 0} still in the wizard.
            A draft has nothing to review until it is committed on step 7.
          </Typography.Paragraph>
        </>
      )}
    </>
  )
}
