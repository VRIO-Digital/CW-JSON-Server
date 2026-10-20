import {
  ArrowRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LockOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Col,
  Collapse,
  Flex,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
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
import { useStudioStore } from '../store/studioStore'
import DraftedStep from '../components/graph/DraftedStep'
import FoundInDocuments from '../components/graph/FoundInDocuments'
import HeroQuestionsStep from '../components/graph/HeroQuestionsStep'
import ResponsibilitiesStep from '../components/graph/ResponsibilitiesStep'
import RoleStep from '../components/graph/RoleStep'
import { useRoleDraft } from '../components/graph/useRoleDraft'
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
  documentMetrics,
  foundMetricsCopy,
  metricFoundItems,
} from '../data/documentReadings'
import { domainForRole } from '../data/roleBrief'
import { questionSql as questionSqlRequest } from '../api/client'
import { toMessage } from '../store/asyncState'
import {
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
const LAST_STEP = 6

/** Documents the wizard no longer attaches — a module constant so the derived measures below keep a stable input. */
const attachedFiles: string[] = []

/*
 * What each step after Role will collect. Steps 1 and 2 are built; the rest are
 * placeholders so the stepper is navigable and a draft can be saved from any
 * step without losing the answers already given.
 */
const STEP_INTENT: Record<string, string> = {
  Responsibilities: 'what the role owns, and the tasks under each',
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
                      placement="topRight"
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

  /*
   * Committing is the wizard's last act; **building is the studio's**, for every graph — so this
   * page points the studio's selector at the brief it just committed and navigates, and nothing here
   * starts a run. It used to, which handed a reader a pipeline already going over an empty story
   * box: the one input a build takes, asked for on the screen they had just been taken past.
   *
   * `select` and not `build`, therefore. A binding to `build` left behind would be an invitation for
   * the run to come back here, which `noUnusedLocals` would not catch if anything still read it.
   */
  const selectStudioUseCase = useStudioStore((s) => s.select)
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
   * **Step 1 no longer attaches documents.** It asked for a free-text business need and took
   * uploads to fold into it; a role defines its own brief now (the business need is composed from the
   * role, its places and its responsibilities), and the one upload left — a job description — lives
   * on Responsibilities, where it changes the responsibilities rather than a paragraph. So nothing
   * here reads a document, and the measures a document defines (below) are an empty list.
   */
  /* The role, its industry and utilities, and what it is responsible for — steps 1 and 2. */
  const roleDraft = useRoleDraft()
  /* The reader's own name for the use case, until they type one the role's default stops filling in. */
  const [nameTouched, setNameTouched] = useState(false)
  /*
   * The measures those documents define, and the ones a reader has turned down.
   *
   * Rejections are kept by id rather than by filtering a stored list, because the list is derived:
   * a document removed and re-attached comes back as itself, and a row rejected stays rejected
   * only for as long as this draft is open. Nothing is saved either way — a rejection is a
   * decision about a suggestion nobody has accepted, which is the asymmetry the Data Modeling tab
   * already keeps between a suggestion and a declaration.
   */
  const [rejectedFoundIds, setRejectedFoundIds] = useState<string[]>([])
  const foundMetrics = useMemo(
    () => documentMetrics(attachedFiles).filter((m) => !rejectedFoundIds.includes(m.id)),
    [rejectedFoundIds],
  )
  /*
   * And the questions those same documents state — step 5's half of the one pass. A measure and
   * the question it answers are one authored row, so a question offered here is always one the
   * measures panel two steps back can account for.
   */
  const reject = (id: string) => setRejectedFoundIds((prev) => [...prev, id])
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

  /* The use case is called after the role until the reader names it themselves. */
  useEffect(() => {
    if (!nameTouched && roleDraft.defaultName) setName(roleDraft.defaultName)
  }, [nameTouched, roleDraft.defaultName])

  /* Every later step drafts from this, so it follows the responsibilities as they are edited. */
  useEffect(() => {
    if (roleDraft.businessNeed) setBusinessNeed(roleDraft.businessNeed)
  }, [roleDraft.businessNeed])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const stepTotal = steps.length || LAST_STEP
  const stepLabel = steps[step - 1] ?? ''
  const domains = domainsData?.domains ?? []

  /* The role settles the business domain (`domainForRole`): the one answer step 1 used to ask for. */
  useEffect(() => {
    if (!roleDraft.roleId || domains.length === 0) return
    const next = domainForRole(roleDraft.roleId, domains.map((d) => d.domainId))
    if (next && next !== domainId) setDomainId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleDraft.roleId, domains])
  const graphSources = sourcesData?.sources ?? []

  /** What `stepIssue` judges every step on. */
  const draft: WizardDraft = {
    name,
    domainId,
    roleId: roleDraft.roleId,
    industry: roleDraft.industry,
    utilitiesFound: roleDraft.utilitiesFound,
    utilities: roleDraft.utilities,
    reportsTo: roleDraft.reportsTo,
    responsibilitiesReady: roleDraft.ready,
    inScope: roleDraft.inScopeCount,
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
    roleDraft.hydrate(u.role)
    setNameTouched(true)
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
   * **Step 2's *used for* is not here, and that is deliberate.** It was a write on this page,
   * onto the registered source; the request never reached the server in the environment this runs
   * in, so on request it is kept in the browser instead — `SourcesStep` reads and writes it through
   * `src/data/mailUsedFor.ts`, with no round trip and nothing for this page to coordinate.
   */

  /*
   * Step 4's Edit — the one act on this page that writes the pool rather than the draft. The
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

  /*
   * Approving a measure an attached document defines: it joins the draft's metrics carrying the
   * document's own definition, so nothing is retyped and the list says what the document said.
   *
   * **`source: 'ai'` is the honest one of the two values there are.** A `DraftedItem` records
   * whether the list entry was drafted for the reader or typed by them, and this was drafted — by
   * the pass over the document rather than by the suggester, which is a distinction the tag has no
   * third value for. What makes the origin checkable is the row it came from, which stays on
   * screen above the list with the document named on it.
   *
   * The name check is `DraftedStep`'s own: approving a measure the reader has already added by
   * hand must not put a second copy of it in the list.
   */
  const metricIsIn = (name: string) =>
    metrics.some((i) => i.name.toLowerCase() === name.toLowerCase())

  function approveFoundMetric(id: string) {
    const m = foundMetrics.find((x) => x.id === id)
    if (!m || metricIsIn(m.name)) return
    setMetrics([...metrics, { name: m.name, description: m.description, source: 'ai' }])
    message.success(`Added ${m.name} to your metrics.`)
  }

  /**
   * Compose the query for one hero question, against this use case's own profiled tables.
   *
   * **Owned by the page**, for the reason every other ask here is: which use case is open, and which
   * tables its picks admit, is the page's to know — a step fetching for itself would be a second
   * answer to which draft is being edited.
   *
   * A draft with no id yet has nothing to compose against, and that is *said* rather than silently
   * returning an empty box: the reader would otherwise read "no SQL" as the schema having nothing,
   * when the cause is that nothing has been saved.
   */
  async function writeQuestionSql(question: string) {
    if (!useCaseId) {
      return {
        ok: false as const,
        error:
          'Save this draft first — a query is composed against the tables this use case picked, and ' +
          'an unsaved draft has not picked any yet.',
      }
    }
    try {
      return { ok: true as const, value: await questionSqlRequest({ useCaseId, question }) }
    } catch (error) {
      return { ok: false as const, error: toMessage(error) }
    }
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
    roleDraft.reset()
    setNameTouched(false)
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
      role: roleDraft.toBrief(),
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
      role: roleDraft.toBrief(),
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
     * **Committing pins the inputs; starting the run is the studio's act, not this one.**
     *
     * This button used to trigger the build too, so a reader arrived at a pipeline already a
     * second in — with the story box empty underneath it, which is the one input a build takes
     * and the one thing they had no chance to give. *Draft from my data model* and then *Build
     * graph* is the order the studio's own screen states, and a run started here skipped both.
     *
     * So the studio is opened on Build with **nothing running**: the lanes read `not started`,
     * the description is empty and waiting, and the same button that rebuilds is the button that
     * builds the first time. A graph is built more than once; there is no reason the first run
     * should live somewhere else.
     *
     * The store is still pointed at the use case just committed, so the studio opens already on
     * it rather than on whichever one the selector happened to hold.
     */
    selectStudioUseCase(result.useCase.useCaseId)

    message.success('Committed — build it in Graph Studio.')
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

      {/* The step list is the server's, so a server older than the Role and Responsibilities steps
          answers with five labels over a page that draws six steps — the stepper then names the
          wrong screen. Said plainly, because a stale server cannot warn about itself. */}
      {steps.length > 0 && steps.length !== LAST_STEP ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: SP.md }}
          title="The mock server is running an older version of this app"
          description={`It reports ${steps.length} wizard steps but this page has ${LAST_STEP} (Role, Responsibilities, Sources, Personas, Metrics, Hero questions). Restart it with npm run mock and reload — nothing you entered is lost.`}
        />
      ) : null}

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
          /*
           * Role, first — it replaced Domain. Which role this analyst plays, the industry it works in
           * and the utilities found in the connected data; the business domain follows from the role
           * rather than being asked for, and the free-text business need and its document upload are
           * gone with it (the brief is composed from the role and its responsibilities).
           */
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              {domainsError ? (
                <ApiErrorAlert error={domainsError} onRetry={() => void loadDomains()} />
              ) : null}
              <RoleStep
                draft={roleDraft}
                name={name}
                onName={(value) => {
                  setName(value)
                  setNameTouched(true)
                }}
              />
            </Col>
          </Row>
        ) : step === 2 ? (
          /* Responsibilities, new — what the role owns and the tasks under each. */
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <ResponsibilitiesStep draft={roleDraft} />
            </Col>
          </Row>
        ) : step === 3 ? (
          /*
           * Sources, third — moved here on request, so the data the graph draws on is settled
           * before the people who will ask of it. The branches are kept in the order a reader
           * meets them, rather than left at their old numbers with the chain reading 1, 3, 4, 2.
           *
           * Full width, not `xl={18}` — that width was sized for the populated list, and
           * left the empty state's own centered card sitting left-of-page-centre inside the
           * remaining 75%, rather than centered on the page a reader is actually looking at.
           * The connected-sources list reads fine at the full width too.
           */
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24}>
              <SourcesStep
                sources={graphSources}
                loading={sourcesLoading}
                picks={sourcePicks}
                onPicks={setSourcePicks}
              />
            </Col>
          </Row>
        ) : step === 4 ? (
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
        ) : step === 5 ? (
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
                      {/* "the sources you pick next" until Sources moved ahead of this
                          step — a hint pointing at a screen the reader has already been
                          through is the same fault as an instruction nobody can carry out. */}
                      A metric here is what an answer reports against — the graph has to
                      be able to compute it from the sources you picked, and the hero
                      questions you write next are asked against these.
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
                /* The measures the attached documents define. Passed on this step alone — the
                   personas call site declares no slot — and the panel draws nothing where
                   nothing is attached, so the heading cannot stand over an empty list. */
                found={
                  <FoundInDocuments
                    items={metricFoundItems(foundMetrics)}
                    copy={foundMetricsCopy}
                    /* Approved *is* being in the list below, read from it rather than held
                       beside it: removing a metric there puts its Approve back. */
                    approved={(id) => {
                      const m = foundMetrics.find((x) => x.id === id)
                      return m !== undefined && metricIsIn(m.name)
                    }}
                    onApprove={approveFoundMetric}
                    onReject={reject}
                  />
                }
              />
            </Col>
          </Row>
        ) : step === 6 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <HeroQuestionsStep
                questions={heroQuestions}
                onQuestions={setHeroQuestions}
                /*
                 * The query each question would be answered by, composed from this use case's own
                 * profiled tables. Asked here rather than in the step because which use case is open
                 * is the page's to know.
                 */
                onWriteSql={async (question) => {
                  const result = await writeQuestionSql(question)
                  /*
                   * A refusal is an answer, and it is handed back rather than thrown as a toast: it
                   * is a fact about *this* question, so the box it belongs to is where it says so.
                   * A toast outlives the row it is about and stacks one per question on a step where
                   * adding several in a row is the normal thing to do.
                   */
                  return result.ok ? result.value : { sql: null, reason: result.error }
                }}
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
          {/* Left is for leaving the wizard, not for moving in it — the document upload that sat here
              went with the business-need box; a job description is added on Responsibilities. */}
          <span />

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
