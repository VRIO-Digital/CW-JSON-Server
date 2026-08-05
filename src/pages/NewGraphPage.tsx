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
import type { GraphUseCase } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import PageHeader from '../components/PageHeader'
import StatusTag from '../components/StatusTag'
import {
  selectUseCases,
  useGraphDomainsStore,
  useUseCasesStore,
} from '../store/graphStore'
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

  // The draft being edited. `useCaseId` is null until it has been saved once.
  const [useCaseId, setUseCaseId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [domainId, setDomainId] = useState<string | null>(null)
  const [businessNeed, setBusinessNeed] = useState('')
  const [step, setStep] = useState(1)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    void load()
    void loadDomains()
  }, [load, loadDomains])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const stepLabel = steps[step - 1] ?? ''
  const domains = domainsData?.domains ?? []

  function openUseCase(u: GraphUseCase) {
    setUseCaseId(u.useCaseId)
    setName(u.name)
    setDomainId(u.domainId)
    setBusinessNeed(u.businessNeed)
    setStep(u.step)
    setSavedAt(u.updatedAt)
    message.success(`Opened ${u.name} at step ${u.step} of ${u.stepTotal}.`)
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
    setStep(1)
    setSavedAt(null)
  }

  async function saveDraft(nextStep = step) {
    const result = await save({
      useCaseId,
      name,
      domainId,
      businessNeed,
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
          ) : (
            <Button icon={<PlusOutlined />} onClick={startNew} disabled={!useCaseId && !name}>
              Start a new one
            </Button>
          )}
          {step < (steps.length || 7) ? (
            <Button type="primary" loading={saving} onClick={() => void next()}>
              Next <ArrowRightOutlined />
            </Button>
          ) : (
            <Button
              type="primary"
              loading={saving}
              onClick={() =>
                void save({
                  useCaseId,
                  name,
                  domainId,
                  businessNeed,
                  step,
                  status: 'committed',
                }).then((result) => {
                  if (!result.ok) {
                    message.error(result.error)
                    return
                  }
                  setUseCaseId(result.useCase.useCaseId)
                  setSavedAt(result.useCase.updatedAt)
                  message.success('Committed — ready to build.')
                })
              }
            >
              Commit — ready to build
            </Button>
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
