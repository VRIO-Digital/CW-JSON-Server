import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Col,
  Flex,
  Input,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useMemo } from 'react'
import ApiErrorAlert from '../components/ApiErrorAlert'
import PageHeader from '../components/PageHeader'
import {
  WHOLE_FILE,
  formatJson,
  parseDraft,
  useDbStore,
} from '../store/dbStore'
import { SP } from '../theme'
import './DbEditorPage.css'

export default function DbEditorPage() {
  const { message } = App.useApp()

  const payload = useDbStore((s) => s.payload)
  const loading = useDbStore((s) => s.loading)
  const saving = useDbStore((s) => s.saving)
  const error = useDbStore((s) => s.error)
  const section = useDbStore((s) => s.section)
  const draft = useDbStore((s) => s.draft)
  const load = useDbStore((s) => s.load)
  const select = useDbStore((s) => s.select)
  const setDraft = useDbStore((s) => s.setDraft)
  const save = useDbStore((s) => s.save)

  useEffect(() => {
    void load()
  }, [load])

  // Live parse — Save stays disabled until the text is valid JSON.
  const parsed = useMemo(() => parseDraft(draft), [draft])

  const dirty = useMemo(() => {
    if (!payload) return false
    const original = formatJson(
      section === WHOLE_FILE ? payload.db : payload.db[section],
    )
    return draft !== original
  }, [draft, payload, section])

  async function handleSave() {
    const result = await save()
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(
      section === WHOLE_FILE
        ? 'db.json saved — every page now reads the new data.'
        : `"${section}" saved to db.json.`,
    )
  }

  const sections = payload?.sections ?? []

  if (error) {
    return (
      <>
        <PageHeader
          title="Mock data"
          subtitle="Edit mock-server/db.json — the file every page in this app reads from."
        />
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Mock data"
        subtitle="Edit mock-server/db.json — the file every page in this app reads from. Saving writes to disk and takes effect immediately, with no restart."
        actions={
          <>
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void load()}
            >
              Reload from disk
            </Button>
            <Button
              onClick={() => parsed.ok && setDraft(formatJson(parsed.value))}
              disabled={!parsed.ok}
            >
              Format
            </Button>
            {dirty ? (
              <Popconfirm
                title="Save to db.json?"
                description={
                  section === WHOLE_FILE
                    ? 'Overwrites the whole file on disk.'
                    : `Replaces the "${section}" key on disk.`
                }
                okText="Save"
                onConfirm={() => void handleSave()}
              >
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!parsed.ok}
                >
                  Save
                </Button>
              </Popconfirm>
            ) : (
              <Button type="primary" icon={<SaveOutlined />} disabled>
                Save
              </Button>
            )}
          </>
        }
      />

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: SP.lg }}
        title="This writes to a real file"
        description="Sources you registered through the wizard live in memory, not here — they survive edits but are lost when the server restarts. Removing a project that a registered source points at will leave that source without datasets."
      />

      <Row gutter={[SP.lg, SP.lg]} align="top">
        <Col xs={24} lg={7} xxl={6}>
          <div className="db-sections">
            <button
              type="button"
              className={`db-section${section === WHOLE_FILE ? ' is-active' : ''}`}
              onClick={() => select(WHOLE_FILE)}
            >
              <span className="db-section-name">whole file</span>
              <span className="db-section-meta">
                {sections.length} keys · {((payload?.bytes ?? 0) / 1024).toFixed(1)} KB
              </span>
            </button>

            {sections.map((s) => (
              <button
                type="button"
                key={s.key}
                className={`db-section${section === s.key ? ' is-active' : ''}`}
                onClick={() => select(s.key)}
              >
                <span className="db-section-name">
                  {s.key}
                  {s.required ? null : (
                    <Tag className="db-optional" variant="outlined">
                      optional
                    </Tag>
                  )}
                </span>
                <span className="db-section-meta">
                  {s.kind} · {s.count} {s.kind === 'array' ? 'item(s)' : 'key(s)'}
                </span>
              </button>
            ))}
          </div>

          <Typography.Text className="db-path">{payload?.path}</Typography.Text>
        </Col>

        <Col xs={24} lg={17} xxl={18}>
          <div className="db-editor">
            <Flex
              align="center"
              justify="space-between"
              gap={SP.md}
              wrap
              className="db-editor-bar"
            >
              <Space size={SP.sm}>
                <Typography.Text strong className="db-editing">
                  {section === WHOLE_FILE ? 'whole file' : section}
                </Typography.Text>
                {dirty ? (
                  <Tag color="warning" variant="filled">
                    unsaved changes
                  </Tag>
                ) : (
                  <Tag variant="outlined">saved</Tag>
                )}
              </Space>

              {parsed.ok ? (
                <Typography.Text className="db-valid">
                  <CheckCircleOutlined /> valid JSON
                </Typography.Text>
              ) : (
                <Typography.Text className="db-invalid">
                  <CloseCircleOutlined /> {parsed.error}
                </Typography.Text>
              )}
            </Flex>

            <Input.TextArea
              className="db-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              autoSize={{ minRows: 22, maxRows: 44 }}
              status={parsed.ok ? undefined : 'error'}
            />
          </div>
        </Col>
      </Row>
    </>
  )
}
