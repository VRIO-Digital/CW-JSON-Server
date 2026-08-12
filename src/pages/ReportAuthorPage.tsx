import { Alert, App, Button, Card, Input, Spin, Steps, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { ReportGraph, ReportOption } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ReportView from '../components/ReportView'
import { useAuthStore } from '../store/authStore'
import { useReportAuthorStore, useReportsStore } from '../store/reportsStore'
import { SP } from '../theme'
import './ReportsPage.css'

/*
 * Authoring a report — Graph, Ask, Confirm, Report.
 *
 * **The graph comes first**, because a report is a question asked *of a published graph*:
 * the wizard opens on the graphs that are live, with who published each and what it holds,
 * and the choice is carried in the frame from there on. Answering against "whatever is
 * newest" would attribute the figures to content nobody picked.
 *
 * **The three calls after it are the promise on the page.** "Nothing runs against your
 * compliance data until you're happy with it" — so Ask only *reads the question back*
 * (`POST /reports/read` returns a sentence and a frame, never figures), Confirm is where
 * the assumptions are settled, and Report is the first thing that touches a roster. A
 * wizard that answered on the first click would make Confirm decoration.
 *
 * **A standard report can be taken directly**, which is what most people want: picking one
 * reads, builds *and saves* it in one act and lands on the report. It still goes through
 * all three calls, so what gets saved is a frame the server validated.
 *
 * The report itself is `ReportView` — the same template the five written reports use, so a
 * composed report is visibly one of them rather than a second kind of document.
 */

const STEP_TITLES = ['Graph', 'Ask', 'Confirm', 'Report']

/** One picker: the tenant's question, its options, and the gloss on each. */
function Picker({
  question,
  options,
  value,
  onChange,
  note,
}: {
  question: string
  options: ReportOption[]
  value: string
  onChange: (value: string) => void
  note?: string
}) {
  return (
    <div className="rp-picker">
      <div className="rp-picker-q">{question}</div>
      <div className="rp-chips">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`rp-opt${o.value === value ? ' is-on' : ''}`}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            <span className="rp-opt-label">{o.label}</span>
            {/* The tenant's own gloss on the option — what it means, not what it is
                called. Without it "generators under enforcement" is a guess. */}
            <span className="rp-opt-detail">{o.detail}</span>
          </button>
        ))}
      </div>
      {note ? <p className="rp-picker-note">{note}</p> : null}
    </div>
  )
}

/** A published graph, as a choosable card: what it is, what it holds, who published it. */
function GraphCard({
  graph,
  chosen,
  onChoose,
}: {
  graph: ReportGraph
  chosen: boolean
  onChoose: () => void
}) {
  return (
    <button
      type="button"
      className={`rp-graph${chosen ? ' is-on' : ''}`}
      aria-pressed={chosen}
      onClick={onChoose}
    >
      <span className="rp-graph-head">
        <span className="rp-graph-name">{graph.name}</span>
        <Tag className="rp-chip">{graph.version ?? 'unversioned'}</Tag>
      </span>
      {/* The content that answers, and who put it live — the account that published it,
          recorded at publish time from the browser's own identity. */}
      <span className="rp-graph-meta">
        {graph.entityCount !== null ? `${graph.entityCount.toLocaleString()} entities` : ''}
        {graph.relationshipCount !== null
          ? ` · ${graph.relationshipCount.toLocaleString()} relationships`
          : ''}
      </span>
      {graph.sha256 ? <span className="rp-graph-sha">{graph.sha256}</span> : null}
      {graph.publishedBy ? (
        <span className="rp-graph-meta">published by {graph.publishedBy}</span>
      ) : null}
    </button>
  )
}

export default function ReportAuthorPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const index = useReportsStore((s) => s.data)
  const indexLoading = useReportsStore((s) => s.loading)
  const indexError = useReportsStore((s) => s.error)
  const loadIndex = useReportsStore((s) => s.load)
  /* Who is signed in. The identity is client-held, so a route that records who saved a
     report has to be told — the same reason the consent callback takes `as=`. */
  const identity = useAuthStore((s) => s.identity?.email ?? null)

  const step = useReportAuthorStore((s) => s.step)
  const setStep = useReportAuthorStore((s) => s.setStep)
  const graph = useReportAuthorStore((s) => s.graph)
  const chooseGraph = useReportAuthorStore((s) => s.chooseGraph)
  const readBack = useReportAuthorStore((s) => s.readBack)
  const frame = useReportAuthorStore((s) => s.frame)
  const setFrame = useReportAuthorStore((s) => s.setFrame)
  const built = useReportAuthorStore((s) => s.built)
  const editing = useReportAuthorStore((s) => s.editing)
  const needsName = useReportAuthorStore((s) => s.needsName)
  const reading = useReportAuthorStore((s) => s.reading)
  const readingBusy = useReportAuthorStore((s) => s.reading_busy)
  const building = useReportAuthorStore((s) => s.building)
  const saving = useReportAuthorStore((s) => s.saving)
  const build = useReportAuthorStore((s) => s.build)
  const generate = useReportAuthorStore((s) => s.generate)
  const save = useReportAuthorStore((s) => s.save)
  const reset = useReportAuthorStore((s) => s.reset)

  const [typed, setTyped] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    void loadIndex()
  }, [loadIndex])

  const savedId = params.get('saved')
  const askReportId = params.get('report')

  /*
   * Two ways in besides a blank start: editing a saved report re-opens its frame on the
   * graph it was asked of, and "ask this differently" from a written report starts on that
   * report. Both land on Confirm — the graph and the report are already decided.
   */
  useEffect(() => {
    if (!index) return
    if (savedId) {
      const saved = index.saved.find((s) => s.savedId === savedId)
      if (!saved) return
      setName(saved.name)
      setTyped(saved.question ?? saved.heading)
      void useReportAuthorStore.getState().reopen(saved)
      return
    }
    if (askReportId && !useReportAuthorStore.getState().readBack) {
      const start = index.reports.find((r) => r.reportId === askReportId)
      if (!start || index.graphs.length === 0) return
      setTyped(start.question)
      useReportAuthorStore.getState().chooseGraph(index.graphs[0])
      void useReportAuthorStore.getState().reading({ reportId: askReportId })
    }
  }, [askReportId, index, savedId])

  useEffect(() => () => reset(), [reset])

  const starters = index?.reports ?? []
  const authoring = index?.authoring ?? null
  const graphs = index?.graphs ?? []

  const facetsForSpine = useMemo(
    () =>
      /* Facets slice the generator register; the other three rosters declare none, so a
         filter row on them would be a control with nothing behind it. */
      readBack?.spine === 'generators' ? (authoring?.facets ?? []) : [],
    [authoring, readBack],
  )

  async function onRead(input: { question?: string; reportId?: string }) {
    const result = await reading(input)
    if (!result.ok) message.error(result.error)
  }

  /*
   * Taking a standard report as it stands: built against the chosen graph, then **named**.
   * The name field is pre-filled with the report's own heading and the graph version so
   * there is something to accept, but nothing is kept until the reader saves it — a row
   * named by the app is one nobody recognises a week later, and three of them read as
   * duplicates rather than as three questions.
   */
  async function onGenerate(reportId: string, heading: string) {
    setName(`${heading}${graph?.version ? ` · ${graph.version}` : ''}`)
    const result = await generate({ reportId })
    if (!result.ok) message.error(result.error)
  }

  async function onBuild() {
    const result = await build()
    if (!result.ok) message.error(result.error)
  }

  async function onSave() {
    if (!name.trim()) {
      message.error('Name this report so the library is readable.')
      return
    }
    const result = await save(name, identity)
    if (!result.ok) return message.error(result.error)
    message.success(editing ? 'Updated in your reports.' : 'Saved to your reports.')
    void loadIndex()
  }

  if (indexError) {
    return (
      <>
        <PageHeader title="Author a report" subtitle="" />
        <ApiErrorAlert error={indexError} onRetry={() => void loadIndex()} />
      </>
    )
  }
  if (indexLoading && !index) return <Spin />

  /* The same one gate the section has: a report is composed against a published graph,
     and there is no second precondition to clear first. */
  if (index && index.publishedCount === 0) {
    return (
      <>
        <PageHeader title="Author a report" subtitle="" />
        <NoPublishedGraph
          detail="A report is a question asked of the published graph."
          builtCount={index.builtCount}
          draftCount={index.draftCount}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={editing ? `Edit · ${editing.name}` : 'Author a report'}
        subtitle="Choose the published graph to ask, then ask for it the way you would ask a colleague. The question is read back as one plain sentence first — nothing runs against the connected data until that sentence is right."
        actions={
          <Link to="/reports">
            <Button>← All reports</Button>
          </Link>
        }
      />

      <Steps
        className="rp-steps"
        current={step - 1}
        items={STEP_TITLES.map((title) => ({ title }))}
        size="small"
        /* Backwards only, like the What-if rail: a later step's question depends on this
           one's answer, so jumping ahead would ask it against nothing. */
        onChange={(next) => (next + 1 < step ? setStep((next + 1) as 1 | 2 | 3 | 4) : undefined)}
      />

      {step === 1 ? (
        <Card className="rp-ask">
          <h3>Which published graph should answer this?</h3>
          <p className="rp-dim">
            {graphs.length === 1
              ? 'One graph is published. A report names the content that answered it, so the choice is recorded on the report itself.'
              : `${graphs.length} graphs are published. A report names the content that answered it, so pick the one this question is about.`}
          </p>
          <div className="rp-graphs">
            {graphs.map((g) => (
              <GraphCard
                key={g.useCaseId}
                graph={g}
                chosen={graph?.useCaseId === g.useCaseId}
                onChoose={() => chooseGraph(g)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="rp-ask">
          <div className="rp-asking-of">
            asking <b>{graph?.name}</b> {graph?.version}
            <Button size="small" type="link" onClick={() => setStep(1)}>
              change
            </Button>
          </div>
          <h3>What report do you need?</h3>
          <Input.TextArea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={starters[0] ? `e.g. ${starters[0].question}` : ''}
            autoSize={{ minRows: 3, maxRows: 6 }}
            aria-label="What report do you need?"
          />
          <div className="rp-ask-foot">
            <span className="rp-dim">
              Plain English is fine — no filters or waste codes to set up.
            </span>
            <Button
              type="primary"
              loading={readingBusy}
              onClick={() => void onRead({ question: typed })}
            >
              Read my question →
            </Button>
          </div>

          <div className="rp-divider" />

          <div className="rp-label">Or take one of the standard reports as it stands</div>
          <p className="rp-dim">
            Generated against this graph and saved to your reports, ready to open or edit.
          </p>
          <div className="rp-chips">
            {starters.map((s) => (
              <button
                key={s.reportId}
                type="button"
                className="rp-starter"
                disabled={readingBusy}
                onClick={() => void onGenerate(s.reportId, s.heading)}
              >
                {s.heading}
                <span className="rp-dim"> {s.reportTag}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {step === 3 && readBack && frame ? (
        <Card className="rp-confirm">
          <div className="rp-asking-of">
            asking <b>{graph?.name}</b> {graph?.version}
          </div>
          <h3>Check this reads right, then build it</h3>

          {/*
           * Whether the question was recognised, in the server's words. A miss is not an
           * error — it is read as the register and says so, which is the reader's cue to
           * change a picker below rather than to retype the sentence.
           */}
          <Alert
            type={readBack.matched ? 'success' : 'warning'}
            showIcon
            title={
              readBack.matched
                ? 'Read as a standard report'
                : 'Not recognised — read as the register'
            }
            description={readBack.why}
            style={{ marginBottom: SP.base }}
          />

          <blockquote className="rp-reading-quote">{readBack.reading}</blockquote>

          <Picker
            question={authoring?.opts.scope.question ?? ''}
            options={authoring?.opts.scope.options ?? []}
            value={frame.scope}
            onChange={(scope) => setFrame({ scope })}
          />
          <Picker
            question={authoring?.opts.measure.question ?? ''}
            options={authoring?.opts.measure.options ?? []}
            value={frame.measure}
            onChange={(measure) => setFrame({ measure })}
          />
          <Picker
            question={authoring?.opts.horizon.question ?? ''}
            options={authoring?.opts.horizon.options ?? []}
            value={frame.horizon}
            onChange={(horizon) => setFrame({ horizon })}
            /* The one assumption that does not filter, said where it is chosen rather than
               only in the report's footer. */
            note={readBack.caveats[0]}
          />

          {facetsForSpine.length > 0 ? (
            <div className="rp-picker">
              <div className="rp-picker-q">Narrow it further? (optional)</div>
              {facetsForSpine.map((facet) => (
                <div key={facet.key} className="rp-facet">
                  <span className="rp-label">{facet.label}</span>
                  <div className="rp-chips">
                    <button
                      type="button"
                      className={`rp-opt is-slim${frame.filters.every((f) => f.key !== facet.key) ? ' is-on' : ''}`}
                      onClick={() =>
                        setFrame({ filters: frame.filters.filter((f) => f.key !== facet.key) })
                      }
                    >
                      Any
                    </button>
                    {facet.values.map((v) => {
                      const on = frame.filters.some(
                        (f) => f.key === facet.key && f.value === v.value,
                      )
                      return (
                        <button
                          key={v.value}
                          type="button"
                          className={`rp-opt is-slim${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          onClick={() =>
                            setFrame({
                              filters: [
                                ...frame.filters.filter((f) => f.key !== facet.key),
                                ...(on ? [] : [{ key: facet.key, value: v.value }]),
                              ],
                            })
                          }
                        >
                          {v.label}
                          <span className="rp-dim"> {v.count}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="rp-foot-row">
            <Button onClick={() => setStep(2)}>← Adjust question</Button>
            <Button type="primary" loading={building} onClick={() => void onBuild()}>
              Build the report →
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 4 && built ? (
        <>
          {/*
           * Name it to keep it. The report is already built and readable — this asks for the
           * one thing the app must not decide, and says plainly that nothing is in the
           * section until it is answered.
           */}
          {needsName ? (
            <Card size="small" className="rp-name-card">
              <div className="rp-name-row">
                <div>
                  <div className="rp-picker-q">Name this report to keep it</div>
                  <span className="rp-dim">
                    It is built and readable now. Saving puts it in your reports, where it can
                    be opened and edited — and it stores the question and its frame, never
                    these figures.
                  </span>
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Decree-bound tonnage, this quarter"
                  onPressEnter={() => void onSave()}
                  aria-label="Name this report"
                />
                <Button type="primary" loading={saving} onClick={() => void onSave()}>
                  Save to my reports
                </Button>
              </div>
            </Card>
          ) : null}

          <ReportView
            report={built}
            /* The same chips the written reports carry. Here the frame is already local, so
               a slice is a `setFrame` plus a rebuild — the pickers and the chips write to one
               frame rather than two. */
            onSlice={(filter) => {
              setFrame({ filters: filter ? [filter] : [] })
              void onBuild()
            }}
            slicing={building}
            actions={
              <>
                <Button size="small" onClick={() => setStep(3)}>
                  ← Adjust
                </Button>
                {/* The prompt above owns the naming while a report is unkept, so the head
                    carries it only once there is a row to rename. */}
                {needsName ? null : (
                  <>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name this report"
                      size="small"
                      style={{ maxWidth: 200 }}
                      aria-label="Name this report"
                    />
                    <Button
                      size="small"
                      type="primary"
                      loading={saving}
                      onClick={() => void onSave()}
                    >
                      {editing ? 'Update' : 'Save to my reports'}
                    </Button>
                  </>
                )}
              </>
            }
            provenance={
              editing ? (
                <p className="rp-dim">
                  Saved as <b>{editing.name}</b>
                  {editing.savedBy ? ` by ${editing.savedBy}` : ''} — saving again updates
                  that row rather than adding a second one.
                </p>
              ) : null
            }
          />

          <div className="rp-foot-row">
            <Button
              onClick={() => {
                reset()
                setTyped('')
                setName('')
              }}
            >
              Ask something else
            </Button>
            <Button onClick={() => navigate('/reports')}>Back to all reports</Button>
          </div>
        </>
      ) : null}
    </>
  )
}
