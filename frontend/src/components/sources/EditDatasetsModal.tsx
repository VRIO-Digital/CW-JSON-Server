import { App, Checkbox, Modal, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { listProjectDatasets, type SourceRow } from '../../api/client'
import { useSourcesStore } from '../../store/sourcesStore'
import { toMessage } from '../../store/asyncState'

/** Narrows or widens the dataset allowlist of an already-registered source. */
export default function EditDatasetsModal({
  source,
  onClose,
  onSaved,
}: {
  source: SourceRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { message } = App.useApp()
  const setDatasets = useSourcesStore((s) => s.setDatasets)
  const pending = useSourcesStore((s) => s.pending)

  const [available, setAvailable] = useState<string[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const projectId = source?.projectAccount
  const sourceId = source?.sourceId

  useEffect(() => {
    if (!source || !projectId) return
    setChecked(source.datasets)
    setLoading(true)

    // Local try/catch: this one read is not worth a store of its own.
    listProjectDatasets(projectId)
      .then((result) => setAvailable(result.datasets.map((d) => d.dataset_id)))
      .catch((error) => message.error(toMessage(error)))
      .finally(() => setLoading(false))
  }, [source, projectId, message])

  async function save() {
    if (!sourceId) return
    const result = await setDatasets(sourceId, checked)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`Allowlist updated — ${checked.length} dataset(s).`)
    onSaved()
  }

  return (
    <Modal
      open={source !== null}
      onCancel={onClose}
      onOk={() => void save()}
      okText="Save allowlist"
      confirmLoading={pending === sourceId}
      title={`Edit datasets — ${sourceId ?? ''}`}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        Which datasets in <Typography.Text code>{projectId}</Typography.Text> this
        source may profile.
      </Typography.Paragraph>

      {loading ? (
        <Spin />
      ) : (
        <Checkbox.Group
          value={checked}
          onChange={(values) => setChecked(values as string[])}
          options={available.map((d) => ({ label: d, value: d }))}
        />
      )}
    </Modal>
  )
}
