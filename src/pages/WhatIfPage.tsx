import { Alert, App, Button, Col, Input, Row, Space, Spin, Tabs } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { WhatIfFrame } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ScenarioColumn from '../components/ScenarioColumn'
import { PoolFrame } from '../components/WhatIfGraph'
import {
  headroomFor,
  poolMembers,
  selectColumns,
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
 * Two tabs, and they are two different jobs. **Authoring sets the frame** — which
 * governed measures are watched, which pool of generators a scenario may draw from, how
 * many columns to compare — and it is a three-step wizard because each answer narrows
 * the next. **Runtime swaps loads inside that frame** and every figure recomputes on
 * the server, so a saved scenario stays true as the graph changes: the library stores
 * the admitted load, never the numbers.
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
       * The gate replaces the lens, it does not sit under it. Everything below the
       * header is a claim about connected data — the banner names 36 inbound
       * generators and the note names the package the figures came from — and printing
       * either above "No data source is connected" describes a graph the page has
       * just said is not there. The whole lens, chrome included, lives in
       * `WhatIfLens`, so the ungated branch has no copy to leak.
       */}
      {frame.publishedCount === 0 ? (
        /* The second precondition. The copy calls this a read-only overlay *on the
           knowledge graph*: with nothing published there is no graph to overlay, and
           figures shown anyway would be attributed to content nobody has published. */
        <NoPublishedGraph
          detail="The lens overlays the published graph — it traverses it to reach each generator's federal record."
          builtCount={frame.builtCount}
          draftCount={frame.draftCount}
        />
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

  return (
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
          ) : (
            <Runtime frame={frame} onMessage={onMessage} />
          ),
      }))}
    />
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
  const watch = useWhatIfStore((s) => s.watch)
  const toggleWatch = useWhatIfStore((s) => s.toggleWatch)
  const pool = useWhatIfStore((s) => s.pool)
  const setPool = useWhatIfStore((s) => s.setPool)
  const count = useWhatIfStore((s) => s.count)
  const setCount = useWhatIfStore((s) => s.setCount)
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
              disabled={watch.length === 0}
              title={watch.length === 0 ? 'Pick at least one measure to watch' : undefined}
              onClick={() => setStep(2)}
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
              disabled={members.length === 0}
              title={members.length === 0 ? 'This pool has no candidate loads' : undefined}
              onClick={() => setStep(3)}
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
            <strong>{frame.facility?.name}</strong> · {count} scenario
            {count === 1 ? '' : 's'} · pool:{' '}
            {frame.pools.find((p) => p.key === pool)?.label} ({members.length}) · watching:{' '}
            {frame.measures
              .filter((m) => watch.includes(m.key))
              .map((m) => m.label)
              .join(', ')}
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
}: {
  frame: WhatIfFrame
  onMessage: (text: string) => void
}) {
  const columns = useWhatIfStore(selectColumns)
  const saved = useWhatIfStore(selectSaved)
  const computed = useWhatIfStore((s) => s.computed)
  const computing = useWhatIfStore((s) => s.computing)
  const pending = useWhatIfStore((s) => s.pending)
  const pool = useWhatIfStore((s) => s.pool)
  const swapLoad = useWhatIfStore((s) => s.swapLoad)
  const renameColumn = useWhatIfStore((s) => s.renameColumn)
  const removeColumn = useWhatIfStore((s) => s.removeColumn)
  const addColumn = useWhatIfStore((s) => s.addColumn)
  const save = useWhatIfStore((s) => s.save)
  const remove = useWhatIfStore((s) => s.remove)

  const members = useMemo(() => poolMembers(frame, pool), [frame, pool])
  const headroom = headroomFor(frame, pool)
  const { library, compare } = frame.runtime
  const full = columns.length >= compare.max

  if (columns.length === 0) {
    return (
      <div className="wi-card">
        <h3>Nothing is running yet</h3>
        <p className="wi-help">
          Set the frame in <strong>Authoring</strong> — the measures to watch and the pool
          to draw from — then use “{frame.authoring.cta[2]}” to open the columns.
        </p>
      </div>
    )
  }

  return (
    <>
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
              pending={pending === c.columnId}
              onSwap={(id) => void swapLoad(c.columnId, id).then((r) => {
                if (!r.ok) onMessage(r.error)
              })}
              onRename={(name) => renameColumn(c.columnId, name)}
              onRemove={() => removeColumn(c.columnId)}
              onSave={() => void save(c.columnId).then((r) => {
                if (!r.ok) onMessage(r.error)
              })}
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

      <div className="wi-card">
        <div className="wi-label">
          {library.title}
          {saved.length > 0 ? ` · ${saved.length}` : ''}
        </div>
        {saved.length === 0 ? (
          <p className="wi-help">{library.empty}</p>
        ) : (
          <>
            {saved.map((s) => {
              const g = frame.generators.find((x) => x.id === s.generatorId)
              const open = columns.some((c) => c.savedId === s.savedId)
              return (
                <div key={s.savedId} className="wi-tray">
                  <div>
                    <strong>{s.name}</strong>
                    <div className="wi-help wi-tray-meta">
                      Load: {g?.name ?? s.generatorId}
                      {g
                        ? ` · ${g.enforcement} enf · ${g.violations} viol · $${Math.round(g.penalty / 1000)}k${g.consentDecree ? ' · CD' : ''}`
                        : ''}
                    </div>
                  </div>
                  <Space size={SP.sm}>
                    <Button
                      size="small"
                      disabled={open || full}
                      title={
                        open
                          ? 'Already open in the compare strip'
                          : full
                            ? library.fullHelp
                            : undefined
                      }
                      onClick={() =>
                        void addColumn(s.generatorId, s.name, s.savedId).then((r) => {
                          if (!r.ok) onMessage(r.error)
                        })
                      }
                    >
                      {open ? 'In compare' : full ? 'Compare full' : library.addBtn}
                    </Button>
                    <Button
                      size="small"
                      loading={pending === s.savedId}
                      onClick={() =>
                        void remove(s.savedId).then((r) => {
                          if (!r.ok) onMessage(r.error)
                        })
                      }
                      aria-label={`Delete ${s.name} from the library`}
                    >
                      ✕
                    </Button>
                  </Space>
                </div>
              )
            })}
            <p className="wi-help">{full ? library.fullHelp : compare.help}</p>
          </>
        )}
      </div>

      <Alert
        type="info"
        showIcon
        title={lead(frame.runtime.closingNote).title}
        description={lead(frame.runtime.closingNote).rest}
      />
    </>
  )
}
