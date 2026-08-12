import { DeploymentUnitOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'

/** The path from a built graph to a live one — where the publish button actually is. */
const STEPS = [
  { title: 'Open the graph', detail: 'Graph Studio lists every built graph' },
  { title: 'Clear the review queue', detail: 'and settle the entity-resolution pivot' },
  { title: 'Publish a version', detail: 'on that build’s row, under Versions' },
]

/**
 * Shown where a page reads the **published** graph and nothing has been published.
 *
 * A separate state from `NoSourceConnected`, because the fix is a different one: data is
 * connected and a graph may even be built, but nothing is live, and only publishing makes
 * it so. Ask has said this in its own copy since it shipped; Reports and the What-if lens
 * share this component so the three cannot describe the same precondition three ways.
 *
 * The counts change the copy, not the look — "you have a graph, publish it" and "you have
 * nothing built yet" need different next actions, and a page that offered the same one
 * for both would send half its readers to the wrong screen.
 */
export default function NoPublishedGraph({
  detail,
  builtCount,
  draftCount,
}: {
  /** What specifically appears here once a graph is live. */
  detail: string
  /** Graphs committed on step 7 — publishable today. */
  builtCount: number
  /** Use cases still in the wizard, which have nothing to publish yet. */
  draftCount: number
}) {
  const hasBuilt = builtCount > 0
  return (
    <EmptyState
      icon={<DeploymentUnitOutlined />}
      title="No graph has been published"
      detail={
        hasBuilt
          ? `${detail} ${builtCount} graph(s) are built and waiting: publishing one in Graph Studio is the last step.`
          : draftCount > 0
            ? `${detail} ${draftCount} use case(s) are still in the wizard — finish one with “Save & build graph”, then publish the build.`
            : `${detail} Nothing has been built yet: describe a business need in New Graph, build it, then publish it.`
      }
      action={
        <Link to={hasBuilt ? '/graph-studio' : '/new-graph'}>
          <Button type="primary" size="large">
            {hasBuilt ? 'Open Graph Studio' : 'Describe a business need'}
          </Button>
        </Link>
      }
      steps={STEPS}
      footnote="Publishing gates access, it never rewrites a build — a version is content-addressed and immutable."
    />
  )
}
