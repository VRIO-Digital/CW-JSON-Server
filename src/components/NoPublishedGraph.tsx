import { DeploymentUnitOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'
import { appPath } from '../api/dataset'

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
 * it so.
 *
 * **Every page gated on publication renders this one component** — Ask, Reports, the What-if
 * lens and Audit & Governance. Ask had its own copy of it for a while, which is how the same
 * precondition came to be called "No graph is live yet" on one page and "No graph has been
 * published" on three others, with different steps under each. One precondition, one screen,
 * one next action: **Open Graph Studio**, which is where the publish button actually is.
 *
 * The counts change the copy, not the look — "you have a graph, publish it" and "you have
 * nothing built yet" need different next actions, and a page that offered the same one
 * for both would send half its readers to the wrong screen.
 */
export default function NoPublishedGraph({
  detail,
  builtCount,
  draftCount,
  footnote,
}: {
  /** What specifically appears here once a graph is live. */
  detail: string
  /** Graphs committed on step 7 — publishable today. */
  builtCount: number
  /** Use cases still in the wizard, which have nothing to publish yet. */
  draftCount: number
  /**
   * The closing line, where a page has one worth keeping. Optional and *only* the footnote:
   * the title, the action and the steps are deliberately not overridable, because those are
   * what make four pages describe one precondition the same way.
   */
  footnote?: string
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
        <Link to={appPath(hasBuilt ? '/graph-studio' : '/new-graph')}>
          <Button type="primary" size="large">
            {hasBuilt ? 'Open Graph Studio' : 'Describe a business need'}
          </Button>
        </Link>
      }
      steps={STEPS}
      footnote={
        footnote ??
        'Publishing gates access, it never rewrites a build — a version is content-addressed and immutable.'
      }
    />
  )
}
