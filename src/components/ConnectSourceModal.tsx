import { Modal, Typography } from 'antd'
import type { RegisteredSource } from '../api/client'
import ConnectSourceWizard from './ConnectSourceWizard'

/** Dialog chrome only — the flow itself lives in ConnectSourceWizard. */
export default function ConnectSourceModal({
  open,
  onClose,
  onConnect,
  onRegistered,
}: {
  open: boolean
  onClose: () => void
  onConnect: (sourceName: string) => void
  onRegistered: (source: RegisteredSource) => void
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      footer={null}
      destroyOnHidden
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Connect a source
          </Typography.Title>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 13, fontWeight: 400 }}
          >
            Registration → credentials by reference → test → dictionary → policy.
            Profiling starts automatically on completion.
          </Typography.Text>
        </div>
      }
    >
      <ConnectSourceWizard
        onCancel={onClose}
        // BigQuery keeps the dialog open so the confirmation stays readable.
        onRegistered={onRegistered}
        onConnect={(sourceName) => {
          onConnect(sourceName)
          onClose()
        }}
      />
    </Modal>
  )
}
