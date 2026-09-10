import { CheckOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Input, Modal, Spin, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GraphSource, SourcePick } from '../../api/client'
import {
  mailDocumentMeta,
  mailUsedForCopy,
  readUsedFor,
  usedForKey,
  usedForProblem,
  writeUsedFor,
} from '../../data/mailUsedFor'
import { currentDataset } from '../../api/dataset'
import NoSourceConnected from '../common/NoSourceConnected'
import StatusTag from '../common/StatusTag'
import ConnectorIcon from '../common/ConnectorIcon'
import { SP } from '../../theme'
import '../../pages/NewGraphPage.css'

import { appPath } from '../../api/dataset'

/*
 * Step 4 of New Graph: which connected sources feed the graph, and how much of
 * each.
 *
 * The list is the Data Catalog's *profiled* state, not the registration — a
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
  /* Which mailbox's description is open for editing, and what has been typed into it. One at a
     time: two open dialogs would be two unsaved answers to one question. */
  const [editing, setEditing] = useState<GraphSource | null>(null)
  const [draft, setDraft] = useState('')
  const [storeError, setStoreError] = useState<string | null>(null)

  /*
   * **What each mailbox is used for — derived from storage, never copied into state.**
   *
   * This was a `useState` with a lazy initialiser, and that was a real bug: the initialiser runs
   * **once**, on the first render, when `sources` is still `[]` because the list is loading. It
   * never ran again, so within a session a save looked fine — the write set the state — and after a
   * reload the stored value never appeared at all. The card said *"Not described yet"* over a
   * description that was sitting in `localStorage` the whole time. Reported from use.
   *
   * A memo keyed on the sources **and** on the last write recomputes when the list arrives and
   * again when something is saved, which are the only two moments the answer can change. Storage
   * stays the single home; nothing here is a second copy of it that can go stale.
   */
  const [savedAt, setSavedAt] = useState(0)
  const usedFor = useMemo(
    () =>
      Object.fromEntries(
        sources
          .filter((s) => s.runtime)
          .map((s) => [s.sourceId, readUsedFor(usedForKey(currentDataset(), s.sourceId))]),
      ),
    /* `savedAt` is the write, and it is what makes a save visible without a second copy. */
    [sources, savedAt],
  )

  /*
   * **Saving is local, so there is nothing to await and nothing to fail over the network.** It was
   * a `PATCH` onto the registered source; in the environment this runs in the request never reached
   * the server — four attempts, none transferring a byte, while the same call succeeded from `curl`
   * — so on request the browser is where it is kept.
   *
   * The one failure left is storage itself refusing, which a private window really does, and that
   * is reported rather than swallowed: there is no server copy to fall back on, so a silent success
   * would be the one lie this dialog could tell.
   */
  function saveUsedFor() {
    if (!editing || usedForProblem(draft)) return
    const trimmed = draft.trim()
    if (!writeUsedFor(usedForKey(currentDataset(), editing.sourceId), trimmed)) {
      setStoreError(mailUsedForCopy.storeFailed)
      return
    }
    /* Re-read rather than remember: the card shows what storage now holds, so a write that landed
       differently from what was typed — trimmed, or cleared by an empty value — cannot leave the
       screen disagreeing with the store. */
    setSavedAt((n) => n + 1)
    setStoreError(null)
    setEditing(null)
  }
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

  /**
   * Record which objects a source contributes.
   *
   * **Everything ticked is stored as `all`, not as a subset that happens to hold everything.** The
   * two look identical on screen and are different promises: `all` is "this source", and picks up
   * an object profiled after the draft was saved; a subset freezes today's list. A reader who ticks
   * every box means the first, and storing the second would quietly drop tomorrow's documents.
   *
   * That is the same distinction the mode buttons make explicit for the other two connectors —
   * Gmail has no mode buttons, so the ticks have to carry it.
   */
  function setObjects(source: GraphSource, objects: string[]) {
    const whole = objects.length === source.objectCount && source.objectCount > 0
    onPicks(
      picks.map((p) =>
        p.sourceId === source.sourceId
          ? { ...p, mode: whole ? 'all' : 'subset', objects }
          : p,
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
        detail="A graph draws on data this tenant has connected. Connect a BigQuery project or a Google Drive and profile it in the Data Catalog — its tables and documents become selectable here. A Gmail mailbox is selectable as soon as it is connected: it is read at question time rather than profiled."
      />
    )
  }

  /*
   * **Nothing this step can use** — which is not the same as nothing profiled.
   *
   * A runtime source is never profiled and never will be, so counting it as unprofiled put
   * an error above a list whose one usable row sat right underneath it, telling the reader
   * to go and profile a mailbox. The test is "has this source anything to contribute",
   * which for a profiled source is its objects and for a runtime source is its scope.
   */
  const usable = (s: GraphSource) => s.objectCount > 0
  const nothingUsable = !sources.some(usable)
  /* Named apart, because the *advice* differs: profiling is the fix for one and there is no
     fix for the other, it is simply not how that connector contributes. */
  const profilableSources = sources.filter((s) => !s.runtime)

  return (
    <>
      {nothingUsable ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: SP.base }}
          title="No profiled data yet — you cannot select a source"
          description={
            <div>
              <div style={{ marginBottom: SP.sm }}>
                {profilableSources.length} source(s) are connected, but the Metadata
                Profiler has not run on any of them. Profiling is what produces the
                columns and entities a graph reasons over, so there is nothing to point
                this use case at yet.
              </div>
              <Link to={appPath('/catalog')}>
                <Button type="primary" size="small">
                  Open the Data Catalog to profile a source
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
        /*
         * Which objects this row shows as ticked. `all` carries no object list — it means "this
         * source, whatever it holds" — so it renders as every box ticked rather than none, which
         * is what it means and what the reader chose.
         */
        const picked =
          pick?.mode === 'subset' ? pick.objects : source.objects.map((o) => o.objectId)

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
                  {/*
                    * A runtime source is never profiled, so "nothing profiled" would be
                    * describing a state it can never leave. It reports what it is instead —
                    * and only reaches the warn branch when its own scope is genuinely empty.
                    */}
                  {empty
                    ? source.runtime
                      ? `no ${source.unitLabel} in scope`
                      : 'nothing profiled'
                    : source.runtime
                      ? 'read at question time'
                      : source.status}
                </StatusTag>
              </span>
            </div>

            <div className="ng-source-scope">
              {source.scopeLabel}: {source.scope.join(', ') || '—'}
            </div>

            {empty ? (
              <div className="ng-source-warn">
                {/*
                  * "Profile it in the Data Catalog" is only advice somebody can act on when
                  * the source *can* be profiled. Gmail has no profiler, so that sentence
                  * over a mailbox is an instruction with no way to carry it out — the same
                  * fault this wizard already fixed once on Gmail's own Continue button.
                  */}
                {source.runtime
                  ? `Connected, but no ${source.unitLabel} are in scope — reconnect it and pick at least one.`
                  : 'Connected, but the profiler has not run here yet — profile it in the Data Catalog and it becomes selectable.'}
              </div>
            ) : source.runtime ? (
              /*
               * **A mailbox picks documents, and says what it is for.**
               *
               * Asked for directly, replacing the label picker. Every processed document is listed
               * with the counts the catalogue holds, and each is ticked or not — which is what a
               * reader means by choosing what a use case draws on, where a *label* was only ever
               * what the consent happened to reach.
               *
               * **All-ticked is stored as `all`, not as a subset of everything.** The two look the
               * same on screen and are different promises: `all` includes a document processed
               * later, a subset freezes today's list. Ticking every box is a reader saying "this
               * mailbox", so it is recorded as that.
               *
               * Nothing here changes where any of it may travel: `runtime` is still true and step
               * 6 still derives nothing from this source — the note under the list says so.
               */
              <>
                <div className="ng-source-usedfor">
                  <span className="ng-source-usedfor-label">
                    {mailUsedForCopy.fieldLabel}
                  </span>
                  <span
                    className={`ng-source-usedfor-value${
                      usedFor[source.sourceId] ? '' : ' is-empty'
                    }`}
                  >
                    {usedFor[source.sourceId] ?? mailUsedForCopy.empty}
                  </span>
                  <Button
                    size="small"
                    disabled={!selected}
                    onClick={() => {
                      setEditing(source)
                      setDraft(usedFor[source.sourceId] ?? '')
                      setStoreError(null)
                    }}
                  >
                    {mailUsedForCopy.editLabel}
                  </Button>
                </div>

                <div className="ng-source-tables">
                  <Checkbox
                    checked={picked.length === source.objectCount}
                    indeterminate={picked.length > 0 && picked.length < source.objectCount}
                    disabled={!selected}
                    onChange={(e) =>
                      setObjects(
                        source,
                        e.target.checked ? source.objects.map((o) => o.objectId) : [],
                      )
                    }
                  >
                    Select all ({source.objectCount})
                  </Checkbox>

                  {source.objects.map((o) => (
                    <Checkbox
                      key={o.objectId}
                      className="ng-source-table ng-source-doc"
                      checked={picked.includes(o.objectId)}
                      disabled={!selected}
                      onChange={(e) =>
                        setObjects(
                          source,
                          e.target.checked
                            ? [...picked, o.objectId]
                            : picked.filter((x) => x !== o.objectId),
                        )
                      }
                    >
                      <span className="ng-source-doc-name">{o.label}</span>{' '}
                      {/* Dropped part by part where the catalogue states nothing, never
                          printed as 0 — see `mailDocumentMeta`. */}
                      <span className="ng-source-units">{mailDocumentMeta(o)}</span>
                      {o.snippet ? (
                        <span className="ng-source-doc-snippet">{o.snippet}</span>
                      ) : null}
                    </Checkbox>
                  ))}

                  {selected && picked.length === 0 ? (
                    <div className="ng-source-warn">
                      Pick at least one document — an empty selection can't derive.
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="ng-source-modes">
                  <button
                    type="button"
                    className={`ng-mode${pick?.mode !== 'subset' ? ' is-on' : ''}`}
                    disabled={!selected}
                    onClick={() => setMode(source, 'all')}
                  >
                    All {source.runtime ? '' : 'profiled '}
                    {source.unitLabel} ({source.objectCount})
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
                        {/*
                          * `units` is null where nothing has counted the object — a Gmail
                          * label has no message count, because this connector samples no
                          * mail. Printing "· 0 messages" would say the label is empty, which
                          * is a claim; printing nothing says only that it was not counted.
                          */}
                        {o.units === null ? null : (
                          <span className="ng-source-units">
                            · {o.units} {o.unitLabel}
                          </span>
                        )}
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
          Profiling is what produces the columns and entities the graph reasons over, so
          an unprofiled source has nothing to contribute yet — <Tag>Data Catalog</Tag> is
          where that runs. A <Tag>Gmail</Tag> mailbox is different: it is read when a
          question needs it, so it derives no entities and needs no profiling.
        </span>
      </div>

      {/*
        **One dialog for the step, not one per source row.** A `Modal` per mailbox would be several
        ways to be looking at one thing — the rule the Catalog's dictionary report already keeps —
        and `editing` is the single piece of state saying whose description is open.

        Its copy lives in `src/data/mailUsedFor.ts` because a `Modal` renders through a portal
        `renderToString` will not traverse, so a prompt written here could not be asserted at all.
      */}
      <Modal
        open={editing != null}
        title={editing ? mailUsedForCopy.title(editing.account) : undefined}
        okText={mailUsedForCopy.saveLabel}
        cancelText={mailUsedForCopy.cancelLabel}
        okButtonProps={{ disabled: usedForProblem(draft) != null }}
        onOk={saveUsedFor}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <p className="ng-usedfor-prompt">{mailUsedForCopy.prompt}</p>
        <Input.TextArea
          autoFocus
          value={draft}
          placeholder={mailUsedForCopy.placeholder}
          autoSize={{ minRows: 4, maxRows: 10 }}
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* The counter is the **server's** cap restated, so a reader is told at the moment they
            cross it rather than by a refusal after Save. */}
        <div className="ng-usedfor-count">
          {usedForProblem(draft) ?? mailUsedForCopy.counter(draft)}
        </div>
        {/* Where it goes, said under the box: a value kept in one browser makes a different
            promise from one stored against the connection, and the reader is owed the difference
            before they write it rather than after. */}
        <div className="ng-usedfor-scope">{mailUsedForCopy.scopeNote}</div>
        {/* Only when storage really refused — there is no server copy to fall back to, so a
            silent success would be the one lie this dialog could tell. */}
        {storeError ? <div className="ng-usedfor-error">{storeError}</div> : null}
      </Modal>
    </>
  )
}
