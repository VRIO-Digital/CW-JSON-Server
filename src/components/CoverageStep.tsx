import { BarChartOutlined } from '@ant-design/icons'
import { Empty, Spin, Typography } from 'antd'
import type {
  CoverageElement,
  CoveragePayload,
  GapChoice,
  GapDecision,
} from '../api/client'
import { SP } from '../theme'
import '../pages/NewGraphPage.css'

const DECISIONS: GapDecision[] = [
  'accept permanent',
  'drop question',
  'connect source',
  'defer with trigger',
]

/*
 * Step 7 of New Graph: what the AI derived, checked against the catalogue.
 *
 * Every backed element names the profiled object it came from — an entity *is*
 * a profiled table or document, and its evidence line says which one, how big it
 * is, and how well it matched. A gap names what is missing instead, and cannot
 * be silently ignored: the build stays blocked until each one has a decision.
 */
export default function CoverageStep({
  data,
  loading,
  decisions,
  onDecisions,
}: {
  data: CoveragePayload | null
  loading: boolean
  decisions: GapChoice[]
  onDecisions: (decisions: GapChoice[]) => void
}) {
  const decisionFor = (elementId: string) =>
    decisions.find((d) => d.elementId === elementId)?.decision

  function decide(elementId: string, decision: GapDecision) {
    onDecisions([
      ...decisions.filter((d) => d.elementId !== elementId),
      { elementId, decision },
    ])
  }

  if (loading && !data) return <Spin />

  if (!data) {
    return (
      <Empty
        image={null}
        description="Nothing derived yet — go back and pick the sources this use case draws on."
      />
    )
  }

  if (data.objectCount === 0) {
    return (
      <Empty
        image={null}
        description="No profiled objects are selected, so there is nothing to derive from. Step 4 is where a use case picks the tables and documents it draws on."
      />
    )
  }

  const undecided = data.elements.filter(
    (e) => e.status === 'gap' && !decisionFor(e.elementId),
  ).length

  return (
    <>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {data.title}
      </Typography.Title>

      <Typography.Paragraph className="ng-cov-summary">
        {`Derived ${data.entityCount} entities, ${data.relationshipCount} relationships from ${data.heroQuestionCount} hero questions · checked against the catalogue. `}
        {data.gapCount === 0
          ? 'Backed elements show their evidence, and nothing is missing.'
          : `Backed elements show their evidence; each of the ${data.gapCount} gaps needs a decision before you can build.`}
      </Typography.Paragraph>

      {data.elements.map((element: CoverageElement) => {
        const gap = element.status === 'gap'
        const chosen = decisionFor(element.elementId)
        return (
          <div
            key={element.elementId}
            className={`ng-cov${gap ? ' is-gap' : ''}`}
          >
            <div className="ng-cov-head">
              {gap ? (
                <span className="ng-cov-mark" aria-hidden="true">
                  ◆
                </span>
              ) : null}
              <span className="ng-cov-name">{element.name}</span>
              <span className="ng-cov-kind">{element.kind}</span>

              <span className="ng-cov-right">
                <span className={`ng-conf${gap ? ' is-low' : ''}`}>
                  <BarChartOutlined /> {gap ? 'Low' : 'High'}{' '}
                  {element.confidence.toFixed(2)}
                </span>
                <span className={`ng-cov-status${gap ? ' is-gap' : ''}`}>
                  {gap ? 'gap' : 'backed'}
                </span>
              </span>
            </div>

            {/* Where it came from — the profiled object itself. */}
            {element.evidence ? (
              <div className="ng-cov-evidence">{element.evidence}</div>
            ) : null}

            {element.reason ? (
              <div className="ng-cov-reason">{element.reason}</div>
            ) : null}

            {gap ? (
              <div className="ng-cov-actions">
                {DECISIONS.map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    className={`ng-cov-btn${chosen === decision ? ' is-on' : ''}`}
                    aria-pressed={chosen === decision}
                    onClick={() => decide(element.elementId, decision)}
                  >
                    {decision}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {undecided > 0 ? (
        <div className="ng-source-warn" style={{ marginTop: SP.md }}>
          {undecided} gap(s) still need a decision — the graph cannot be built until
          every one is answered.
        </div>
      ) : null}
    </>
  )
}
