import { App, Checkbox, Modal, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { listDriveFolders, type SourceRow } from '../api/client'
import { useSourcesStore } from '../store/sourcesStore'
import { toMessage } from '../store/asyncState'

/** The Drive twin of EditDatasetsModal: narrows a source's folder allowlist. */
export default function EditFoldersModal({
  source,
  onClose,
  onSaved,
}: {
  source: SourceRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const setFolders = useSourcesStore((s) => s.setFolders)
  const pending = useSourcesStore((s) => s.pending)

  const [available, setAvailable] = useState<
    { folder_id: string; name: string; document_count: number }[]
  >([])
  const [checked, setChecked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const driveId = source?.projectAccount
  const sourceId = source?.sourceId

  useEffect(() => {
    if (!source || !driveId) return
    setChecked(source.folders)
    setLoading(true)

    // Local try/catch: this one read is not worth a store of its own.
    listDriveFolders(driveId)
      .then((result) => setAvailable(result.folders))
      .catch((error) => message.error(toMessage(error)))
      .finally(() => setLoading(false))
  }, [source, driveId, message])

  async function save() {
    if (!sourceId) return
    const result = await setFolders(sourceId, checked)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`Allowlist updated — ${checked.length} folder(s).`)
    onSaved()
  }

  return (
    <Modal
      open={source !== null}
      onCancel={onClose}
      onOk={() => void save()}
      okText="Save allowlist"
      confirmLoading={pending === sourceId}
      title={`Edit folders — ${sourceId ?? ''}`}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        Which folders in <Typography.Text code>{driveId}</Typography.Text> this
        source may profile.
      </Typography.Paragraph>

      {loading ? (
        <Spin />
      ) : (
        <Checkbox.Group
          value={checked}
          onChange={(values) => setChecked(values as string[])}
          options={available.map((f) => ({
            label: `${f.name} (${f.document_count})`,
            value: f.folder_id,
          }))}
        />
      )}
    </Modal>
  )
}
