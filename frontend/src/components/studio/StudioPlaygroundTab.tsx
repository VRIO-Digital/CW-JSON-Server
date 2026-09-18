import { Spin, Tabs, Typography } from 'antd'
import { useState } from 'react'
import type { GoldenQuery, Playground, PlaygroundFile, PlaygroundMetric } from '../../api/client'
import { playgroundCopy } from '../../data/playground'
import { SP } from '../../theme'
import PlaygroundGoldenQueries from './PlaygroundGoldenQueries'
import PlaygroundMetrics from './PlaygroundMetrics'
import './Playground.css'

/**
 * Graph Studio's Playground — **what the use case asked for, in the two forms a graph answers in.**
 *
 * Two nested tabs, because they are two questions: *what are we measuring* and *what are we asking*.
 * Both read the brief rather than a table of their own — the metrics are the ones accepted on step 4
 * of New Graph and the golden queries are the hero questions accepted on step 5 — so this screen
 * cannot come to list something the wizard does not. What the Playground adds is the query each one
 * is answered by, and the ability to add, correct and remove them here.
 *
 * **It sits after Bridge and before Canvas**, which is the order the work is done in: build the two
 * graphs, settle what corresponds between them, then say what you will ask of the result.
 */
export default function StudioPlaygroundTab({
  playground,
  loading,
  busy,
  signedInAs,
  onSaveMetrics,
  onSaveQueries,
  onSaveFiles,
  onError,
}: {
  playground: Playground | null
  loading: boolean
  busy: boolean
  signedInAs: string | null
  onSaveMetrics: (next: PlaygroundMetric[]) => void
  onSaveQueries: (next: GoldenQuery[]) => void
  onSaveFiles: (next: PlaygroundFile[]) => void
  onError: (message: string) => void
}) {
  const [tab, setTab] = useState('metrics')

  /* `null` is "not read yet" rather than "empty", and the two must not draw the same: an empty-state
     alert over a use case whose metrics simply have not arrived reads as a brief that accepted
     none. */
  if (playground === null) {
    return (
      <div style={{ padding: SP.xl, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {playgroundCopy.intro}
      </Typography.Paragraph>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'metrics',
            label: 'Metrics',
            children: (
              <PlaygroundMetrics
                metrics={playground.metrics}
                cap={playground.metricCap}
                busy={busy || loading}
                onSave={onSaveMetrics}
              />
            ),
          },
          {
            key: 'golden-queries',
            label: 'Golden Queries',
            children: (
              <PlaygroundGoldenQueries
                queries={playground.goldenQueries}
                files={playground.files}
                queryCap={playground.queryCap}
                fileCap={playground.fileCap}
                busy={busy || loading}
                signedInAs={signedInAs}
                onSaveQueries={onSaveQueries}
                onSaveFiles={onSaveFiles}
                onError={onError}
              />
            ),
          },
        ]}
      />
    </>
  )
}
