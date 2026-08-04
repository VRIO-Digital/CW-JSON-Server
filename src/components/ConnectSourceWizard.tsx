import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  GoogleOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Flex,
  Form,
  Input,
  Row,
  Select,
  Space,
  Steps,
  Typography,
} from 'antd'
import { useState } from 'react'
import {
  ApiError,
  oauthCallback,
  oauthStart,
  previewSource,
  registerGenericSource,
  registerSource,
  type GcpProject,
  type GoogleAccount,
  type PreviewResult,
  type RegisteredSource,
} from '../api/client'
import {
  AVAILABLE_CONNECTORS,
  VISION_CONNECTORS,
  type Connector,
  type ConnectorField,
} from '../data/connectors'
import { BRAND, BRAND_SOFT } from '../theme'
import './ConnectSourceModal.css'

type TestState = 'idle' | 'running' | 'passed'

const VISION_NOTE =
  'Data-dictionary upload and per-source sampling/cadence/PII policy are product ' +
  'vision, not built backend features yet — skipped here. Once a source is ' +
  'registered you’ll find its project and datasets in the Sources table and in ' +
  'the confirmation below.'

/** Dummy discovery result for the non-BigQuery connectors. */
const DISCOVERY: Record<string, string> = {
  gdrive: '3 folders · 486 documents · 12 file types',
}

function ConnectorCard({
  connector,
  selected,
  onSelect,
}: {
  connector: Connector
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Card
      hoverable
      onClick={onSelect}
      className={`connector-card${connector.available ? '' : ' is-vision'}`}
      styles={{ body: { padding: '14px 16px' } }}
      style={{
        height: '100%',
        borderColor: selected ? BRAND : undefined,
        background: selected ? BRAND_SOFT : undefined,
      }}
    >
      <Typography.Text
        strong
        style={{ display: 'block', color: selected ? BRAND : undefined }}
      >
        {connector.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {connector.blurb}
      </Typography.Text>
    </Card>
  )
}

function FieldInput({ field }: { field: ConnectorField }) {
  if (field.kind === 'select') {
    return (
      <Select
        mode={field.multiple ? 'multiple' : undefined}
        placeholder={field.multiple ? 'Any' : 'Select…'}
        options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
        allowClear
      />
    )
  }
  if (field.kind === 'secret') {
    return <Input placeholder={field.placeholder} prefix="🔒" />
  }
  return <Input placeholder={field.placeholder} />
}

export default function ConnectSourceWizard({
  onConnect,
  onRegistered,
  onCancel,
}: {
  /** Non-BigQuery connectors: registers a row and closes. Receives its name. */
  onConnect: (sourceName: string) => void
  /** BigQuery: registered against the dummy API; the dialog stays open. */
  onRegistered: (source: RegisteredSource) => void
  onCancel: () => void
}) {
  const { message } = App.useApp()
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Connector | null>(null)
  const [blocked, setBlocked] = useState<Connector | null>(null)
  const [test, setTest] = useState<TestState>('idle')
  const [form] = Form.useForm()

  // ---- BigQuery connection state ----
  const [sourceName, setSourceName] = useState('')
  const [account, setAccount] = useState<GoogleAccount | null>(null)
  const [projects, setProjects] = useState<GcpProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [credentialHandle, setCredentialHandle] = useState('')
  const [allowlistText, setAllowlistText] = useState('')
  const [busy, setBusy] = useState<'login' | 'preview' | 'finish' | null>(null)

  // ---- BigQuery test & finish state ----
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [registeredResult, setRegisteredResult] = useState<RegisteredSource | null>(null)

  const isBigQuery = selected?.key === 'bigquery'

  const fail = (err: unknown) =>
    message.error(err instanceof ApiError ? err.message : 'Unexpected error')

  function pick(connector: Connector) {
    if (connector.available) {
      setSelected(connector)
      setBlocked(null)
    } else {
      // Unavailable cards are not selectable — they explain themselves instead.
      setBlocked(connector)
      setSelected(null)
    }
  }

  async function loginWithGoogle() {
    setBusy('login')
    try {
      const start = await oauthStart()
      const result = await oauthCallback(start.state)
      setAccount(result.account)
      setProjects(result.projects)
      const first = result.projects[0]
      if (first) selectProject(first.project_id, result.projects)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  function selectProject(id: string, list = projects) {
    setProjectId(id)
    setCredentialHandle(list.find((p) => p.project_id === id)?.credential_handle ?? '')
    // A different project invalidates any previous discovery.
    setPreview(null)
    setChecked([])
    setRegisteredResult(null)
  }

  async function runPreview() {
    setBusy('preview')
    try {
      const result = await previewSource(projectId, credentialHandle)
      setPreview(result)
      const fromAllowlist = allowlistText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      // Blank allowlist auto-fills from everything Preview discovered.
      setChecked(
        fromAllowlist.length > 0
          ? fromAllowlist
          : result.datasets.map((d) => d.dataset_id),
      )
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  async function finishBigQuery() {
    if (checked.length === 0) {
      message.warning('Check at least one dataset before finishing.')
      return
    }
    setBusy('finish')
    try {
      const result = await registerSource({
        projectId,
        credentialHandle,
        datasets: checked,
        sourceName: sourceName || projectId,
      })
      setRegisteredResult(result)
      onRegistered(result)
      message.success(`Connected — registered ${result.source_id}`)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  async function next() {
    if (step === 0 && selected) {
      setStep(1)
      return
    }
    if (step === 1) {
      if (isBigQuery) {
        if (!projectId || !credentialHandle) {
          message.warning(
            'Sign in with Google, or supply a project ID and credential handle under Advanced.',
          )
          return
        }
        setStep(2)
        return
      }
      try {
        await form.validateFields()
        setStep(2)
      } catch {
        /* antd highlights the offending fields */
      }
    }
  }

  function runGenericTest() {
    setTest('running')
    window.setTimeout(() => setTest('passed'), 900)
  }

  async function finishGeneric() {
    if (!selected) return
    const values = form.getFieldsValue()
    const name = values.sourceName || selected.name
    setBusy('finish')
    try {
      await registerGenericSource({
        connector: selected.key,
        sourceName: name,
        typeLabel: selected.typeLabel,
        credentialRef: values.credentialRef,
      })
      onConnect(name)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Steps
        current={step}
        style={{ margin: '20px 0 22px' }}
        items={[
          { title: 'Connector' },
          { title: 'Connection' },
          { title: 'Test & Finish' },
        ]}
      />

      {/* ---------- Step 1: pick a connector ---------- */}
      {step === 0 ? (
        <>
          <Typography.Title level={5} style={{ marginBottom: 12 }}>
            Available now
          </Typography.Title>
          <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
            {AVAILABLE_CONNECTORS.map((c) => (
              <Col key={c.key} xs={24} sm={12} md={8}>
                <ConnectorCard
                  connector={c}
                  selected={selected?.key === c.key}
                  onSelect={() => pick(c)}
                />
              </Col>
            ))}
          </Row>

          <Row gutter={[12, 12]}>
            {VISION_CONNECTORS.map((c) => (
              <Col key={c.key} xs={24} sm={12} md={8}>
                <ConnectorCard
                  connector={c}
                  selected={blocked?.key === c.key}
                  onSelect={() => pick(c)}
                />
              </Col>
            ))}
          </Row>

          {blocked ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              title={`${blocked.name} is not available yet`}
              description={blocked.reason}
            />
          ) : null}
        </>
      ) : null}

      {/* ---------- Step 2: BigQuery connection ---------- */}
      {step === 1 && isBigQuery ? (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={VISION_NOTE} />
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="Click below to sign in with your own Google account and grant read-only BigQuery access — no key file to download or upload. Uses the GET /sources/oauth/start → Google consent → GET /sources/oauth/callback flow."
          />

          <Button
            type="primary"
            icon={<GoogleOutlined />}
            loading={busy === 'login'}
            onClick={loginWithGoogle}
            style={{ marginBottom: 16 }}
          >
            Login with Google
          </Button>

          {account ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              title={
                <span>
                  Connected as <strong>{account.email}</strong>
                </span>
              }
            />
          ) : null}

          <Form layout="vertical" requiredMark={false}>
            <Form.Item
              label="Source name"
              extra="How this source appears in the Sources table and the Data Catalogue."
            >
              <Input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="E-waste warehouse"
              />
            </Form.Item>

            {projects.length > 0 ? (
              <Form.Item label="GCP project">
                <Select
                  value={projectId || undefined}
                  onChange={(value) => selectProject(value)}
                  placeholder="Select a project"
                  options={projects.map((p) => ({
                    value: p.project_id,
                    label: `${p.project_id} — ${p.dataset_count} dataset(s) · ${p.location}`,
                  }))}
                />
              </Form.Item>
            ) : null}
          </Form>

          <Collapse
            style={{ marginBottom: 8 }}
            items={[
              {
                key: 'advanced',
                label: 'Advanced: enter a project and credential handle manually',
                children: (
                  <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="GCP project ID">
                      <Input
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        placeholder="my-gcp-project-id"
                      />
                    </Form.Item>

                    <Form.Item
                      label="Credential handle"
                      extra="Issued by the Google consent flow. There is no way to paste a raw key — ContextWeave only ever holds a reference."
                    >
                      <Input
                        value={credentialHandle}
                        onChange={(e) => setCredentialHandle(e.target.value)}
                        placeholder="cred-handle-…"
                      />
                    </Form.Item>

                    <Form.Item label="Dataset allowlist (comma-separated — optional for Preview, required for Finish)">
                      <Input
                        value={allowlistText}
                        onChange={(e) => setAllowlistText(e.target.value)}
                        placeholder="dataset_a, dataset_b — leave blank to auto-fill from Preview’s discovered datasets"
                      />
                    </Form.Item>

                    <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                      Credentials are held by reference only (credential_handle).
                      This calls POST /sources/preview and POST /sources.
                    </Typography.Text>
                  </Form>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {/* ---------- Step 2: every other connector ---------- */}
      {step === 1 && selected && !isBigQuery ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 20 }}
            title="Credentials are stored by reference only. Paste a pointer into your secret manager — ContextWeave never persists the secret itself."
          />
          <Form form={form} layout="vertical" requiredMark="optional">
            <Row gutter={16}>
              {selected.fields.map((field) => (
                <Col key={field.name} xs={24} md={12}>
                  <Form.Item
                    name={field.name}
                    label={field.label}
                    extra={field.help}
                    rules={
                      field.required
                        ? [{ required: true, message: `${field.label} is required` }]
                        : undefined
                    }
                  >
                    <FieldInput field={field} />
                  </Form.Item>
                </Col>
              ))}
            </Row>
          </Form>
        </>
      ) : null}

      {/* ---------- Step 3: BigQuery preview + finish ---------- */}
      {step === 2 && isBigQuery ? (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title={VISION_NOTE} />

          <Card size="small" style={{ marginBottom: 16 }}>
            <Button
              loading={busy === 'preview'}
              onClick={runPreview}
              style={{ marginBottom: preview ? 14 : 0 }}
            >
              1. Run preview
            </Button>

            {preview ? (
              <>
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title={`project ${preview.project_id} · discovered ${preview.dataset_count} dataset(s)`}
                />
                <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                  Dataset allowlist — check which datasets this source may profile
                </Typography.Text>
                <Checkbox.Group
                  value={checked}
                  onChange={(values) => setChecked(values as string[])}
                  options={preview.datasets.map((d) => ({
                    label: d.dataset_id,
                    value: d.dataset_id,
                  }))}
                />
              </>
            ) : null}
          </Card>

          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Discovers the datasets visible to this credential handle without
            registering anything yet.
          </Typography.Text>

          <Card size="small" style={{ marginTop: 16 }}>
            <Button
              type="primary"
              disabled={!preview}
              loading={busy === 'finish'}
              onClick={finishBigQuery}
              style={{ marginBottom: registeredResult ? 14 : 0 }}
            >
              2. Finish
            </Button>


            {registeredResult ? (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                title={
                  <span>
                    Registered source_id <strong>{registeredResult.source_id}</strong>
                  </span>
                }
                description={
                  <div style={{ fontSize: 13 }}>
                    <div>Project: {registeredResult.project_id}</div>
                    <div>Datasets: {registeredResult.datasets.join(', ')}</div>
                    <div>Tables: {registeredResult.table_count}</div>
                    <div>Newly connected: {String(registeredResult.newly_connected)}</div>
                  </div>
                }
              />
            ) : null}
          </Card>
        </>
      ) : null}

      {/* ---------- Step 3: every other connector ---------- */}
      {step === 2 && selected && !isBigQuery ? (
        <>
          <Descriptions
            bordered
            size="small"
            column={1}
            style={{ marginBottom: 18 }}
            items={[
              { key: 'connector', label: 'Connector', children: selected.name },
              {
                key: 'name',
                label: 'Source name',
                children: form.getFieldValue('sourceName') || '—',
              },
              {
                key: 'cred',
                label: 'Credential',
                children: form.getFieldValue('credentialRef') || '—',
              },
            ]}
          />

          {test === 'idle' ? (
            <Button onClick={runGenericTest}>Run connection test</Button>
          ) : null}
          {test === 'running' ? (
            <Button loading disabled>
              Testing connection…
            </Button>
          ) : null}
          {test === 'passed' ? (
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              title="Connection succeeded"
              description={`Discovered ${DISCOVERY[selected.key] ?? 'metadata'}. Profiling starts as soon as the source is registered.`}
            />
          ) : null}
        </>
      ) : null}

      <Divider style={{ margin: '24px 0 16px' }} />

      <Flex justify="flex-end">
        {step === 0 ? (
          <Space>
            <Button onClick={onCancel}>Cancel</Button>
            <Button type="primary" disabled={!selected} onClick={next}>
              Continue <ArrowRightOutlined />
            </Button>
          </Space>
        ) : step === 1 ? (
          <Space>
            <Button onClick={() => setStep(0)}>← Back</Button>
            <Button type="primary" onClick={next}>
              Continue <ArrowRightOutlined />
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={() => setStep(1)}>← Back</Button>
            {isBigQuery ? (
              <Button onClick={onCancel}>Close</Button>
            ) : (
              <Button
                type="primary"
                disabled={test !== 'passed'}
                loading={busy === 'finish'}
                onClick={() => void finishGeneric()}
              >
                Connect source
              </Button>
            )}
          </Space>
        )}
      </Flex>
    </>
  )
}
