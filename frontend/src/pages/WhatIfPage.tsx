import { Alert, App, Button, Col, Input, Row, Space, Spin, Tabs, Tag } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WhatIfFrame, WhatIfSaved } from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'
import PublishedConfirmDialog from '../components/whatif/PublishedConfirm'
import PublishScenarioDialog from '../components/whatif/PublishScenarioDialog'
import PublishedScenarios, {
  PublishedScenarioModal,
} from '../components/whatif/PublishedScenarios'
import ScenarioColumn from '../components/whatif/ScenarioColumn'
import { PoolFrame } from '../components/whatif/WhatIfGraph'
import { useAuthStore } from '../store/authStore'
import {
  headroomFor,
  poolMembers,
  selectColumns,
  selectCurrent,
  selectSaved,
  useWhatIfStore,
} from '../store/whatifStore'
import { SP } from '../theme'
import './WhatIfPage.css'

/*
 * The What-if lens.
 *
 * A **read-only overlay** on the knowledge graph: it admits a candidate load
 * hypothetically and reports what the facility would inherit by traversing to the
 * generator's federal record. Nothing on this page writes to the graph, and the copy
 * says so in three places because it is the property that makes the screen safe to
 * use before a decision rather than after one.
 *
 * Three tabs, and they are three different jobs. **Authoring sets the frame** — which
 * governed measures are watched, which pool of generators a scenario may draw from, how
 * many columns to compare — and it is a three-step wizard because each answer narrows
 * the next. **Runtime swaps loads inside that frame** and every figure recomputes on
 * the server, so a saved scenario stays true as the graph changes: the library stores
 * the admitted load, never the numbers. **Published scenarios reads a publication
 * back** — who was told, which build they see, when it was created as against when it
 * was told — and changes nothing, which is why it is not part of Runtime.
 *
 * The tab list itself is the tenant's, served on `copy.tabs`. A tab hardcoded here
 * would be a second answer to what tabs exist; the third one is appended by
 * `npm run ingest:whatif`, the way that script already overrides the subtitle.
 *
 * Every string on this page comes from the server. The tenant wrote this copy, and a
 * sentence typed into a component here would be a second voice claiming to be theirs.
 */
/**
 * Splits the tenant's leading claim off a paragraph, for an Alert's title.
 *
 * The package writes these notes as one string that opens with the point — "This is a
 * read-only overlay. Running a scenario…" — so the emphasis is *in* the copy and does
 * not need inventing. Both Alerts on this page originally restated that first sentence
 * as a hardcoded title, which printed it twice and put words in the tenant's mouth.
 */
/**
 * How long a step of Authoring is held before it advances.
 *
 * **Client-side, and only here.** Everywhere in this app that a step waits, it waits
 * for a request — a stage advances when its call returns, never on a timer the page
 * holds. Steps 1→2 and 2→3 of Authoring are the exception, for the same reason the
 * report prototype's two steps are: they make no request at all. Picking measures and
 * narrowing a pool are decisions recorded in the store, so there is nothing whose
 * return could advance them, and the alternative to a hold here is a step that
 * completes before the reader has seen it start.
 *
 * It matches `WHATIF_STEP_MS` in the server, which paces the steps that *do* call:
 * Resolve against graph, Save frame & run, and every load swap in Runtime. The two
 * numbers are the same pace for the same flow; if one changes the other should.
 */
const STEP_HOLD_MS = 4000

/**
 * Runs an act after the step hold, with a flag for the button's spinner.
 *
 * The timer is cleared on unmount, so leaving Authoring mid-step cannot fire the
 * advance into a component that is no longer there — the mistake the report
 * prototype's runner already had to fix once.
 */
function useHeldStep(): { holding: boolean; hold: (act: () => void) => void } {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return {
    holding,
    hold: (act) => {
      if (timer.current) return
      setHolding(true)
      timer.current = setTimeout(() => {
        timer.current = null
        setHolding(false)
        act()
      }, STEP_HOLD_MS)
    },
  }
}

function lead(text: string): { title: string; rest: string } {
  const at = text.indexOf('. ')
  if (at === -1) return { title: text, rest: '' }
  return { title: text.slice(0, at + 1), rest: text.slice(at + 2) }
}

export default function WhatIfPage() {
  const { message } = App.useApp()
  const frame = useWhatIfStore((s) => s.frame)
  const loading = useWhatIfStore((s) => s.loading)
  const error = useWhatIfStore((s) => s.error)
  const load = useWhatIfStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !frame) return <Spin />
  if (error && !frame) return <ApiErrorAlert error={error} onRetry={() => void load()} />
  if (!frame) return null

  const { copy } = frame

  return (
    <>
      <PageHeader title={copy.pageTitle} subtitle={copy.subtitle} />

      {error ? (
        <div className="wi-error">
          <ApiErrorAlert error={error} onRetry={() => void load()} />
        </div>
      ) : null}

      {/*
       * ---------------- a dataset whose lens is a rendered document ----------------
       *
       * **Some datasets ship the lens instead of computing it, and then the document is the page.**
       * The lens below admits a candidate load into the published graph and traverses to that
       * generator's federal record, so every figure on it is computed per request from a pool of
       * candidates. CAPEX has no such pool — its own document says so, which is why its `generators`
       * and `candidate_pools` are empty — and ships a finished page whose model is a cost
       * decomposition moved by sliders. Rendering the traversal lens over that data would draw a
       * frame with nothing in it and a pool reading "nobody qualifies", which is an answer, and the
       * wrong one.
       *
       * **Checked *after* the gate, because publication is the one precondition.** A rendered lens
       * briefly sat outside it — it asked nothing of a graph, so there was nothing for the gate to be
       * about. Reversed on request: the graph is released first and the surfaces that read the
       * tenant's data open after it. So the gate is tested first for every dataset, and the document
       * is what fills the page once something is published. The server agrees rather than being
       * second-guessed here: it sends `document: null` while the gate is closed.
       *
       * **`seamless`, because the frame is the whole page.** There is no Back — the Library frames a
       * report instead of its list, and this frames the only thing here — no Export button and no bar
       * restating a title the document prints itself, and no border or grey ground making the document
       * read as a panel dropped onto the app. What that costs is the print button, which is stated in
       * the viewer rather than glossed.
       */}
      {frame.publishedCount === 0 ? (
        /* The one precondition. The copy calls this a read-only overlay *on the
           knowledge graph*: with nothing published there is no graph to overlay, and
           figures shown anyway would be attributed to content nobody has published. */
        <NoPublishedGraph
          detail="The lens overlays the published graph — it traverses it to reach each generator's federal record."
          builtCount={frame.builtCount}
          draftCount={frame.draftCount}
        />
      ) : frame.document ? (
        <DocumentViewer document={frame.document} seamless />
      ) : (
        <WhatIfLens frame={frame} onMessage={message.error} />
      )}
    </>
  )
}

/** The lens itself: its guarantee, what it is built on, the two tabs, its provenance. */
function WhatIfLens({
  frame,
  onMessage,
}: {
  frame: WhatIfFrame
  onMessage: (text: string) => void
}) {
  const { copy } = frame

  return (
    <>
      {/* The overlay guarantee, stated where it cannot be missed. */}
      <div className="wi-pill">{copy.overlayPill}</div>

      <Alert
        className="wi-banner"
        type="info"
        showIcon
        title="What this lens is built on"
        description={copy.banner}
      />

      <WhatIfTabs frame={frame} onMessage={onMessage} />

      <div className="wi-note">{copy.dataNote}</div>
    </>
  )
}

function WhatIfTabs({
  frame,
  onMessage,
}: {
  frame: WhatIfFrame
  onMessage: (text: string) => void
}) {
  const [tab, setTab] = useState(frame.defaults.tab)
  const startRun = useWhatIfStore((s) => s.startRun)
  const saved = useWhatIfStore(selectSaved)
  const pending = useWhatIfStore((s) => s.pending)
  const publish = useWhatIfStore((s) => s.publish)
  const unpublish = useWhatIfStore((s) => s.unpublish)
  /* Client-held, so it has to be *sent*: the server has nothing to look the signed-in
     user up from, which is why every "who did this" field in this app is told. */
  const signedInAs = useAuthStore((s) => s.identity?.email ?? null)

  /**
   * Which library entry the publish dialog is open on, or null.
   *
   * **One dialog, above the tabs, because publishing is one act.** Runtime's bar and
   * the Published tab's cards both reach it; a dialog per tab would be two places to
   * change one publication, which is how they come to disagree about what it says.
   */
  const [publishing, setPublishing] = useState<string | null>(null)
  const target = publishing === null ? null : (saved.find((s) => s.savedId === publishing) ?? null)

  /**
   * Which scenario the publish confirmation is open on, or null.
   *
   * **Opened by a publish that succeeded, and only a first one.** The receipt reports
   * what the publication recorded — the readers, the bound graph, the freshness — and
   * its title is "Scenario published", so showing it after *Update publication* would
   * announce an act that had already happened. An update closes the editor with nothing
   * further to say, which is what it always did.
   *
   * It reads the entry back out of the store rather than the reply it was given: the
   * publish response is what refreshed the library, so the record on screen is the one
   * that was stored rather than a copy of the input that produced it.
   */
  const [confirming, setConfirming] = useState<string | null>(null)
  const confirmed =
    confirming === null ? null : (saved.find((s) => s.savedId === confirming) ?? null)

  const openSaved = useWhatIfStore((s) => s.openSaved)

  /**
   * Load a published scenario back into Runtime **and go there**.
   *
   * The tab switch is the point. `openSaved` recomputes the columns into the store
   * but changes nothing on screen while the reader is still on the Published tab —
   * so "Open in Runtime" appeared to do nothing at all. The act is owned here
   * because this is where the active tab lives; the Published tab cannot switch to
   * a tab it does not know about.
   */
  async function openInRuntime(savedId: string) {
    const result = await openSaved(savedId)
    if (!result.ok) {
      onMessage(result.error)
      return
    }
    setTab('runtime')
  }

  return (
    <>
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={frame.copy.tabs.map((t) => ({
        key: t.key,
        label: t.label,
        children:
          t.key === 'author' ? (
            <Authoring
              frame={frame}
              onRun={() => {
                /* Entering Runtime is what opens the columns and computes them — the
                   frame is not a scenario, and nothing is computed until it is run. */
                void startRun()
                setTab('runtime')
              }}
              onMessage={onMessage}
            />
          ) : t.key === 'published' ? (
            <Published
              frame={frame}
              onManage={setPublishing}
              onOpenInRuntime={openInRuntime}
            />
          ) : (
            <Runtime frame={frame} onMessage={onMessage} onPublish={setPublishing} />
          ),
      }))}
    />

    {/*
     * At the page's level rather than inside a card, and that is not tidiness: a panel
     * that expands inside an equal-height card grid stretches every sibling in its row,
     * which is the trap `docs/REGRESSIONS.md` records twice for the report section.
     */}
    <PublishScenarioDialog
      open={target !== null}
      scenario={target}
      frame={frame}
      saving={pending === target?.savedId}
      onCancel={() => setPublishing(null)}
      onPublish={(input) => {
        const savedId = target!.savedId
        /* Read before the write: after it lands the entry carries a publication either
           way, and the receipt is for the publish rather than for every edit of one. */
        const first = target!.published === null
        void publish({ savedId, ...input, as: signedInAs }).then((r) => {
          if (!r.ok) onMessage(r.error)
          else {
            setPublishing(null)
            if (first) setConfirming(savedId)
          }
        })
      }}
      onUnpublish={() =>
        void unpublish(target!.savedId).then((r) => {
          if (!r.ok) onMessage(r.error)
          else {
            onMessage(frame.publishing.unpublishedNote)
            setPublishing(null)
          }
        })
      }
    />

    {/*
     * The receipt, beside the editor rather than inside it: the dialog it confirms is
     * closed by the time this opens, and a panel that swapped its own body would leave
     * the reader unsure whether the publish had happened or was still being edited.
     */}
    <PublishedConfirmDialog
      open={confirmed !== null}
      scenario={confirmed}
      frame={frame}
      onClose={() => setConfirming(null)}
      onAgain={() => {
        /* Authoring is where a scenario starts — the frame is picked before anything is
           admitted — so "start a new one" goes there rather than to a blank Runtime. */
        setConfirming(null)
        setTab('author')
      }}
    />
    </>
  )
}

/* ---------------- Published scenarios ---------------- */

/**
 * The third tab: what has been told to somebody, and to whom.
 *
 * **A reading surface, which is why it is not part of Runtime.** Every control in
 * Runtime swaps a load and recomputes a figure; nothing here changes a scenario. The
 * one act it offers — "Manage publishing…" — hands straight over to the dialog above
 * the tabs rather than growing an editor of its own.
 */
function Published({
  frame,
  onManage,
  onOpenInRuntime,
}: {
  frame: WhatIfFrame
  onManage: (savedId: string) => void
  /* Loads the scenario *and* moves to Runtime — owned above, because the active tab
     is not this component's to change. */
  onOpenInRuntime: (savedId: string) => void
}) {
  const saved = useWhatIfStore(selectSaved)
  const published = saved.filter((s) => s.published !== null)

  /** Which published scenario's details are open, or null. */
  const [viewing, setViewing] = useState<string | null>(null)
  const viewed = viewing === null ? null : (saved.find((s) => s.savedId === viewing) ?? null)

  /* A fragment, like every other tab body: `.wi-card` carries its own bottom margin,
     so a wrapper here would be a class with no rule behind it. */
  return (
    <>
      {published.length === 0 ? (
        /* The tab exists whether or not anything is in it, so the empty state has to
           say which of the two it is — and name the act that fills it. */
        <div className="wi-card">
          <div className="wi-label">Published scenarios</div>
          <p className="wi-help">
            Nothing has been published yet. Publish a scenario from <strong>Runtime</strong>{' '}
            — it stores the frame and each case&apos;s admitted load, never the figures, so
            what a reader opens is recomputed against the graph it is bound to.
          </p>
        </div>
      ) : (
        <PublishedScenarios frame={frame} saved={saved} onOpenDetails={setViewing} />
      )}

      {/* Reading the record. */}
      <PublishedScenarioModal
        open={viewed !== null}
        scenario={viewed}
        frame={frame}
        onClose={() => setViewing(null)}
        onManage={(savedId) => {
          setViewing(null)
          onManage(savedId)
        }}
        onOpenInRuntime={(savedId) => {
          setViewing(null)
          onOpenInRuntime(savedId)
        }}
      />
    </>
  )
}

/* ---------------- Authoring ---------------- */

function Authoring({
  frame,
  onRun,
  onMessage,
}: {
  frame: WhatIfFrame
  onRun: () => void
  onMessage: (text: string) => void
}) {
  const step = useWhatIfStore((s) => s.step)
  const setStep = useWhatIfStore((s) => s.setStep)
  /* The two forward steps that make no request. Back is never held — a reader going
     back is correcting something, and holding that reads as the page fighting them. */
  const { holding, hold } = useHeldStep()
  const watch = useWhatIfStore((s) => s.watch)
  const toggleWatch = useWhatIfStore((s) => s.toggleWatch)
  const pool = useWhatIfStore((s) => s.pool)
  const setPool = useWhatIfStore((s) => s.setPool)
  const count = useWhatIfStore((s) => s.count)
  const setCount = useWhatIfStore((s) => s.setCount)
  const name = useWhatIfStore((s) => s.name)
  const setName = useWhatIfStore((s) => s.setName)
  const resolution = useWhatIfStore((s) => s.resolution)
  const resolving = useWhatIfStore((s) => s.resolving)
  const resolve = useWhatIfStore((s) => s.resolve)
  const [typed, setTyped] = useState('')
  /* Local: whether the pool's graph reference is open. A disclosure is not the frame. */
  const [frameOpen, setFrameOpen] = useState(false)

  const { authoring } = frame
  const members = useMemo(() => poolMembers(frame, pool), [frame, pool])

  async function onResolve() {
    if (!typed.trim()) {
      onMessage('Type a measure for the graph to resolve.')
      return
    }
    const result = await resolve(typed)
    if (!result.ok) onMessage(result.error)
  }

  return (
    <>
      {/* The rail is clickable backwards only — a later step's question depends on
          this one's answer, so jumping ahead would ask it against nothing. */}
      <ol className="wi-rail">
        {authoring.steps.map((s) => (
          <li
            key={s.key}
            className={`wi-rail-step${s.n === step ? ' is-on' : s.n < step ? ' is-done' : ''}`}
          >
            <button type="button" disabled={s.n > step} onClick={() => setStep(s.n)}>
              <span className="wi-rail-idx">{s.n < step ? '✓' : s.n}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="wi-card">
          <h3>{authoring.steps[0].heading}</h3>
          <p className="wi-help">
            {frame.facility ? `${frame.facility.name} · ${frame.facility.role}. ` : ''}
            {authoring.steps[0].help}
          </p>

          <div className="wi-chips">
            {frame.measures.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`wi-chip${watch.includes(m.key) ? ' is-on' : ''}`}
                onClick={() => toggleWatch(m.key)}
                aria-pressed={watch.includes(m.key)}
              >
                <span className="wi-src">{m.source}</span>
                {m.label}
                {/* What it grounds to. A watched measure that cannot name its
                    relationship is not governed, and this is where that shows. */}
                <span className="wi-grounds">{m.grounds}</span>
              </button>
            ))}
          </div>

          <div className="wi-divider" />

          <label className="wi-label" htmlFor="wi-add">
            {authoring.addMeasure.label}
          </label>
          <Space.Compact className="wi-add">
            <Input
              id="wi-add"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onPressEnter={() => void onResolve()}
              placeholder={authoring.addMeasure.placeholder}
            />
            <Button loading={resolving} onClick={() => void onResolve()}>
              {authoring.addMeasure.button}
            </Button>
          </Space.Compact>

          {/* The graph's verdict, in its own words. A refusal is an answer here — the
              measure does not ground, so it cannot be watched, and nothing is invented
              to fill the gap. */}
          {resolution ? (
            <Alert
              className="wi-resolution"
              type={
                resolution.tone === 'ok'
                  ? 'success'
                  : resolution.tone === 'warn'
                    ? 'warning'
                    : 'error'
              }
              showIcon
              title={resolution.title}
              description={resolution.body}
            />
          ) : null}

          <p className="wi-help">{authoring.addMeasure.help}</p>

          <div className="wi-divider" />

          <h3>{authoring.scenarioCount.heading}</h3>
          <p className="wi-help">{authoring.scenarioCount.help}</p>
          <div className="wi-chips">
            {authoring.scenarioCount.options.map((n) => (
              <button
                key={n}
                type="button"
                className={`wi-chip is-seg${count === n ? ' is-on' : ''}`}
                onClick={() => setCount(n)}
                aria-pressed={count === n}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="wi-foot">
            {/* Refused with the reason rather than silently disabled: a scenario judged
                against nothing is not a scenario. */}
            <Button
              type="primary"
              loading={holding}
              disabled={watch.length === 0}
              title={watch.length === 0 ? 'Pick at least one measure to watch' : undefined}
              onClick={() => hold(() => setStep(2))}
            >
              {authoring.cta[0]}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="wi-card">
          <h3>{authoring.steps[1].heading}</h3>
          <p className="wi-help">{authoring.steps[1].help}</p>

          <div className="wi-chips">
            {frame.pools.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`wi-chip${pool === p.key ? ' is-on' : ''}`}
                onClick={() => setPool(p.key)}
                aria-pressed={pool === p.key}
              >
                {p.label}
                {/* The count is on the chip, so an empty pool reads as "nobody
                    qualifies" rather than as a dropdown that failed to fill. */}
                <span className="wi-count">{p.count}</span>
              </button>
            ))}
          </div>

          <div className="wi-divider" />

          <div className="wi-label">
            {members.length} generator{members.length === 1 ? '' : 's'} in this pool
            {members.length > authoring.previewRows
              ? ` · first ${authoring.previewRows} shown`
              : ''}
          </div>
          <ul className="wi-preview">
            {members.slice(0, authoring.previewRows).map((g) => (
              <li key={g.id}>
                <span className={`wi-risk is-${g.risk}`}>{g.risk}</span>
                <strong>{g.name}</strong>
                <span className="wi-preview-meta">
                  {g.state} · {g.violations} viol · {g.enforcement} enf · $
                  {Math.round(g.penalty / 1000)}k{g.consentDecree ? ' · CD' : ''}
                </span>
              </li>
            ))}
          </ul>

          {/*
           * The frame this pool *is*, drawn: every candidate shipping to the facility. The
           * link's words are the package's (`step.graph_link`), and the drawing states its
           * own cap, because a fan of seven standing for twenty-four is otherwise a silent
           * sample.
           */}
          <button
            type="button"
            className="wi-graph-link"
            onClick={() => setFrameOpen((open) => !open)}
            aria-expanded={frameOpen}
          >
            {authoring.graphLink}
          </button>
          {frameOpen ? <PoolFrame frame={frame} members={members} /> : null}

          <div className="wi-foot">
            <Button onClick={() => setStep(1)}>← Back</Button>
            <Button
              type="primary"
              loading={holding}
              disabled={members.length === 0}
              title={members.length === 0 ? 'This pool has no candidate loads' : undefined}
              onClick={() => hold(() => setStep(3))}
            >
              {authoring.cta[1]}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="wi-card">
          <h3>{authoring.steps[2].heading}</h3>
          <p className="wi-help">
            <strong>{frame.facility?.name}</strong> · {count} case
            {count === 1 ? '' : 's'} · pool:{' '}
            {frame.pools.find((p) => p.key === pool)?.label} ({members.length}) · watching:{' '}
            {frame.measures
              .filter((m) => watch.includes(m.key))
              .map((m) => m.label)
              .join(', ')}
          </p>

          {/*
           * The scenario's name. It is asked for here rather than in Runtime because the
           * scenario — this frame plus its cases — is the object that gets saved and
           * published, and an unnamed one is a library row nobody can refer to. Left
           * blank, the server names it from the pool rather than storing an empty label.
           */}
          <label className="wi-label" htmlFor="wi-name">
            Scenario name
          </label>
          <Input
            id="wi-name"
            className="wi-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Out-of-state load acceptance"
          />
          <p className="wi-help">
            The scenario is the publishable object — this frame (watched measures + pool)
            plus its cases. Readers open the whole scenario, never a single case.
          </p>

          {/* The tenant's own note, with its leading claim as the title — split rather
              than restated, so the sentence appears once and in their words. */}
          <Alert
            type="info"
            showIcon
            title={lead(authoring.reviewNote).title}
            description={lead(authoring.reviewNote).rest}
          />

          <div className="wi-foot">
            <Button onClick={() => setStep(2)}>← Back</Button>
            <Button type="primary" onClick={onRun}>
              {authoring.cta[2]}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ---------------- Runtime ---------------- */

function Runtime({
  frame,
  onMessage,
  onPublish,
}: {
  frame: WhatIfFrame
  onMessage: (text: string) => void
  /* Opens the one dialog that lives above the tabs — Runtime no longer owns it. */
  onPublish: (savedId: string) => void
}) {
  const columns = useWhatIfStore(selectColumns)
  const saved = useWhatIfStore(selectSaved)
  const current = useWhatIfStore(selectCurrent)
  const computed = useWhatIfStore((s) => s.computed)
  const computing = useWhatIfStore((s) => s.computing)
  const pending = useWhatIfStore((s) => s.pending)
  const pool = useWhatIfStore((s) => s.pool)
  const swapLoad = useWhatIfStore((s) => s.swapLoad)
  const renameColumn = useWhatIfStore((s) => s.renameColumn)
  const removeColumn = useWhatIfStore((s) => s.removeColumn)
  const saveCurrent = useWhatIfStore((s) => s.saveCurrent)
  const openSaved = useWhatIfStore((s) => s.openSaved)
  const remove = useWhatIfStore((s) => s.remove)

  const members = useMemo(() => poolMembers(frame, pool), [frame, pool])
  const headroom = headroomFor(frame, pool)
  const { compare } = frame.runtime

  /*
   * Publishing implies the scenario is in the library, so an unsaved one is saved first
   * rather than refused: the dialog needs an entry to hang off, and asking the reader to
   * press Save before Publish would be the page enforcing its own storage model.
   */
  async function openPublish() {
    if (current) {
      onPublish(current.savedId)
      return
    }
    const result = await saveCurrent()
    if (!result.ok) {
      onMessage(result.error)
      return
    }
    if (result.savedId) onPublish(result.savedId)
  }

  if (columns.length === 0) {
    return (
      <div className="wi-card">
        <h3>Nothing is running yet</h3>
        <p className="wi-help">
          Set the frame in <strong>Authoring</strong> — the measures to watch and the pool
          to draw from — then use “{frame.authoring.cta[2]}” to open the cases.
        </p>
      </div>
    )
  }

  return (
    <>
      <ScenarioBar
        frame={frame}
        current={current}
        caseCount={columns.length}
        saving={pending === 'scenario'}
        onSave={() =>
          void saveCurrent().then((r) => {
            if (!r.ok) onMessage(r.error)
          })
        }
        onPublish={() => void openPublish()}
      />

      <Row gutter={[SP.base, SP.base]} className="wi-strip">
        {columns.map((c, i) => (
          <Col key={c.columnId} xs={24} lg={24 / Math.min(columns.length, 3)}>
            <ScenarioColumn
              column={c}
              index={i}
              scenario={computed[c.columnId]}
              computing={computing.includes(c.columnId)}
              frame={frame}
              candidates={members}
              canRemove={columns.length > compare.min}
              onSwap={(id) => void swapLoad(c.columnId, id).then((r) => {
                if (!r.ok) onMessage(r.error)
              })}
              onRename={(name) => renameColumn(c.columnId, name)}
              onRemove={() => removeColumn(c.columnId)}
            />
          </Col>
        ))}
      </Row>

      {/* The inverse question. The figure and the average behind it both come from the
          server — a break point computed here would be arithmetic on a measure. */}
      <div className="wi-card">
        <div className="wi-label">{frame.runtime.headroom.label}</div>
        {headroom && headroom.room !== null ? (
          <>
            <div className="wi-headroom">
              <span className={`wi-headroom-n${headroom.room > 0 ? '' : ' is-none'}`}>
                {headroom.room}
              </span>
              <span className="wi-headroom-text">
                {frame.runtime.headroom.sentence
                  .replace('{room}', String(headroom.room))
                  .replace('{appetite}', String(headroom.appetite))}
              </span>
            </div>
            <p className="wi-help">
              {frame.runtime.headroom.help.replace('{avg}', String(headroom.avg))}
            </p>
          </>
        ) : (
          /* No carrying generator in this pool, so there is no break point. Said
             plainly — an em dash here would read as "no limit". */
          <p className="wi-help">
            No generator in this pool carries enforcement, so there is no break point to
            state for it.
          </p>
        )}
      </div>

      <ScenarioLibrary
        frame={frame}
        saved={saved}
        currentId={current?.savedId ?? null}
        pending={pending}
        onOpen={(id) =>
          void openSaved(id).then((r) => {
            if (!r.ok) onMessage(r.error)
          })
        }
        onPublish={onPublish}
        onRemove={(id) =>
          void remove(id).then((r) => {
            if (!r.ok) onMessage(r.error)
          })
        }
      />

      <Alert
        type="info"
        showIcon
        title={lead(frame.runtime.closingNote).title}
        description={lead(frame.runtime.closingNote).rest}
      />
    </>
  )
}

/**
 * What the runtime currently *is*: the scenario, whether it is in the library, and
 * whether it has been published.
 *
 * The bar exists because the frame and the cases are one object. Save and Publish were
 * per-column controls in v1, which made the library a shelf of loose loads; here they act
 * on the scenario, and the row states which of the three states it is in rather than
 * leaving the reader to infer it from a button's label.
 */
function ScenarioBar({
  frame,
  current,
  caseCount,
  saving,
  onSave,
  onPublish,
}: {
  frame: WhatIfFrame
  current: WhatIfSaved | null
  caseCount: number
  saving: boolean
  onSave: () => void
  onPublish: () => void
}) {
  const name = useWhatIfStore((s) => s.name)
  const watch = useWhatIfStore((s) => s.watch)
  const pool = useWhatIfStore((s) => s.pool)
  const published = current?.published ?? null

  return (
    <div className="wi-card wi-bar">
      <div className="wi-bar-what">
        <div className="wi-label">Scenario</div>
        <div className="wi-bar-name">{name || 'Untitled scenario'}</div>
        <div className="wi-help wi-bar-meta">
          {frame.pools.find((p) => p.key === pool)?.label} pool · watching {watch.length}{' '}
          measure{watch.length === 1 ? '' : 's'} · {caseCount} case
          {caseCount === 1 ? '' : 's'}
        </div>
      </div>

      {/* Three states, and a saved-but-unpublished one is not a lesser published one —
          so the tag says which, in words, rather than by tint alone. */}
      {published ? (
        <Tag color="success">
          Published · {published.readers.length} reader
          {published.readers.length === 1 ? '' : 's'}
        </Tag>
      ) : current ? (
        <Tag>In library</Tag>
      ) : (
        <Tag>Not saved yet</Tag>
      )}

      <Space size={SP.sm} wrap>
        <Button loading={saving} onClick={onSave}>
          {current ? frame.runtime.library.updateBtn : frame.runtime.library.saveBtn}
        </Button>
        <Button type={published ? 'default' : 'primary'} onClick={onPublish}>
          {published ? frame.publishing.buttons.manage : frame.publishing.buttons.open}
        </Button>
      </Space>
    </div>
  )
}

/**
 * The library: complete scenarios, never loose loads.
 *
 * A row states its frame as well as its cases, because that is what makes it re-openable
 * as the thing it was — opening one loads its measures and pool back into Authoring and
 * recomputes every case against today's graph. It stores no figures, which is exactly why
 * re-opening is a computation rather than a restore.
 */
function ScenarioLibrary({
  frame,
  saved,
  currentId,
  pending,
  onOpen,
  onPublish,
  onRemove,
}: {
  frame: WhatIfFrame
  saved: WhatIfSaved[]
  currentId: string | null
  pending: string | null
  onOpen: (savedId: string) => void
  onPublish: (savedId: string) => void
  onRemove: (savedId: string) => void
}) {
  const { library } = frame.runtime

  return (
    <div className="wi-card">
      <div className="wi-label">
        {library.title}
        {saved.length > 0 ? ` · ${saved.length}` : ''}
      </div>
      {saved.length === 0 ? (
        <p className="wi-help">{library.empty}</p>
      ) : (
        saved.map((s) => {
          const open = s.savedId === currentId
          const poolLabel = frame.pools.find((p) => p.key === s.pool)?.label ?? s.pool
          return (
            <div key={s.savedId} className="wi-tray">
              <div className="wi-tray-what">
                <strong>{s.name}</strong>
                <div className="wi-help wi-tray-meta">
                  {poolLabel} pool · watching {s.watch.length} measure
                  {s.watch.length === 1 ? '' : 's'} · {s.cases.length} case
                  {s.cases.length === 1 ? '' : 's'}:{' '}
                  {s.cases
                    .map(
                      (c) =>
                        frame.generators.find((g) => g.id === c.generatorId)?.name ??
                        c.generatorId,
                    )
                    .join(', ')}
                </div>
              </div>
              <Space size={SP.sm} wrap>
                <Button
                  size="small"
                  disabled={open}
                  title={open ? 'Already open in Runtime' : undefined}
                  onClick={() => onOpen(s.savedId)}
                >
                  {open ? 'Open' : library.addBtn}
                </Button>
                {/*
                 * Publishing, only where it is the act still to be done.
                 *
                 * A published row states nothing about its publication here — no tag,
                 * no bound-to line, no Manage button. All of that is the Published
                 * scenarios tab's, and it was in both places at once: two surfaces
                 * reporting one record, which is how they come to disagree. What the
                 * library is for is re-opening a scenario, and that is what its row
                 * still does.
                 */}
                {s.published ? null : (
                  <Button size="small" onClick={() => onPublish(s.savedId)}>
                    {frame.publishing.buttons.open}
                  </Button>
                )}
                <Button
                  size="small"
                  loading={pending === s.savedId}
                  onClick={() => onRemove(s.savedId)}
                  aria-label={`Delete ${s.name} from the library`}
                >
                  ✕
                </Button>
              </Space>
            </div>
          )
        })
      )}
    </div>
  )
}
