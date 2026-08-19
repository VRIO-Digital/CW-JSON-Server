import { CheckOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Spin, Tag } from 'antd'
import { Link } from 'react-router-dom'
import type { GraphSource, SourcePick } from '../api/client'
import NoSourceConnected from './NoSourceConnected'
import StatusTag from './StatusTag'
import ConnectorIcon from './ConnectorIcon'
import { SP } from '../theme'
import '../pages/NewGraphPage.css'
import { appPath } from '../api/dataset'

/*
 * Step 4 of New Graph: which connected sources feed the graph, and how much of
 * each.
 *
 * The list is the Data Catalogue's *profiled* state, not the registration — a
 * connected source with nothing profiled is shown and disabled, because "you
 * have not profiled it yet" is a different problem from "you have not connected
 * it", and only the user can tell them apart.
 */
export default function SourcesStep({
  sources,
  loading,
  picks,
  onPicks,
}: {
  sources: GraphSource[]
  loading: boolean
  picks: SourcePick[]
  onPicks: (picks: SourcePick[]) => void
}) {
  const pickFor = (sourceId: string) => picks.find((p) => p.sourceId === sourceId)

  function toggleSource(source: GraphSource) {
    const existing = pickFor(source.sourceId)
    if (existing) {
      onPicks(picks.filter((p) => p.sourceId !== source.sourceId))
      return
    }
    // Selecting a source takes all of it; narrowing is the deliberate act.
    onPicks([...picks, { sourceId: source.sourceId, mode: 'all', objects: [] }])
  }

  function setMode(source: GraphSource, mode: 'all' | 'subset') {
    onPicks(
      picks.map((p) =>
        p.sourceId === source.sourceId ? { ...p, mode, objects: [] } : p,
      ),
    )
  }

  function setObjects(source: GraphSource, objects: string[]) {
    onPicks(
      picks.map((p) =>
        p.sourceId === source.sourceId ? { ...p, mode: 'subset', objects } : p,
      ),
    )
  }

  if (loading && sources.length === 0) return <Spin />

  /*
   * Two different dead ends, and they need different exits: nothing connected at
   * all, versus connected but never profiled. Telling someone to "connect a
   * source" when they already have three would be useless advice.
   */
  if (sources.length === 0) {
    return (
      // `bare` — the wizard step is already a bordered card, and a dashed frame
      // inside it reads as a rendering fault rather than as an empty slot.
      <NoSourceConnected
        bare
        detail="A graph can only draw on data that has been profiled. Connect a BigQuery project or a Google Drive, then profile it in the Data Catalogue — its tables and documents become selectable here."
      />
    )
  }

  const nothingProfiled = !sources.some((s) => s.objectCount > 0)

  return (
    <>
      {nothingProfiled ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: SP.base }}
          title="No profiled data yet — you cannot select a source"
          description={
            <div>
              <div style={{ marginBottom: SP.sm }}>
                {sources.length} source(s) are connected, but the Metadata Profiler
                has not run on any of them. Profiling is what produces the columns
                and entities a graph reasons over, so there is nothing to point this
                use case at yet.
              </div>
              <Link to={appPath('/catalogue')}>
                <Button type="primary" size="small">
                  Open the Data Catalogue to profile a source
                </Button>
              </Link>
            </div>
          }
        />
      ) : null}

      <div className="ng-ai">
        <span className="ng-ai-mark" aria-hidden="true">
          ✦
        </span>
        <div>
          <strong>Available sources — connected in ContextWeave.</strong>
          <div className="ng-ai-sub">
            The graph draws from these profiled sources. Select a source, then keep
            all of its profiled tables or narrow to the ones this use case needs.
          </div>
        </div>
      </div>

      {sources.map((source) => {
        const pick = pickFor(source.sourceId)
        const selected = Boolean(pick)
        const empty = source.objectCount === 0

        return (
          <div
            key={source.sourceId}
            className={`ng-source${selected ? ' is-selected' : ''}${empty ? ' is-empty' : ''}`}
          >
            <div className="ng-source-head">
              <button
                type="button"
                className={`ng-check${selected ? ' is-on' : ''}`}
                aria-label={`${selected ? 'Remove' : 'Use'} ${source.sourceName}`}
                aria-pressed={selected}
                disabled={empty}
                onClick={() => toggleSource(source)}
              >
                {selected ? <CheckOutlined /> : null}
              </button>

              <span className="ng-source-type">
                <ConnectorIcon connector={source.connector} size={13} />
                {source.typeLabel}
              </span>
              <span className="ng-source-name">{source.sourceName}</span>

              <span className="ng-source-status">
                <StatusTag tone={empty ? 'warn' : 'good'}>
                  {empty ? 'nothing profiled' : source.status}
                </StatusTag>
              </span>
            </div>

            <div className="ng-source-scope">
              {source.scopeLabel}: {source.scope.join(', ') || '—'}
            </div>

            {empty ? (
              <div className="ng-source-warn">
                Connected, but the profiler has not run here yet — profile it in the
                Data Catalogue and it becomes selectable.
              </div>
            ) : (
              <>
                <div className="ng-source-modes">
                  <button
                    type="button"
                    className={`ng-mode${pick?.mode !== 'subset' ? ' is-on' : ''}`}
                    disabled={!selected}
                    onClick={() => setMode(source, 'all')}
                  >
                    All profiled {source.unitLabel} ({source.objectCount})
                  </button>
                  <button
                    type="button"
                    className={`ng-mode${pick?.mode === 'subset' ? ' is-on' : ''}`}
                    disabled={!selected}
                    onClick={() => setMode(source, 'subset')}
                  >
                    Choose {source.unitLabel}…
                  </button>
                </div>

                {selected && pick?.mode === 'subset' ? (
                  <div className="ng-source-tables">
                    <Checkbox
                      checked={pick.objects.length === source.objectCount}
                      indeterminate={
                        pick.objects.length > 0 &&
                        pick.objects.length < source.objectCount
                      }
                      onChange={(e) =>
                        setObjects(
                          source,
                          e.target.checked
                            ? source.objects.map((o) => o.objectId)
                            : [],
                        )
                      }
                    >
                      Select all ({source.objectCount})
                    </Checkbox>

                    {source.objects.map((o) => (
                      <Checkbox
                        key={o.objectId}
                        className="ng-source-table"
                        checked={pick.objects.includes(o.objectId)}
                        onChange={(e) =>
                          setObjects(
                            source,
                            e.target.checked
                              ? [...pick.objects, o.objectId]
                              : pick.objects.filter((x) => x !== o.objectId),
                          )
                        }
                      >
                        {o.label}{' '}
                        <span className="ng-source-units">
                          · {o.units} {o.unitLabel}
                        </span>
                      </Checkbox>
                    ))}

                    {pick.objects.length === 0 ? (
                      <div className="ng-source-warn">
                        Pick at least one {source.unitLabel.replace(/s$/, '')} — an
                        empty selection can’t derive.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )
      })}

      <div className="ng-hint">
        <span aria-hidden="true">✦</span>
        <span>
          Only profiled objects are listed. Profiling is what produces the columns
          and entities the graph reasons over, so an unprofiled source has nothing
          to contribute yet — <Tag>Data Catalogue</Tag> is where that runs.
        </span>
      </div>
    </>
  )
}
