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
  driveOauthCallback,
  oauthCallback,
  oauthStart,
  previewDrive,
  previewSource,
  registerDriveSource,
  registerGenericSource,
  registerSource,
  type DriveInfo,
  type DrivePreviewResult,
  type GcpProject,
  type GoogleAccount,
  type PreviewResult,
  type RegisteredDriveSource,
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

/** Human label for a Drive's kind, which the API keeps snake_case. */
const DRIVE_KIND: Record<string, string> = {
  my_drive: 'My Drive',
  shared_drive: 'Shared drive',
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
  /** Stubbed connectors: registers a bare row and closes. Receives its name. */
  onConnect: (sourceName: string) => void
  /** BigQuery / Drive: registered for real; the dialog stays open. */
  onRegistered: (source: RegisteredSource | RegisteredDriveSource) => void
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

  // ---- Google Drive state — the same three moves, in folders ----
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [driveId, setDriveId] = useState('')
  const [driveHandle, setDriveHandle] = useState('')
  const [folderAllowlistText, setFolderAllowlistText] = useState('')
  const [drivePreview, setDrivePreview] = useState<DrivePreviewResult | null>(null)
  const [checkedFolders, setCheckedFolders] = useState<string[]>([])
  const [registeredDrive, setRegisteredDrive] =
    useState<RegisteredDriveSource | null>(null)

  const isBigQuery = selected?.key === 'bigquery'
  const isDrive = selected?.key === 'gdrive'
  /** Both real connectors run the bespoke consent → preview → finish path. */
  const isGoogle = isBigQuery || isDrive

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
      // The consent is scoped to the connector, so the state is issued for it.
      const start = await oauthStart(isDrive ? 'drive' : 'bigquery')
      if (isDrive) {
        const result = await driveOauthCallback(start.state)
        setAccount(result.account)
        setDrives(result.drives)
        const first = result.drives[0]
        if (first) selectDrive(first.drive_id, result.drives)
      } else {
        const result = await oauthCallback(start.state)
        setAccount(result.account)
        setProjects(result.projects)
        const first = result.projects[0]
        if (first) selectProject(first.project_id, result.projects)
      }
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

  function selectDrive(id: string, list = drives) {
    setDriveId(id)
    setDriveHandle(list.find((d) => d.drive_id === id)?.credential_handle ?? '')
    // A different drive invalidates any previous discovery.
    setDrivePreview(null)
    setCheckedFolders([])
    setRegisteredDrive(null)
  }

  async function runDrivePreview() {
    setBusy('preview')
    try {
      const result = await previewDrive(driveId, driveHandle)
      setDrivePreview(result)
      const fromAllowlist = folderAllowlistText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      // Blank allowlist auto-fills from everything Preview discovered.
      setCheckedFolders(
        fromAllowlist.length > 0
          ? fromAllowlist
          : result.folders.map((f) => f.folder_id),
      )
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  async function finishDrive() {
    if (checkedFolders.length === 0) {
      message.warning('Check at least one folder before finishing.')
      return
    }
    setBusy('finish')
    try {
      const result = await registerDriveSource({
        driveId,
        credentialHandle: driveHandle,
        folders: checkedFolders,
        sourceName: sourceName || driveId,
      })
      setRegisteredDrive(result)
      onRegistered(result)
      message.success(`Connected — registered ${result.source_id}`)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
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
      if (isDrive) {
        if (!driveId || !driveHandle) {
          message.warning(
            'Sign in with Google, or supply a drive ID and credential handle under Advanced.',
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
            title="Click below to sign in with your own Google account and grant read-only BigQuery access — no key file to download or upload."
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

      {/* ---------- Step 2: Google Drive connection ---------- */}
      {step === 1 && isDrive ? (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={VISION_NOTE} />
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="Click below to sign in with your own Google account and grant read-only Drive access — no service-account key to download or upload. Uses the GET /sources/oauth/start?provider=drive → Google consent → GET /sources/oauth/callback flow."
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
                placeholder="Compliance documents"
              />
            </Form.Item>

            {drives.length > 0 ? (
              <Form.Item label="Drive">
                <Select
                  value={driveId || undefined}
                  onChange={(value) => selectDrive(value)}
                  placeholder="Select a drive"
                  options={drives.map((d) => ({
                    value: d.drive_id,
                    label: `${d.display_name} — ${DRIVE_KIND[d.kind] ?? d.kind} · ${d.folder_count} folder(s) · ${d.document_count} document(s)`,
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
                label: 'Advanced: enter a drive and credential handle manually',
                children: (
                  <Form layout="vertical" requiredMark={false}>
                    <Form.Item label="Drive ID">
                      <Input
                        value={driveId}
                        onChange={(e) => setDriveId(e.target.value)}
                        placeholder="shared-compliance"
                      />
                    </Form.Item>

                    <Form.Item
                      label="Credential handle"
                      extra="Issued by the Google consent flow. There is no way to paste a raw key — ContextWeave only ever holds a reference."
                    >
                      <Input
                        value={driveHandle}
                        onChange={(e) => setDriveHandle(e.target.value)}
                        placeholder="drive-handle-…"
                      />
                    </Form.Item>

                    <Form.Item label="Folder allowlist (comma-separated — optional for Preview, required for Finish)">
                      <Input
                        value={folderAllowlistText}
                        onChange={(e) => setFolderAllowlistText(e.target.value)}
                        placeholder="f_audit_reports, f_policies — leave blank to auto-fill from Preview’s discovered folders"
                      />
                    </Form.Item>

                    <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                      Credentials are held by reference only (credential_handle).
                      This calls POST /sources/drive/preview and POST /sources/drive.
                    </Typography.Text>
                  </Form>
                ),
              },
            ]}
          />
        </>
      ) : null}

      {/* ---------- Step 2: every other connector ---------- */}
      {step === 1 && selected && !isGoogle ? (
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

      {/* ---------- Step 3: Drive preview + finish ---------- */}
      {step === 2 && isDrive ? (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title={VISION_NOTE} />

          <Card size="small" style={{ marginBottom: 16 }}>
            <Button
              loading={busy === 'preview'}
              onClick={runDrivePreview}
              style={{ marginBottom: drivePreview ? 14 : 0 }}
            >
              1. Run preview
            </Button>

            {drivePreview ? (
              <>
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 14 }}
                  title={`${drivePreview.display_name} · discovered ${drivePreview.folder_count} folder(s), ${drivePreview.document_count} document(s)`}
                />
                <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                  Folder allowlist — check which folders this source may profile
                </Typography.Text>
                <Checkbox.Group
                  value={checkedFolders}
                  onChange={(values) => setCheckedFolders(values as string[])}
                  options={drivePreview.folders.map((f) => ({
                    label: `${f.name} — ${f.document_count} doc(s) · ${f.page_count} page(s)`,
                    value: f.folder_id,
                  }))}
                />
              </>
            ) : null}
          </Card>

          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Discovers the folders visible to this credential handle without
            registering anything yet. Documents are counted, not read — extraction
            happens when the document profiler runs.
          </Typography.Text>

          <Card size="small" style={{ marginTop: 16 }}>
            <Button
              type="primary"
              disabled={!drivePreview}
              loading={busy === 'finish'}
              onClick={finishDrive}
              style={{ marginBottom: registeredDrive ? 14 : 0 }}
            >
              2. Finish
            </Button>

            {registeredDrive ? (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                title={
                  <span>
                    Registered source_id <strong>{registeredDrive.source_id}</strong>
                  </span>
                }
                description={
                  <div style={{ fontSize: 13 }}>
                    <div>Drive: {registeredDrive.drive_id}</div>
                    <div>Folders: {registeredDrive.folders.join(', ')}</div>
                    <div>Documents: {registeredDrive.document_count}</div>
                    <div>Newly connected: {String(registeredDrive.newly_connected)}</div>
                  </div>
                }
              />
            ) : null}
          </Card>
        </>
      ) : null}

      {/* ---------- Step 3: every other connector ---------- */}
      {step === 2 && selected && !isGoogle ? (
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
              description="Registration is stubbed for this connector — it lands as a bare row with no discovery until its profiler ships."
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
            {isGoogle ? (
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
