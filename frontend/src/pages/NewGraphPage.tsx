import {
  ArrowRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
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
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  GapChoice,
  DraftedItem,
  GraphUseCase,
  HeroQuestion,
  SourcePick,
} from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import CoverageStep from '../components/graph/CoverageStep'
import RuntimeBuildDialog from '../components/graph/RuntimeBuildDialog'
import { LlmRunPanel } from '../components/graph/LlmRun'
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
  useKpiSuggestStore,
  usePersonaSuggestStore,
  useQuestionSuggestStore,
  useUseCasesStore,
} from '../store/graphStore'
import {
  firstIncompleteStep,
  stepIssue,
  type WizardDraft,
} from '../data/wizardSteps'
import { isRuntimeAnswered } from '../data/runtimeBuild'
import { selectAskGraphs, useAskStore } from '../store/askStore'
import { SP } from '../theme'
import './NewGraphPage.css'

import { appPath } from '../api/dataset'

/*
 * The last step — the coverage review, and the build gate.
 *
 * It is a constant rather than a literal 7 because the count changed once already:
 * 'Answer requirements' was step 6 and is gone (citations and the render format are
 * chosen per question on Ask now), so 'Entities & relationships' moved down one. The
 * server's `WIZARD_STEPS` is the real list and `stepTotal` reads it; this is the
 * fallback and the number the review's own effects key on.
 */
const LAST_STEP = 6

/*
 * What each step after Domain will collect. Step 1 is built; the rest are
 * placeholders so the stepper is navigable and a draft can be saved from any
 * step without losing the answers already given.
 */
const STEP_INTENT: Record<string, string> = {
  Personas: 'who asks these questions, and what they already know',
  KPIs: 'the measures the graph has to be able to compute',
  Sources: 'which connected sources may feed this graph',
  'Hero questions': 'the handful of questions this graph exists to answer',
  'Answer requirements': 'how precise, how fresh, and how explainable an answer must be',
  'Entities & relationships': 'the entities the AI derived — yours to confirm, not to type',
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
  const suggestPersonaList = usePersonaSuggestStore((s) => s.suggest)
  const dismissPersona = usePersonaSuggestStore((s) => s.dismiss)
  const personaRun = usePersonaSuggestStore((s) => s.run)
  const resetPersonaSuggestions = usePersonaSuggestStore((s) => s.reset)

  const sourcesData = useGraphSourcesStore((s) => s.data)
  const sourcesLoading = useGraphSourcesStore((s) => s.loading)
  const loadGraphSources = useGraphSourcesStore((s) => s.load)

  const derivation = useDerivationStore((s) => s.run)
  /* Starting the build is the wizard's last act — and for a runtime-answered graph it is
     also the publish, so the wizard watches that one to the end rather than handing it to
     the studio. Every other graph is the studio's the moment the run starts. */
  const startBuild = useGraphBuildStore((s) => s.start)
  const buildRun = useGraphBuildStore((s) => s.shown)
  const pollBuild = useGraphBuildStore((s) => s.poll)
  const startingDerivation = useDerivationStore((s) => s.starting)
  const startDerivationRun = useDerivationStore((s) => s.start)
  const pollDerivation = useDerivationStore((s) => s.poll)
  const resetDerivation = useDerivationStore((s) => s.reset)

  const coverage = useCoverageStore((s) => s.data)
  const coverageLoading = useCoverageStore((s) => s.loading)
  const reviewCoverageNow = useCoverageStore((s) => s.review)
  const resetCoverage = useCoverageStore((s) => s.reset)

  const questionSuggestions = useQuestionSuggestStore((s) => s.suggestions)
  const suggestingQuestions = useQuestionSuggestStore((s) => s.suggesting)
  const questionsAsked = useQuestionSuggestStore((s) => s.asked)
  const suggestQuestionList = useQuestionSuggestStore((s) => s.suggest)
  const dismissQuestion = useQuestionSuggestStore((s) => s.dismiss)
  const questionRun = useQuestionSuggestStore((s) => s.run)
  const resetQuestionSuggestions = useQuestionSuggestStore((s) => s.reset)

  const kpiSuggestions = useKpiSuggestStore((s) => s.suggestions)
  const suggestingKpis = useKpiSuggestStore((s) => s.suggesting)
  const kpisAsked = useKpiSuggestStore((s) => s.asked)
  const suggestKpiList = useKpiSuggestStore((s) => s.suggest)
  const dismissKpi = useKpiSuggestStore((s) => s.dismiss)
  const kpiRun = useKpiSuggestStore((s) => s.run)
  const resetKpiSuggestions = useKpiSuggestStore((s) => s.reset)

  // The draft being edited. `useCaseId` is null until it has been saved once.
  const [useCaseId, setUseCaseId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [domainId, setDomainId] = useState<string | null>(null)
  const [businessNeed, setBusinessNeed] = useState('')
  const [personas, setPersonas] = useState<DraftedItem[]>([])
  const [kpis, setKpis] = useState<DraftedItem[]>([])
  const [sourcePicks, setSourcePicks] = useState<SourcePick[]>([])
  const [heroQuestions, setHeroQuestions] = useState<HeroQuestion[]>([])
  const [gapDecisions, setGapDecisions] = useState<GapChoice[]>([])
  const [step, setStep] = useState(1)
  // How far this draft has been taken. Steps past it are locked, so the stepper
  // cannot skip a step's validation. Restored from the draft on open.
  const [maxStep, setMaxStep] = useState(1)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  /*
   * The hand-off for a graph that publishes itself: the id it is watching, and whether Ask
   * has been re-read since the run landed. Held here rather than in the dialog because the
   * poll and the re-read are the page's, and a dialog that owned them would keep running
   * after it closed.
   */
  const [handoffId, setHandoffId] = useState<string | null>(null)
  const [checkingAsk, setCheckingAsk] = useState(false)

  const loadAskGraphs = useAskStore((s) => s.load)
  const askGraphs = useAskStore(selectAskGraphs)

  useEffect(() => {
    void load()
    void loadDomains()
    void loadGraphSources()
  }, [load, loadDomains, loadGraphSources])

  /*
   * The last step shows whatever the derivation produced. Arriving without one — by
   * clicking the stepper rather than generating a brief — reviews directly, so
   * the step is never empty just because the run was not started here.
   */
  useEffect(() => {
    if (step !== LAST_STEP || derivation) return
    void reviewCoverageNow({ name, sources: sourcePicks, heroQuestions })
  }, [step, derivation, name, sourcePicks, heroQuestions, reviewCoverageNow])

  // Poll only while a run is in flight; the poll that sees it land stops.
  useEffect(() => {
    if (derivation?.status !== 'running') return
    const id = window.setInterval(() => void pollDerivation(), 700)
    return () => window.clearInterval(id)
  }, [derivation?.status, pollDerivation])

  /*
   * The hand-off's two effects, and they are the studio's own pattern rather than a second
   * one: poll only while the run is in flight, and stop on the poll that sees it land.
   */
  useEffect(() => {
    if (!handoffId || buildRun?.status !== 'running') return
    const id = window.setInterval(() => void pollBuild(), 350)
    return () => window.clearInterval(id)
  }, [handoffId, buildRun?.status, pollBuild])

  /*
   * **The publication is read back, never assumed.** The server publishes a runtime-answered
   * graph when its build lands, so the honest thing for this dialog to say is what `GET /ask`
   * answers — a build that finished and a graph that is live are two facts, and only one of
   * them is this run's to report. Keyed on the build id so it re-reads once per run.
   */
  const checkedForBuild = useRef<string | null>(null)
  useEffect(() => {
    if (!handoffId || buildRun?.status !== 'complete') return
    if (checkedForBuild.current === buildRun.buildId) return
    checkedForBuild.current = buildRun.buildId
    setCheckingAsk(true)
    void loadAskGraphs().finally(() => setCheckingAsk(false))
  }, [handoffId, buildRun?.status, buildRun?.buildId, loadAskGraphs])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const stepTotal = steps.length || LAST_STEP
  const stepLabel = steps[step - 1] ?? ''
  const domains = domainsData?.domains ?? []
  const graphSources = sourcesData?.sources ?? []

  /*
   * The review's answer comes from the derivation when one ran, and from a direct
   * review when the user jumped here via the stepper. Both the panel and the
   * build gate must read the *same* one — reading different sources is how the
   * button ended up permanently disabled.
   */
  const activeCoverage = derivation?.coverage ?? coverage

  /** What `stepIssue` judges every step on. */
  const draft: WizardDraft = {
    name,
    domainId,
    personas,
    kpis,
    graphSources,
    sourcePicks,
    heroQuestions,
    coverage: activeCoverage,
    gapDecisions,
  }

  function openUseCase(u: GraphUseCase) {
    setUseCaseId(u.useCaseId)
    setName(u.name)
    setDomainId(u.domainId)
    setBusinessNeed(u.businessNeed)
    setPersonas(u.personas)
    setKpis(u.kpis)
    setSourcePicks(u.sources)
    setHeroQuestions(u.heroQuestions)
    setGapDecisions(u.gapDecisions)
    setStep(u.step)
    // A saved draft already cleared every step before the one it stopped on.
    setMaxStep(u.step)
    setSavedAt(u.updatedAt)
    // Suggestions belong to the brief that produced them.
    resetPersonaSuggestions()
    resetKpiSuggestions()
    resetQuestionSuggestions()
    resetCoverage()
    resetDerivation()
    message.success(`Opened ${u.name} at step ${u.step} of ${u.stepTotal}.`)
  }

  /** Steps 2 and 3 both draft from the domain and the brief. */
  async function runSuggest(what: 'personas' | 'kpis' | 'questions') {
    const ask =
      what === 'kpis'
        ? suggestKpiList
        : what === 'questions'
          ? suggestQuestionList
          : suggestPersonaList
    const result = await ask({ domainId, businessNeed })
    if (!result.ok) message.error(result.error)
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
    setPersonas([])
    setKpis([])
    setSourcePicks([])
    setHeroQuestions([])
    setGapDecisions([])
    setStep(1)
    setMaxStep(1)
    setSavedAt(null)
    resetPersonaSuggestions()
    resetKpiSuggestions()
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
      kpis,
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
      kpis,
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
     * **Where the click lands is decided by whether this graph publishes itself.**
     *
     * A runtime-answered brief has nothing for a reviewer to settle — its sources are read
     * at question time and put nothing on the canvas, which is what the review queue and the
     * pivot decide — so the server publishes the version the build produces. Routing that
     * reader through Graph Studio would send them to a screen whose one remaining act has
     * already happened; the wizard watches the run instead and hands them to Ask.
     *
     * Every other graph is unchanged: the studio owns the pipeline, because a graph is built
     * more than once and rebuilding lives where reviewing does.
     */
    if (isRuntimeAnswered(graphSources, sourcePicks)) {
      setHandoffId(result.useCase.useCaseId)
      return
    }

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

    /*
     * Leaving the hero questions is where the answers are handed to the derivation. It
     * runs async, so the step advances immediately and the review shows it working.
     */
    if (step === LAST_STEP - 1) {
      const started = await startDerivationRun({
        name,
        sources: sourcePicks,
        heroQuestions,
      })
      if (!started.ok) {
        message.error(started.error)
        return
      }
      // A fresh derivation supersedes any decisions made against the old one.
      setGapDecisions([])
    }
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
                  You can also drop documents here (strategy memos, KPI definitions) —
                  the AI folds them into the brief.
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
                suggestLabel="Suggest KPIs (LLM)"
                suggestedLabel="Suggested KPIs"
                addLabel="Add KPI"
                namePlaceholder="KPI name — e.g. Maintenance cost per unit"
                descriptionPlaceholder="How it is measured — e.g. spend over units in service"
                listLabel="KPIs these answers report against"
                listEmptyText="No KPIs yet — add one above, or use Suggest KPIs (LLM)."
                hint={
                  <div className="ng-hint">
                    <span aria-hidden="true">✦</span>
                    <span>
                      A KPI here is what an answer reports against — the graph has to
                      be able to compute it from the sources you pick next.
                    </span>
                  </div>
                }
                items={kpis}
                onItems={setKpis}
                suggestions={kpiSuggestions}
                asked={kpisAsked}
                suggesting={suggestingKpis}
                runStages={kpiRun?.stages ?? DEFAULT_RUN_STAGES}
                runCost={kpiRun?.costUsd}
                runCap={kpiRun?.costCapUsd}
                onSuggest={() => void runSuggest('kpis')}
                onDismiss={dismissKpi}
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
                suggesting={suggestingQuestions}
                runStages={questionRun?.stages ?? DEFAULT_RUN_STAGES}
                runCost={questionRun?.costUsd}
                runCap={questionRun?.costCapUsd}
                onSuggest={() => void runSuggest('questions')}
                onDismiss={dismissQuestion}
              />
            </Col>
          </Row>
        ) : step === LAST_STEP ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              {derivation && derivation.status === 'running' ? (
                <LlmRunPanel run={derivation} />
              ) : (
                <CoverageStep
                  data={activeCoverage}
                  loading={coverageLoading || startingDerivation}
                  decisions={gapDecisions}
                  onDecisions={setGapDecisions}
                />
              )}
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
          {/* Left is for leaving the wizard, not for moving in it — so only
              "Start a new one" sits here. Back travels with Next on the right,
              where the hand already is. */}
          {step === 1 && useCaseId ? (
            <Button icon={<PlusOutlined />} onClick={startNew}>
              Start a new one
            </Button>
          ) : (
            <span />
          )}

          <Space size={SP.sm}>
            {step > 1 ? (
              <Button onClick={() => setStep(step - 1)}>← Back</Button>
            ) : null}
            {step < stepTotal ? (
              <Button type="primary" loading={saving} onClick={() => void next()}>
                {/* The last answered step produces the brief the AI derives the
                    review from, so it says what it does rather than "Next". */}
                {step === LAST_STEP - 1 ? 'Generate use-case brief' : 'Next'}{' '}
                <ArrowRightOutlined />
              </Button>
            ) : (
              <>
                <Button loading={saving} onClick={() => void saveDraft()}>
                  Save Only
                </Button>
                {/* Building is blocked until every gap has been decided — an
                    undecided gap is a question the graph cannot answer. The last
                    step's rule, read from the same place as every other step's. */}
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

      {/* Rendered from `handoffId` rather than a boolean, so the dialog cannot outlive
          the run it is watching: closing clears the id and the poll stops with it. */}
      <RuntimeBuildDialog
        open={handoffId !== null}
        run={buildRun}
        published={askGraphs.find((g) => g.useCaseId === handoffId) ?? null}
        checking={checkingAsk}
        onAsk={() => navigate(appPath('/ask'))}
        onClose={() => setHandoffId(null)}
      />

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
