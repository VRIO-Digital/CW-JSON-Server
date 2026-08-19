import { Alert, Button, Typography } from 'antd'

/**
 * Shown when the JSON server is unreachable. There is no static fallback data
 * any more, so this is the whole page in that case — it has to say what to do.
 */
export default function ApiErrorAlert({
  error,
  onRetry,
}: {
  error: string
  onRetry: () => void
}) {
  return (
    <Alert
      type="error"
      showIcon
      title="No data — the JSON server is not responding"
      description={
        <>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            {error}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            Every page reads from <Typography.Text code>mock-server/db.json</Typography.Text>{' '}
            through that server, so nothing renders without it. Run it in a second
            terminal:
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            <Typography.Text code>npm run mock</Typography.Text>
          </Typography.Paragraph>
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        </>
      }
    />
  )
}
