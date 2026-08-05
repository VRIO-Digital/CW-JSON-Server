import {
  ArrowRightOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
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
import { useEffect, useMemo, useState } from 'react'
import type {
  AnswerFormat,
  Citations,
  GapChoice,
  DraftedItem,
  GraphUseCase,
  HeroQuestion,
  SourcePick,
} from '../api/client'
import AnswerRequirementsStep from '../components/AnswerRequirementsStep'
import ApiErrorAlert from '../components/ApiErrorAlert'
import CoverageStep from '../components/CoverageStep'
import DraftedStep from '../components/DraftedStep'
import HeroQuestionsStep from '../components/HeroQuestionsStep'
import SourcesStep from '../components/SourcesStep'
import PageHeader from '../components/PageHeader'
import StatusTag from '../components/StatusTag'
import {
  selectUseCases,
  useAnswerFormatStore,
  useCoverageStore,
  useGraphDomainsStore,
  useGraphSourcesStore,
  useKpiSuggestStore,
  usePersonaSuggestStore,
  useQuestionSuggestStore,
  useUseCasesStore,
} from '../store/graphStore'
import { coverageIsDecided } from '../data/coverage'
import { SP } from '../theme'
import './NewGraphPage.css'

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

const formatUpdated = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'not saved yet'

function SavedUseCases({
  useCases,
  count,
  pending,
  onOpen,
  onDelete,
}: {
  useCases: GraphUseCase[]
  count: number
  pending: string | null
  onOpen: (useCase: GraphUseCase) => void
  onDelete: (useCase: GraphUseCase) => void
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
  const resetPersonaSuggestions = usePersonaSuggestStore((s) => s.reset)

  const sourcesData = useGraphSourcesStore((s) => s.data)
  const sourcesLoading = useGraphSourcesStore((s) => s.loading)
  const loadGraphSources = useGraphSourcesStore((s) => s.load)

  const coverage = useCoverageStore((s) => s.data)
  const coverageLoading = useCoverageStore((s) => s.loading)
  const reviewCoverageNow = useCoverageStore((s) => s.review)
  const resetCoverage = useCoverageStore((s) => s.reset)

  const answerFormats = useAnswerFormatStore((s) => s.suggestions)
  const formatsLoading = useAnswerFormatStore((s) => s.suggesting)
  const loadAnswerFormats = useAnswerFormatStore((s) => s.suggest)
  const resetAnswerFormats = useAnswerFormatStore((s) => s.reset)

  const questionSuggestions = useQuestionSuggestStore((s) => s.suggestions)
  const suggestingQuestions = useQuestionSuggestStore((s) => s.suggesting)
  const questionsAsked = useQuestionSuggestStore((s) => s.asked)
  const suggestQuestionList = useQuestionSuggestStore((s) => s.suggest)
  const dismissQuestion = useQuestionSuggestStore((s) => s.dismiss)
  const resetQuestionSuggestions = useQuestionSuggestStore((s) => s.reset)

  const kpiSuggestions = useKpiSuggestStore((s) => s.suggestions)
  const suggestingKpis = useKpiSuggestStore((s) => s.suggesting)
  const kpisAsked = useKpiSuggestStore((s) => s.asked)
  const suggestKpiList = useKpiSuggestStore((s) => s.suggest)
  const dismissKpi = useKpiSuggestStore((s) => s.dismiss)
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
  const [citations, setCitations] = useState<Citations>('required')
  const [selectedFormats, setSelectedFormats] = useState<AnswerFormat[]>([])
  const [gapDecisions, setGapDecisions] = useState<GapChoice[]>([])
  const [step, setStep] = useState(1)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    void load()
    void loadDomains()
    void loadGraphSources()
  }, [load, loadDomains, loadGraphSources])

  /*
   * Step 6 offers a choice between question types rather than accumulating them,
   * so its formats load on arrival instead of behind a "Suggest" button.
   */
  useEffect(() => {
    if (step !== 6) return
    void loadAnswerFormats({ domainId, businessNeed })
  }, [step, domainId, businessNeed, loadAnswerFormats])

  /*
   * Step 7 re-derives on arrival rather than caching: changing a source pick on
   * step 4 has to change what the review says it found.
   */
  useEffect(() => {
    if (step !== 7) return
    void reviewCoverageNow({ name, sources: sourcePicks, heroQuestions })
  }, [step, name, sourcePicks, heroQuestions, reviewCoverageNow])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const stepLabel = steps[step - 1] ?? ''
  const domains = domainsData?.domains ?? []
  const graphSources = sourcesData?.sources ?? []

  function openUseCase(u: GraphUseCase) {
    setUseCaseId(u.useCaseId)
    setName(u.name)
    setDomainId(u.domainId)
    setBusinessNeed(u.businessNeed)
    setPersonas(u.personas)
    setKpis(u.kpis)
    setSourcePicks(u.sources)
    setHeroQuestions(u.heroQuestions)
    setCitations(u.citations)
    setSelectedFormats(u.answerFormats)
    setGapDecisions(u.gapDecisions)
    setStep(u.step)
    setSavedAt(u.updatedAt)
    // Suggestions belong to the brief that produced them.
    resetPersonaSuggestions()
    resetKpiSuggestions()
    resetQuestionSuggestions()
    resetAnswerFormats()
    resetCoverage()
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
    setCitations('required')
    setSelectedFormats([])
    setGapDecisions([])
    setStep(1)
    setSavedAt(null)
    resetPersonaSuggestions()
    resetKpiSuggestions()
    resetQuestionSuggestions()
    resetAnswerFormats()
    resetCoverage()
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
      citations,
      answerFormats: selectedFormats,
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

  /** Step 7's primary action: commit the use case as ready to build. */
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
      citations,
      answerFormats: selectedFormats,
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
    message.success('Committed — ready to build.')
  }

  async function next() {
    if (step === 1) {
      if (!name.trim()) {
        message.warning('Name the use case — it is what your drafts list shows.')
        return
      }
      if (!domainId) {
        message.warning('Pick a business domain before continuing.')
        return
      }
    }
    /*
     * Step 4 is the one step that cannot be answered with nothing: every later
     * step derives from the data selected here, so advancing empty would build a
     * graph over no data at all. The three cases need three different fixes.
     */
    if (step === 4) {
      if (graphSources.length === 0) {
        message.warning(
          'Connect a data source on Sources first — there is nothing to select here yet.',
        )
        return
      }
      if (!graphSources.some((s) => s.objectCount > 0)) {
        message.warning(
          'Nothing is profiled yet — profile a source in the Data Catalogue before continuing.',
        )
        return
      }
      if (sourcePicks.length === 0) {
        message.warning(
          'Select at least one source — the graph can only derive from data you point it at.',
        )
        return
      }
      const emptyPick = sourcePicks.find(
        (p) => p.mode === 'subset' && p.objects.length === 0,
      )
      if (emptyPick) {
        const source = graphSources.find((s) => s.sourceId === emptyPick.sourceId)
        message.warning(
          `Pick at least one ${source?.unitLabel.replace(/s$/, '') ?? 'table'} for ${emptyPick.sourceId}, or switch it back to all profiled ${source?.unitLabel ?? 'tables'}.`,
        )
        return
      }
    }
    const nextStep = Math.min(step + 1, steps.length || 7)
    // Advancing is a save point, so a reload never loses the last answer.
    if (await saveDraft(nextStep)) setStep(nextStep)
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
        Step {step} of {steps.length || 7}
        {stepLabel ? ` · ${stepLabel}` : ''} — your answers stay editable; save the
        draft any time.
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
        />
      )}

      <div className="ng-steps">
        {steps.map((label, i) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: SP.sm }}>
            {i > 0 ? <span className="ng-step-dash" /> : null}
            <button
              type="button"
              className={`ng-step${i + 1 === step ? ' is-active' : i + 1 < step ? ' is-done' : ''}`}
              onClick={() => setStep(i + 1)}
              aria-current={i + 1 === step ? 'step' : undefined}
            >
              <span className="ng-step-num">{i + 1}</span>
              {label}
            </button>
          </span>
        ))}
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
                onSuggest={() => void runSuggest('questions')}
                onDismiss={dismissQuestion}
              />
            </Col>
          </Row>
        ) : step === 6 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <AnswerRequirementsStep
                citations={citations}
                onCitations={setCitations}
                formats={answerFormats}
                loading={formatsLoading}
                selected={selectedFormats}
                onSelected={setSelectedFormats}
              />
            </Col>
          </Row>
        ) : step === 7 ? (
          <Row gutter={[SP.lg, SP.lg]}>
            <Col xs={24} xl={18}>
              <CoverageStep
                data={coverage}
                loading={coverageLoading}
                decisions={gapDecisions}
                onDecisions={setGapDecisions}
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
          {step > 1 ? (
            <Button onClick={() => setStep(step - 1)}>← Back</Button>
          ) : useCaseId ? (
            // Only offered once a draft is loaded — otherwise the form already
            // is the new one, as the card above says.
            <Button icon={<PlusOutlined />} onClick={startNew}>
              Start a new one
            </Button>
          ) : (
            <span />
          )}
          {step < (steps.length || 7) ? (
            <Button type="primary" loading={saving} onClick={() => void next()}>
              {/* The last answered step produces the brief the AI derives step 7
                  from, so it says what it does rather than "Next". */}
              {step === 6 ? 'Generate use-case brief' : 'Next'}{' '}
              <ArrowRightOutlined />
            </Button>
          ) : (
            <Space size={SP.sm}>
              <Button loading={saving} onClick={() => void saveDraft()}>
                Save Only
              </Button>
              {/* Building is blocked until every gap has been decided — an
                  undecided gap is a question the graph cannot answer. */}
              <Button
                type="primary"
                loading={saving}
                disabled={!coverageIsDecided(coverage, gapDecisions)}
                onClick={() => void buildGraph()}
              >
                Save &amp; build graph <ArrowRightOutlined />
              </Button>
            </Space>
          )}
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
