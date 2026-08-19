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
  Modal,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Steps,
  Typography,
} from 'antd'
import { useState } from 'react'
import {
  driveOauthCallback,
  listOauthDrives,
  listOauthProjects,
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
import { SOURCE_NAME_MIN, sourceNameProblem } from '../data/sourceName'
import ConnectRunPanel from './ConnectRunPanel'
import ConnectorIcon from './ConnectorIcon'
import FolderTreePicker from './FolderTreePicker'
import GoogleSignInWindow, { type SignInPhase } from './GoogleSignInWindow'
import { toMessage } from '../store/asyncState'
import { useAuthStore } from '../store/authStore'
import { BRAND, BRAND_SOFT, SP } from '../theme'
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
      {/* The vendor mark, so a connector is recognised before it is read. The
          unavailable ones keep theirs — the card is dimmed as a whole, and a
          logo missing from half the grid would read as a loading state. */}
      <Flex align="center" gap={SP.sm}>
        <span className="connector-card-icon">
          <ConnectorIcon connector={connector.key} size={22} />
        </span>
        <span style={{ minWidth: 0 }}>
          <Typography.Text
            strong
            style={{ display: 'block', color: selected ? BRAND : undefined }}
          >
            {connector.name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {connector.blurb}
          </Typography.Text>
        </span>
      </Flex>
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
  /*
   * The consent connects *this* user's account, so the signed-in email goes out
   * with the callback. A primitive selector, so signing out is the only thing
   * that re-renders the wizard.
   */
  const signedInAs = useAuthStore((s) => s.identity?.email)
  /* The sign-in window names the account it is about to connect, so it needs what the browser
     knows about that person — and nothing more. Primitive selectors, as above. */
  const signedInName = useAuthStore((s) => s.identity?.name)
  const signedInInitials = useAuthStore((s) => s.identity?.initials)
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Connector | null>(null)
  const [blocked, setBlocked] = useState<Connector | null>(null)
  const [test, setTest] = useState<TestState>('idle')
  const [form] = Form.useForm()

  // ---- BigQuery connection state ----
  const [sourceName, setSourceName] = useState('')
  /* Whether to show the name's error yet. A required field that is red before it
     has been touched reads as a failure the user caused. */
  const [nameTouched, setNameTouched] = useState(false)
  const [account, setAccount] = useState<GoogleAccount | null>(null)
  const [projects, setProjects] = useState<GcpProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [credentialHandle, setCredentialHandle] = useState('')
  const [allowlistText, setAllowlistText] = useState('')
  const [busy, setBusy] = useState<'login' | 'preview' | 'finish' | null>(null)
  /** Which consent stage is in flight while `busy === 'login'`. */
  const [loginStage, setLoginStage] = useState(0)
  /*
   * What the handshake actually asked for, as the server reported it. Held rather
   * than looked up from a constant: Drive asks for *two* scopes, and a panel
   * naming one would understate the grant being made. See docs/REGRESSIONS.md.
   */
  const [oauthScopes, setOauthScopes] = useState<string[]>([])
  /*
   * The sign-in window: which of its three phases is showing, and the state `/oauth/start` issued
   * for it. `null` is closed. The window is opened by the *first* call rather than by the click —
   * it renders the scopes that call reported, and a window that appeared first would have to
   * either guess them or open blank.
   */
  const [signInPhase, setSignInPhase] = useState<SignInPhase | null>(null)
  const [oauthState, setOauthState] = useState('')

  // ---- BigQuery test & finish state ----
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [registeredResult, setRegisteredResult] = useState<RegisteredSource | null>(null)

  // ---- Google Drive state — the same three moves, in folders ----
  const [drives, setDrives] = useState<DriveInfo[]>([])
  /*
   * Which half of the account's Drive is being browsed. Google splits the two — a personal My
   * Drive and the shared drives an organisation owns — and they are different things to connect,
   * so the picker separates them rather than mixing both into one list where a shared drive and a
   * personal folder read as peers. The kinds come from the payload; this is only which one is
   * showing.
   */
  const [driveKind, setDriveKind] = useState<string>('shared_drive')
  const [driveId, setDriveId] = useState('')
  const [driveHandle, setDriveHandle] = useState('')
  const [folderAllowlistText, setFolderAllowlistText] = useState('')
  const [drivePreview, setDrivePreview] = useState<DrivePreviewResult | null>(null)
  const [checkedFolders, setCheckedFolders] = useState<string[]>([])
  const [registeredDrive, setRegisteredDrive] =
    useState<RegisteredDriveSource | null>(null)

  /*
   * Who the consent connected. The signed-in email wins over the one the
   * callback echoed back, and deliberately: this login authenticates by *shape*
   * and the consent screen proves a request is well-formed rather than that a
   * real Google account sits behind it (CLAUDE.md § Identity), so the only fact
   * about *who* is connecting lives in the browser. Reading it locally also means
   * an older or deployed mock server — one that still answers with
   * `db.google_account` — cannot make this alert name a stranger.
   */
  const connectedAs = account ? (signedInAs ?? account.email) : null

  /* One rule, shared with the server (`sourceNameProblem` in server.mjs) so the
     wizard refuses what the API would refuse, before the round trip. */
  const nameProblem = sourceNameProblem(sourceName)

  /** The drives on the side of the picker that is showing. */
  const drivesOfKind = drives.filter((d) => d.kind === driveKind)

  const isBigQuery = selected?.key === 'bigquery'
  const isDrive = selected?.key === 'gdrive'
  /** Both real connectors run the bespoke consent → preview → finish path. */
  const isGoogle = isBigQuery || isDrive

  // `toMessage` already tells a validation failure, a network failure and the
  // server's own wording apart; "Unexpected error" told the user none of them.
  const fail = (err: unknown) => message.error(toMessage(err))

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

  /**
   * Opens the sign-in window — and makes the first call, because the window has to render the
   * scopes that call reported rather than a copy kept here. Nothing is granted yet: this is the
   * account chooser, and the callback runs when Allow is pressed.
   */
  async function openGoogleSignIn() {
    setBusy('login')
    setLoginStage(0)
    setOauthScopes([])
    try {
      // The consent is scoped to the connector, so the state is issued for it.
      const start = await oauthStart(isDrive ? 'drive' : 'bigquery')
      setOauthScopes(start.scopes)
      setOauthState(start.state)
      setSignInPhase('account')
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  /** Cancelling grants nothing and connects nobody — the state simply goes unspent. */
  function cancelGoogleSignIn() {
    setSignInPhase(null)
    setOauthState('')
    setLoginStage(0)
  }

  /**
   * The rest of the handshake, once the user has allowed it: consent, then discovery.
   *
   * Two calls, and the window shows a row per call — plus the `/oauth/start` row already done.
   * Stage 1 is the call in flight, not a countdown: each row moves only when its request comes
   * back, so the window cannot claim progress the handshake has not made.
   */
  async function grantGoogleConsent() {
    setBusy('login')
    setSignInPhase('granting')
    setLoginStage(1)
    try {
      if (isDrive) {
        // The consent says who signed in; the session says what they can see.
        const granted = await driveOauthCallback(oauthState, signedInAs)
        setAccount(granted.account)
        setLoginStage(2)
        const readable = await listOauthDrives(granted.session)
        setDrives(readable)
        /* Open on the half of the Drive that has something in it, rather than on a fixed kind
           that can legitimately be empty for an account with no shared drives. */
        const kind =
          readable.find((d) => d.kind === driveKind)?.kind ?? readable[0]?.kind ?? driveKind
        setDriveKind(kind)
        const first = readable.find((d) => d.kind === kind)
        if (first) selectDrive(first.drive_id, readable)
      } else {
        const granted = await oauthCallback(oauthState, signedInAs)
        setAccount(granted.account)
        setLoginStage(2)
        const readable = await listOauthProjects(granted.session)
        setProjects(readable)
        const first = readable[0]
        if (first) selectProject(first.project_id, readable)
      }
      setSignInPhase(null)
    } catch (err) {
      fail(err)
      /* Closed, not returned to the consent step: the state has been spent either way, and a
         window offering Allow again would only produce "invalid or expired state" a second time.
         The button underneath starts a fresh handshake, which is the real retry. */
      setSignInPhase(null)
    } finally {
      setBusy(null)
      setLoginStage(0)
      setOauthState('')
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
        // See finishBigQuery: required, so no drive-id fallback.
        sourceName: sourceName.trim(),
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
        // No `|| projectId` fallback: the name is required and step 2 refuses to
        // advance without one, so falling back would only mask a regression.
        sourceName: sourceName.trim(),
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
      /*
       * The name is checked before the connection details on both branches: it is
       * the field the user typed, so it is the one they can fix without leaving
       * the step, and the register call would refuse it anyway.
       */
      if (isGoogle && nameProblem) {
        setNameTouched(true)
        message.warning(
          `Give this source a name of at least ${SOURCE_NAME_MIN} characters — it is how it appears in the Sources table and the Data Catalog.`,
        )
        return
      }
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
    /* `next()` ran validateFields to get here, so the name is present and long
       enough; falling back to the connector's own name would mask a regression
       and register every Snowflake source as "Snowflake". */
    const name = String(values.sourceName ?? '').trim()
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
      {/*
        One window for both connectors — the handshake differs only in what it asks for, and it
        asks the server, so a second copy could only drift. It is mounted here rather than inside
        either branch because a dialog inside a step unmounts when the step changes.
      */}
      {signInPhase !== null ? (
        <GoogleSignInWindow
          open
          provider={isDrive ? 'drive' : 'bigquery'}
          /* Who is signing in is the browser's fact, not the server's — the same reason the
             "Connected as …" alert below prefers the store. The fallbacks are only for a session
             that predates those fields. */
          email={signedInAs ?? ''}
          name={signedInName ?? signedInAs ?? ''}
          initials={signedInInitials ?? '—'}
          phase={signInPhase}
          scopes={oauthScopes}
          stage={loginStage}
          onChooseAccount={() => setSignInPhase('consent')}
          onAllow={() => void grantGoogleConsent()}
          onCancel={cancelGoogleSignIn}
        />
      ) : null}

      {/*
        Step 3's two acts, one dialog each — Preview says it is reading, Finish says it is
        registering, and neither describes the other's work. Mounted here rather than inside
        either connector's branch for the reason the sign-in window is: a dialog inside a step
        unmounts with the step.

        Both open from `busy`, the same flag the buttons' spinners read, so a dialog cannot be
        on screen for a call that has already come back. Closing is likewise the request
        returning: there is no dismiss, because there is nothing here to decide and cancelling
        would leave a five-second call still running with nothing on screen.

        Google only: the generic connectors' step 3 is a stubbed test plus one unpaced call,
        and a progress dialog over it would be narrating work that is not happening.
      */}
      {step === 2 && isGoogle && busy === 'preview' ? (
        <Modal
          open
          width={420}
          centered
          closable={false}
          maskClosable={false}
          keyboard={false}
          footer={null}
          title={null}
        >
          {/* The subject is the id the request is made with, so the message names the
              project or drive being read rather than "the datasets" in the abstract. */}
          <ConnectRunPanel
            kind={isDrive ? 'gdrive' : 'bigquery'}
            act="preview"
            subject={isDrive ? driveId : projectId}
          />
        </Modal>
      ) : null}

      {step === 2 && isGoogle && busy === 'finish' ? (
        <Modal
          open
          width={420}
          centered
          closable={false}
          maskClosable={false}
          keyboard={false}
          footer={null}
          title={null}
        >
          <ConnectRunPanel
            kind={isDrive ? 'gdrive' : 'bigquery'}
            act="finish"
            subject={isDrive ? driveId : projectId}
          />
        </Modal>
      ) : null}

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
            disabled={busy === 'login' || signInPhase !== null}
            onClick={openGoogleSignIn}
            style={{ marginBottom: 16 }}
          >
            {busy === 'login' ? 'Opening Google…' : 'Login with Google'}
          </Button>

          {connectedAs ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              title={
                <span>
                  Connected as <strong>{connectedAs}</strong> — read-only
                  access to {projects.length} project(s)
                </span>
              }
            />
          ) : null}

          <Form layout="vertical" requiredMark={false}>
            {/* Required, and the only field here that is. The error appears once
                something has been typed rather than on arrival — a form that opens
                already complaining is scolding, not helping. */}
            <Form.Item
              label="Source name"
              required
              validateStatus={nameTouched && nameProblem ? 'error' : undefined}
              help={nameTouched ? nameProblem : null}
              extra={`How this source appears in the Sources table and the Data Catalog. At least ${SOURCE_NAME_MIN} characters.`}
            >
              <Input
                value={sourceName}
                onChange={(e) => {
                  setSourceName(e.target.value)
                  setNameTouched(true)
                }}
                onBlur={() => setNameTouched(true)}
                placeholder="E-waste warehouse"
                status={nameTouched && nameProblem ? 'error' : undefined}
              />
            </Form.Item>

            {projects.length > 0 ? (
              <Form.Item
                label="GCP project"
                extra={`${projects.length} project(s) this account can read. One source connects one project — connect the wizard again for another.`}
              >
                <Select
                  value={projectId || undefined}
                  onChange={(value) => selectProject(value)}
                  placeholder="Select a project"
                  showSearch
                  optionFilterProp="label"
                  /* The display name leads and the id follows it: an account with several
                     projects is chosen between by name, and `vrio-cw-sandbox` is an id, not a
                     name. Both are shown because the id is what the source registers against. */
                  options={projects.map((p) => ({
                    value: p.project_id,
                    label: `${p.display_name} (${p.project_id}) — ${p.dataset_count} dataset(s) · ${p.location}`,
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
            disabled={busy === 'login' || signInPhase !== null}
            onClick={openGoogleSignIn}
            style={{ marginBottom: 16 }}
          >
            {busy === 'login' ? 'Opening Google…' : 'Login with Google'}
          </Button>

          {connectedAs ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              title={
                <span>
                  Connected as <strong>{connectedAs}</strong> — read-only
                  access to {drives.length} drive(s)
                </span>
              }
            />
          ) : null}

          <Form layout="vertical" requiredMark={false}>
            <Form.Item
              label="Source name"
              extra="How this source appears in the Sources table and the Data Catalog."
            >
              <Input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Compliance documents"
              />
            </Form.Item>

            {drives.length > 0 ? (
              <>
                {/*
                  My Drive and the shared drives are two different things to connect — one is a
                  person's, one is the organisation's — so they are picked between rather than
                  listed together. The kinds come from the payload, and a kind the account has
                  none of is offered with the count that says so rather than hidden: "0 shared
                  drives" is an answer, a missing control is not.
                */}
                <Form.Item label="Where the documents are">
                  <Segmented
                    value={driveKind}
                    onChange={(value) => {
                      const kind = String(value)
                      setDriveKind(kind)
                      const first = drives.find((d) => d.kind === kind)
                      if (first) selectDrive(first.drive_id)
                    }}
                    options={Object.entries(DRIVE_KIND).map(([kind, label]) => ({
                      value: kind,
                      label: `${label} (${drives.filter((d) => d.kind === kind).length})`,
                    }))}
                  />
                </Form.Item>

                <Form.Item
                  label={DRIVE_KIND[driveKind] ?? driveKind}
                  extra={
                    drivesOfKind.length === 0
                      ? `This account can read no ${(DRIVE_KIND[driveKind] ?? driveKind).toLowerCase()}. Pick the other option, or connect an account that can.`
                      : undefined
                  }
                >
                  <Select
                    value={
                      drivesOfKind.some((d) => d.drive_id === driveId)
                        ? driveId
                        : undefined
                    }
                    onChange={(value) => selectDrive(value)}
                    placeholder="Select a drive"
                    disabled={drivesOfKind.length === 0}
                    options={drivesOfKind.map((d) => ({
                      value: d.drive_id,
                      label: `${d.display_name} — ${d.folder_count} folder(s) · ${d.document_count} document(s)`,
                    }))}
                  />
                </Form.Item>
              </>
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
                    rules={[
                      ...(field.required
                        ? [{ required: true, message: `${field.label} is required` }]
                        : []),
                      /* `whitespace` too, or "      " passes a length check while
                         registering a row with a blank label. */
                      ...(field.minLength
                        ? [
                            {
                              min: field.minLength,
                              whitespace: true,
                              message: `${field.label} needs at least ${field.minLength} characters`,
                            },
                          ]
                        : []),
                    ]}
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

            {/* Discovery is a real round trip, so the allowlist arrives as a
                skeleton of itself rather than appearing from nowhere. */}
            {busy === 'preview' && !preview ? (
              <div style={{ marginTop: SP.base }}>
                <Skeleton active title={{ width: '46%' }} paragraph={{ rows: 3 }} />
              </div>
            ) : null}

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

            {busy === 'preview' && !drivePreview ? (
              <div style={{ marginTop: SP.base }}>
                <Skeleton active title={{ width: '46%' }} paragraph={{ rows: 3 }} />
              </div>
            ) : null}

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
                {/* Drawn as the tree the drive is, not as a flat list: a subfolder and the folder
                    holding it are not peers, and checking one brings in what is inside it. */}
                <FolderTreePicker
                  folders={drivePreview.folders}
                  value={checkedFolders}
                  onChange={setCheckedFolders}
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
