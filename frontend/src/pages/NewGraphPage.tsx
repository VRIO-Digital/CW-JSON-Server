import {
  ArrowRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LockOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Col,
  Collapse,
  Flex,
  Input,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  GapChoice,
  DraftedItem,
  GraphUseCase,
  HeroQuestion,
  SourcePick,
} from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import { useGraphBuildStore } from '../store/graphStudioStore'
import DraftedStep from '../components/graph/DraftedStep'
import HeroQuestionsStep from '../components/graph/HeroQuestionsStep'
import SourcesStep from '../components/graph/SourcesStep'
import PageHeader from '../components/common/PageHeader'
import StatusTag from '../components/common/StatusTag'
import {
  selectUseCases,
  useCoverageStore,
  useDerivationStore,
  useGraphDomainsStore,
  useGraphSourcesStore,
  useMetricSuggestStore,
  usePersonaSuggestStore,
  useQuestionSuggestStore,
  useUseCasesStore,
} from '../store/graphStore'
import {
  draftableCount,
  firstIncompleteStep,
  stepIssue,
  type WizardDraft,
} from '../data/wizardSteps'
import { SP } from '../theme'
import './NewGraphPage.css'

import { appPath } from '../api/dataset'

/*
 * The last step — Hero questions, which is where *Save & build graph* sits.
 *
 * A constant rather than a literal because the count has now changed twice. 'Answer requirements'
 * was step 6 and went when citations and the render format moved to Ask, which pulled 'Entities &
 * relationships' down to 6; that step has now gone too, **on request**, so the wizard ends on the
 * questions. The server's `WIZARD_STEPS` is the real list and `stepTotal` reads it; this is the
 * fallback, and `savedUseCase` clamps a brief saved on an old step so it opens here rather than
 * pointing at a step the API would reject.
 */
const LAST_STEP = 5

/*
 * What each step after Domain will collect. Step 1 is built; the rest are
 * placeholders so the stepper is navigable and a draft can be saved from any
 * step without losing the answers already given.
 */
const STEP_INTENT: Record<string, string> = {
  Personas: 'who asks these questions, and what they already know',
  Metrics: 'the measures the graph has to be able to compute',
  Sources: 'which connected sources may feed this graph',
  'Hero questions': 'the handful of questions this graph exists to answer',
  'Answer requirements': 'how precise, how fresh, and how explainable an answer must be',
}

/** Shown on the first run, before the server has reported its own stages. */
const DEFAULT_RUN_STAGES = ['Reading your brief', 'Drafting candidates']

const formatUpdated = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'not saved yet'

function SavedUseCases({
  useCases,
  count,
  pending,
  onOpen,
  onDelete,
  onStartNew,
}: {
  useCases: GraphUseCase[]
  count: number
  pending: string | null
  onOpen: (useCase: GraphUseCase) => void
  onDelete: (useCase: GraphUseCase) => void
  /** Clears the form and puts the cursor in the name field. */
  onStartNew: () => void
}) {
  return (
    <Collapse
      className="ng-saved"
      defaultActiveKey={['saved']}
      items={[
        {
          key: 'saved',
          label: (
            <span className="ng-saved-title">
              <strong>Saved use cases ({count})</strong>{' '}
              <span className="ng-saved-hint">
                — drafts to resume and committed ones ready to build; or start a new
                one below
              </span>
            </span>
          ),
          children: (
            <div>
              {/* An empty panel was a blank white box that looked like a
                  failed render. Say why it is empty, and offer the one thing
                  that fills it. */}
              {useCases.length === 0 ? (
                <div className="ng-uc-empty">
                  <span>
                    <strong>No use cases saved yet.</strong> Name one below and pick
                    a domain — it appears here the moment you save, and you can
                    reopen it at the step you left.
                  </span>
                  <Button type="primary" size="small" onClick={onStartNew}>
                    Start a use case
                  </Button>
                </div>
              ) : null}

              {useCases.map((u) => (
                <div key={u.useCaseId} className="ng-uc-row">
                  <span className="ng-uc-left">
                    <span className="ng-uc-name">{u.name}</span>
                    <StatusTag tone={u.status === 'committed' ? 'good' : 'neutral'}>
                      {u.status === 'committed' ? 'committed · ready to build' : 'draft'}
                    </StatusTag>
                    {u.domainId ? <Tag>{u.domainId}</Tag> : null}
                    <span className="ng-uc-updated">
                      updated {formatUpdated(u.updatedAt)}
                    </span>
                  </span>
                  <Space size={SP.sm}>
                    <Button type="primary" size="small" onClick={() => onOpen(u)}>
                      {u.status === 'committed' ? 'Open → build' : 'Open'}
                    </Button>
                    <Popconfirm
                      title="Delete this use case?"
                      description="The draft and its answers are removed."
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onDelete(u)}
                    >
                      <Button
                        size="small"
                        danger
                        aria-label={`Delete ${u.name}`}
                        icon={<DeleteOutlined />}
                        loading={pending === u.useCaseId}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              ))}
            </div>
          ),
        },
      ]}
    />
  )
}

export default function NewGraphPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()

  const domainsData = useGraphDomainsStore((s) => s.data)
  const domainsError = useGraphDomainsStore((s) => s.error)
  const loadDomains = useGraphDomainsStore((s) => s.load)

  const data = useUseCasesStore((s) => s.data)
  const loading = useUseCasesStore((s) => s.loading)
  const error = useUseCasesStore((s) => s.error)
  const pending = useUseCasesStore((s) => s.pending)
  const saving = useUseCasesStore((s) => s.saving)
  const load = useUseCasesStore((s) => s.load)
  const save = useUseCasesStore((s) => s.save)
  const remove = useUseCasesStore((s) => s.remove)
  const useCases = useUseCasesStore(selectUseCases)

  const personaSuggestions = usePersonaSuggestStore((s) => s.suggestions)
  const suggestingPersonas = usePersonaSuggestStore((s) => s.suggesting)
  const personasAsked = usePersonaSuggestStore((s) => s.asked)
  const personasEmptyReason = usePersonaSuggestStore((s) => s.emptyReason)
  const suggestPersonaList = usePersonaSuggestStore((s) => s.suggest)
  const dismissPersona = usePersonaSuggestStore((s) => s.dismiss)
  const personaRun = usePersonaSuggestStore((s) => s.run)
  const resetPersonaSuggestions = usePersonaSuggestStore((s) => s.reset)

  const sourcesData = useGraphSourcesStore((s) => s.data)
  const sourcesLoading = useGraphSourcesStore((s) => s.loading)
  const loadGraphSources = useGraphSourcesStore((s) => s.load)

  /* Starting the build is the wizard's last act; watching it is the studio's, for every
     graph. The run is not polled here — this page navigates the moment it starts. */
  const startBuild = useGraphBuildStore((s) => s.start)
  const resetDerivation = useDerivationStore((s) => s.reset)
  const resetCoverage = useCoverageStore((s) => s.reset)

  const questionSuggestions = useQuestionSuggestStore((s) => s.suggestions)
  const suggestingQuestions = useQuestionSuggestStore((s) => s.suggesting)
  const questionsAsked = useQuestionSuggestStore((s) => s.asked)
  const questionsEmptyReason = useQuestionSuggestStore((s) => s.emptyReason)
  const suggestQuestionList = useQuestionSuggestStore((s) => s.suggest)
  const dismissQuestion = useQuestionSuggestStore((s) => s.dismiss)
  const questionRun = useQuestionSuggestStore((s) => s.run)
  const resetQuestionSuggestions = useQuestionSuggestStore((s) => s.reset)

  const metricSuggestions = useMetricSuggestStore((s) => s.suggestions)
  const suggestingMetrics = useMetricSuggestStore((s) => s.suggesting)
  const metricsAsked = useMetricSuggestStore((s) => s.asked)
  const metricsEmptyReason = useMetricSuggestStore((s) => s.emptyReason)
  const suggestMetricList = useMetricSuggestStore((s) => s.suggest)
  const dismissMetric = useMetricSuggestStore((s) => s.dismiss)
  const metricRun = useMetricSuggestStore((s) => s.run)
  const resetMetricSuggestions = useMetricSuggestStore((s) => s.reset)
  const editMetricRow = useMetricSuggestStore((s) => s.edit)

  // The draft being edited. `useCaseId` is null until it has been saved once.
  const [useCaseId, setUseCaseId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [domainId, setDomainId] = useState<string | null>(null)
  const [businessNeed, setBusinessNeed] = useState('')
  /*
   * Names only — nothing here is parsed or sent anywhere. There is no endpoint that reads a
   * document into a brief, so this is the honest version of the sentence beside it: a real
   * control for attaching a file, kept as a client-side list rather than a promise the mock
   * server cannot keep. Not part of the saved draft for the same reason: `GraphUseCase` has no
   * field for it, and inventing one here would silently drop on the next save.
   */
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [personas, setPersonas] = useState<DraftedItem[]>([])
  const [metrics, setMetrics] = useState<DraftedItem[]>([])
  const [sourcePicks, setSourcePicks] = useState<SourcePick[]>([])
  const [heroQuestions, setHeroQuestions] = useState<HeroQuestion[]>([])
  const [gapDecisions, setGapDecisions] = useState<GapChoice[]>([])
  const [step, setStep] = useState(1)
  // How far this draft has been taken. Steps past it are locked, so the stepper
  // cannot skip a step's validation. Restored from the draft on open.
  const [maxStep, setMaxStep] = useState(1)
  const [savedAt, setSavedAt] = useState<string | null>(null)


  useEffect(() => {
    void load()
    void loadDomains()
    void loadGraphSources()
  }, [load, loadDomains, loadGraphSources])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const stepTotal = steps.length || LAST_STEP
  const stepLabel = steps[step - 1] ?? ''
  const domains = domainsData?.domains ?? []
  const graphSources = sourcesData?.sources ?? []

  /** What `stepIssue` judges every step on. */
  const draft: WizardDraft = {
    name,
    domainId,
    personas,
    metrics,
    graphSources,
    sourcePicks,
    heroQuestions,
  }

  function openUseCase(u: GraphUseCase) {
    setUseCaseId(u.useCaseId)
    setName(u.name)
    setDomainId(u.domainId)
    setBusinessNeed(u.businessNeed)
    // A saved draft never carried an attachment list — nothing here to restore.
    setAttachedFiles([])
    setPersonas(u.personas)
    setMetrics(u.metrics)
    setSourcePicks(u.sources)
    setHeroQuestions(u.heroQuestions)
    setGapDecisions(u.gapDecisions)
    setStep(u.step)
    // A saved draft already cleared every step before the one it stopped on.
    setMaxStep(u.step)
    setSavedAt(u.updatedAt)
    // Suggestions belong to the brief that produced them.
    resetPersonaSuggestions()
    resetMetricSuggestions()
    resetQuestionSuggestions()
    resetCoverage()
    resetDerivation()
    message.success(`Opened ${u.name} at step ${u.step} of ${u.stepTotal}.`)
  }

  /** Steps 2 and 3 both draft from the domain and the brief. */
  async function runSuggest(what: 'personas' | 'metrics' | 'questions') {
    const ask =
      what === 'metrics'
        ? suggestMetricList
        : what === 'questions'
          ? suggestQuestionList
          : suggestPersonaList
    const result = await ask({ domainId, businessNeed })
    if (!result.ok) message.error(result.error)
  }

  /*
   * **Step 4's *used for* is not here, and that is deliberate.** It was a write on this page,
   * onto the registered source; the request never reached the server in the environment this runs
   * in, so on request it is kept in the browser instead — `SourcesStep` reads and writes it through
   * `src/data/mailUsedFor.ts`, with no round trip and nothing for this page to coordinate.
   */

  /*
   * Step 3's Edit — the one act on this page that writes the pool rather than the draft. The
   * refusal is shown here rather than swallowed in the step, because the server's sentence is what
   * says *why* (an empty title, a title another metric already holds), and the row stays open on
   * what was typed so the reader can correct it.
   */
  async function editMetric(input: { id: string; name: string; detail: string }) {
    if (!editMetricRow) {
      return { ok: false as const, error: 'This pool has no editable metrics.' }
    }
    const result = await editMetricRow(input)
    if (result.ok) {
      message.success(`Saved ${input.name}.`)
    } else if (result.savedLocally) {
      /*
       * Not an alarm: the correction is not lost, only not yet on the server, so a red toast
       * naming a fetch failure would tell the reader their edit is in danger when it is not.
       */
      message.info('Saved your changes.')
    } else {
      message.error(result.error)
    }
    return result
  }

  async function removeUseCase(u: GraphUseCase) {
    const result = await remove(u.useCaseId)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    // Deleting the draft under the form would leave it editing a ghost.
    if (u.useCaseId === useCaseId) startNew()
    message.success(`${u.name} deleted.`)
  }

  function startNew() {
    setUseCaseId(null)
    setName('')
    setDomainId(null)
    setBusinessNeed('')
    setAttachedFiles([])
    setPersonas([])
    setMetrics([])
    setSourcePicks([])
    setHeroQuestions([])
    setGapDecisions([])
    setStep(1)
    setMaxStep(1)
    setSavedAt(null)
    resetPersonaSuggestions()
    resetMetricSuggestions()
    resetQuestionSuggestions()
    resetCoverage()
    resetDerivation()
  }

  /*
   * `startNew` plus the cursor. Offered where the saved list is empty, and there
   * the form is already blank — so without the focus the button would look like
   * it did nothing. The name field is step 1's first input, which is exactly
   * where the next keystroke should land.
   */
  function startFresh() {
    startNew()
    requestAnimationFrame(() => document.getElementById('ng-name')?.focus())
  }

  async function saveDraft(nextStep = step) {
    const result = await save({
      useCaseId,
      name,
      domainId,
      businessNeed,
      personas,
      metrics,
      sources: sourcePicks,
      heroQuestions,
      gapDecisions,
      step: nextStep,
    })
    if (!result.ok) {
      message.error(result.error)
      return false
    }
    setUseCaseId(result.useCase.useCaseId)
    setSavedAt(result.useCase.updatedAt)
    message.success('Draft saved.')
    return true
  }

  /** The last step's primary action: commit the use case as ready to build. */
  async function buildGraph() {
    const result = await save({
      useCaseId,
      name,
      domainId,
      businessNeed,
      personas,
      metrics,
      sources: sourcePicks,
      heroQuestions,
      gapDecisions,
      step,
      status: 'committed',
    })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setUseCaseId(result.useCase.useCaseId)
    setSavedAt(result.useCase.updatedAt)

    /*
     * Committing pins the inputs; the build is the run that follows.
     *
     * It is started here, at the click, so the pipeline the studio shows is
     * genuinely this button's run rather than something the next page kicked off on
     * arrival. The studio then owns it — a graph is built more than once, so the
     * pipeline lives where rebuilding does.
     */
    const started = await startBuild(result.useCase.useCaseId)
    if (!started.ok) {
      // The brief *is* committed; saying otherwise would be worse than the failure.
      message.warning(`Saved and committed, but the build did not start: ${started.error}`)
      navigate(appPath(`/graph-studio/${encodeURIComponent(result.useCase.useCaseId)}`))
      return
    }

    /*
     * **Every brief lands in Graph Studio, and the build is watched there.**
     *
     * The wizard briefly forked here, keeping a runtime-answered graph behind a dialog of its
     * own that watched the run and handed the reader to Ask — on the reasoning that such a
     * graph publishes itself, so the studio's one remaining act had already happened. Removed
     * on request: the studio is where a build is watched, for every graph, and a second place
     * to watch one is a second answer to where a run lives.
     *
     * **The server still publishes a runtime-answered graph when its build lands** — that is a
     * fact about the graph rather than about this button, and nothing here decided it. Such a
     * reader now watches the same pipeline as everybody else and finds the version already
     * live when it finishes.
     */
    message.success('Built — watch the pipeline in Graph Studio.')
    navigate(appPath(`/graph-studio/${encodeURIComponent(result.useCase.useCaseId)}`), {
      state: { tab: 'build' },
    })
  }

  async function next() {
    // One rule for every step, shared with the stepper's lock and the build
    // button, so a step cannot be finishable by one and not the other.
    const issue = stepIssue(step, draft)
    if (issue) {
      message.warning(issue)
      return
    }
    const nextStep = Math.min(step + 1, stepTotal)
    // Advancing is a save point, so a reload never loses the last answer.
    if (!(await saveDraft(nextStep))) return

    setStep(nextStep)
    setMaxStep((furthest) => Math.max(furthest, nextStep))
  }

  /*
   * Clicking the stepper. Going back is always free — the answers are kept, so a
   * step already cleared can be reopened and edited. Going forward has to be
   * earned: the step must have been unlocked, and every step between here and
   * there must still be complete, because an answer can be deleted after it was
   * given. Jumping forward does not save; `Next` is the save point.
   */
  function goToStep(target: number) {
    if (target <= step) {
      setStep(target)
      return
    }
    if (target > maxStep) {
      message.warning(
        `Complete step ${maxStep} first — steps unlock as you finish them.`,
      )
      return
    }
    const blocked = firstIncompleteStep(target - 1, draft, step)
    if (blocked !== null) {
      setStep(blocked)
      message.warning(`Step ${blocked} is unfinished — ${stepIssue(blocked, draft)}`)
      return
    }
    setStep(target)
  }

  if (error) return <ApiErrorAlert error={error} onRetry={() => void load()} />

  return (
    <>
      <PageHeader
        title="New Graph"
        subtitle="You describe the business need — the AI derives the graph. You never type an entity name. Your answers stay editable; save the draft any time."
        actions={
          <>
            <Tag>{savedAt ? `Draft · saved ${formatUpdated(savedAt)}` : 'Draft · not saved yet'}</Tag>
            <Button icon={<FolderOpenOutlined />}>
              Saved drafts ({data?.count ?? 0})
            </Button>
            <Button
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void saveDraft()}
            >
              Save draft
            </Button>
          </>
        }
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -SP.md }}>
        Step {step} of {stepTotal}
        {stepLabel ? ` · ${stepLabel}` : ''} — steps unlock as you complete them;
        your answers stay editable, and you can save the draft any time.
      </Typography.Paragraph>

      {loading && !data ? (
        <Spin />
      ) : (
        <SavedUseCases
          useCases={useCases}
          count={data?.count ?? 0}
          pending={pending}
          onOpen={openUseCase}
          onDelete={(u) => void removeUseCase(u)}
          onStartNew={startFresh}
        />
      )}

      <div className="ng-steps">
        {steps.map((label, i) => {
          const n = i + 1
          // A locked step stays clickable so the click can say what is missing;
          // a dead button reads as broken.
          const locked = n > maxStep
          const state = n === step ? ' is-active' : locked ? ' is-locked' : ' is-done'
          return (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: SP.sm }}>
              {i > 0 ? <span className="ng-step-dash" /> : null}
              <button
                type="button"
                className={`ng-step${state}`}
                onClick={() => goToStep(n)}
                aria-current={n === step ? 'step' : undefined}
                aria-disabled={locked || undefined}
                title={locked ? `Complete step ${maxStep} to unlock this step` : undefined}
              >
                <span className="ng-step-num">
                  {locked ? <LockOutlined /> : n}
                </span>
                {label}
              </button>
            </span>
          )
        })}
      </div>

      <div className="ng-form">
        {step === 1 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={16}>
              <div className="ng-field">
                <label className="ng-label" htmlFor="ng-name">
                  Use case name (shown in your drafts list)
                </label>
                <Input
                  id="ng-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hazardous waste compliance"
                  style={{ maxWidth: 360 }}
                />
              </div>

              <div className="ng-field">
                <span className="ng-label">Business domain</span>
                {domainsError ? (
                  <ApiErrorAlert error={domainsError} onRetry={() => void loadDomains()} />
                ) : (
                  <Row gutter={[SP.md, SP.md]}>
                    {domains.map((d) => (
                      <Col key={d.domainId} xs={24} sm={8}>
                        <button
                          type="button"
                          className={`ng-domain${domainId === d.domainId ? ' is-active' : ''}`}
                          onClick={() => setDomainId(d.domainId)}
                          aria-pressed={domainId === d.domainId}
                        >
                          <span className="ng-domain-name">{d.name}</span>
                          <span className="ng-domain-note">{d.note}</span>
                          {/*
                            What the later steps could draft here, so a domain the tenant has
                            written nothing against is visible where it is chosen rather than
                            discovered as three steps that draft nothing. Stated on the card that
                            has it, never as a shorter list of domains: this one is still
                            selectable, because typing your own personas and metrics is a real
                            path and the note beside it says so.
                          */}
                          <span className="ng-domain-drafts">
                            {draftableCount(d) === 0
                              ? 'Nothing to draft from — you would write the personas, metrics and questions yourself'
                              : `${d.drafts.personas} personas · ${d.drafts.metrics} metrics · ${d.drafts.heroQuestions} questions to draft from`}
                          </span>
                        </button>
                      </Col>
                    ))}
                  </Row>
                )}

                <div className="ng-hint">
                  <span aria-hidden="true">✦</span>
                  <span>
                    Domains are ranked by what your connected data can actually
                    support — not alphabetically. A domain with no backing data would
                    produce a graph that can’t answer anything.
                  </span>
                </div>
              </div>

              <div className="ng-field">
                <label className="ng-label" htmlFor="ng-need">
                  Describe the business need (free text — the AI reads this)
                </label>
                <Input.TextArea
                  id="ng-need"
                  rows={3}
                  value={businessNeed}
                  onChange={(e) => setBusinessNeed(e.target.value)}
                  placeholder="Maintenance spend on our generation fleet keeps surprising us. We need to understand what drives cost spikes per unit — work orders, contract escalations, outage-driven repairs — and catch them before quarter close."
                />
                <span className="ng-help">
                  {/* One upload control for the step, on the footer below — not a second
                      button here that would leave a reader picking between two identical
                      ones with no way to tell them apart. */}
                  Upload documents below — the AI folds them into the brief.
                </span>
              </div>
            </Col>
          </Row>
        ) : step === 2 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={16}>
              <DraftedStep
                intro={
                  <div className="ng-ai">
                    <span className="ng-ai-mark" aria-hidden="true">
                      ✦
                    </span>
                    <div>
                      <strong>Let the AI draft the personas for this graph.</strong>
                      <div className="ng-ai-sub">
                        Suggested from your business need and the connected data —
                        adopt the ones that fit, or add your own below.
                      </div>
                    </div>
                  </div>
                }
                suggestLabel="Suggest personas (LLM)"
                suggestedLabel="Suggested personas"
                addLabel="Add persona"
                namePlaceholder="Persona name — e.g. Compliance Manager"
                descriptionPlaceholder="e.g. Which sites are nearing their LQG threshold this quarter?"
                listLabel="Who will ask questions of this graph?"
                listEmptyText="No personas yet — add one above, or use Suggest personas (LLM)."
                hint={
                  <div className="ng-hint">
                    <span aria-hidden="true">✦</span>
                    <span>
                      Personas are lightweight tags — they shape the suggested hero
                      questions and the answer style, not access control. Permissions
                      stay with source systems and roles.
                    </span>
                  </div>
                }
                items={personas}
                onItems={setPersonas}
                suggestions={personaSuggestions}
                asked={personasAsked}
                emptyReason={personasEmptyReason}
                suggesting={suggestingPersonas}
                runStages={personaRun?.stages ?? DEFAULT_RUN_STAGES}
                runCost={personaRun?.costUsd}
                runCap={personaRun?.costCapUsd}
                onSuggest={() => void runSuggest('personas')}
                onDismiss={dismissPersona}
              />
            </Col>
          </Row>
        ) : step === 3 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={16}>
              <DraftedStep
                suggestLabel="Suggest metrics (LLM)"
                suggestedLabel="Suggested metrics"
                addLabel="Add metric"
                namePlaceholder="Metric name — e.g. Maintenance cost per unit"
                descriptionPlaceholder="How it is measured — e.g. spend over units in service"
                listLabel="Metrics these answers report against"
                listEmptyText="No metrics yet — add one above, or use Suggest metrics (LLM)."
                hint={
                  <div className="ng-hint">
                    <span aria-hidden="true">✦</span>
                    <span>
                      A metric here is what an answer reports against — the graph has
                      to be able to compute it from the sources you pick next, and the
                      hero questions you write next are asked against these.
                    </span>
                  </div>
                }
                items={metrics}
                onItems={setMetrics}
                suggestions={metricSuggestions}
                asked={metricsAsked}
                emptyReason={metricsEmptyReason}
                suggesting={suggestingMetrics}
                runStages={metricRun?.stages ?? DEFAULT_RUN_STAGES}
                runCost={metricRun?.costUsd}
                runCap={metricRun?.costCapUsd}
                onSuggest={() => void runSuggest('metrics')}
                onDismiss={dismissMetric}
                onEdit={editMetric}
              />
            </Col>
          </Row>
        ) : step === 4 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <SourcesStep
                sources={graphSources}
                loading={sourcesLoading}
                picks={sourcePicks}
                onPicks={setSourcePicks}
              />
            </Col>
          </Row>
        ) : step === 5 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <HeroQuestionsStep
                questions={heroQuestions}
                onQuestions={setHeroQuestions}
                suggestions={questionSuggestions}
                asked={questionsAsked}
                emptyReason={questionsEmptyReason}
                suggesting={suggestingQuestions}
                runStages={questionRun?.stages ?? DEFAULT_RUN_STAGES}
                runCost={questionRun?.costUsd}
                runCap={questionRun?.costCapUsd}
                onSuggest={() => void runSuggest('questions')}
                onDismiss={dismissQuestion}
              />
            </Col>
          </Row>
        ) : (
          <div className="ng-todo">
            <strong>
              Step {step} · {stepLabel}
            </strong>
            <div style={{ marginTop: SP.sm }}>
              This step will collect {STEP_INTENT[stepLabel] ?? 'its answers'}. The
              screen is not designed yet — the stepper and the draft work, so
              everything answered so far is saved and re-openable from the list above.
            </div>
          </div>
        )}

        <div className="ng-foot">
          {/* Left is for leaving the wizard, not for moving in it. Replaced "Start a new
              one" with the attachment control on request — the same client-side list the
              business-need field's own Upload button feeds, so a document picked from
              either spot lands in one list rather than two disconnected ones. */}
          {step === 1 ? (
            <Flex align="center" gap={SP.sm} wrap>
              <Upload
                multiple
                showUploadList={false}
                beforeUpload={(file) => {
                  setAttachedFiles((prev) =>
                    prev.includes(file.name) ? prev : [...prev, file.name],
                  )
                  return Upload.LIST_IGNORE
                }}
              >
                <Button icon={<UploadOutlined />}>Upload documents</Button>
              </Upload>
              {attachedFiles.map((fileName) => (
                <Tag
                  key={fileName}
                  closable
                  onClose={() =>
                    setAttachedFiles((prev) => prev.filter((f) => f !== fileName))
                  }
                >
                  {fileName}
                </Tag>
              ))}
            </Flex>
          ) : (
            <span />
          )}

          <Space size={SP.sm}>
            {step > 1 ? (
              <Button onClick={() => setStep(step - 1)}>← Back</Button>
            ) : null}
            {step < stepTotal ? (
              <Button type="primary" loading={saving} onClick={() => void next()}>
                Next <ArrowRightOutlined />
              </Button>
            ) : (
              <>
                <Button loading={saving} onClick={() => void saveDraft()}>
                  Save Only
                </Button>
                {/* Read from the same place as every other step's rule. On the last step that
                    rule is "add at least one hero question" — they are the contract the graph is
                    built against, so there is nothing to build without one. */}
                <Button
                  type="primary"
                  loading={saving}
                  disabled={stepIssue(LAST_STEP, draft) !== null}
                  onClick={() => void buildGraph()}
                >
                  Save &amp; build graph <ArrowRightOutlined />
                </Button>
              </>
            )}
          </Space>
        </div>
      </div>


      <Flex justify="flex-end" style={{ marginTop: SP.md }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {data?.draftCount ?? 0} draft(s) · {data?.committedCount ?? 0} committed ·{' '}
          {domainsData?.connectedSources ?? 0} connected source(s) backing the domain
          ranking
        </Typography.Text>
      </Flex>
    </>
  )
}
