import { Alert, Button, Card, Empty, Space, Tag, Typography } from 'antd'
import type { StudioVersion } from '../../api/client'
import { SP } from '../../theme'

/**
 * Every version of this use case, newest first — **and a version is the pair of lane artifacts that
 * were approved together.**
 *
 * The lanes build independently and keep their own ids underneath; what this row adds is a single
 * identity for the set, so "publish this use case" is one act with one outcome rather than two calls
 * that can half-succeed. It records an approval — it is never a merged or copied graph.
 *
 * **Publishing flips a pointer; it never rewrites a row.** A version is content-addressed, so two
 * builds of one use case differ in their artifacts and nowhere else, and publishing an older row is
 * how a rollback works. Any row may be published, which is what makes that true.
 */

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export default function StudioVersionsTab({
  versions,
  busy,
  signedInAs,
  onPublish,
  onUnpublish,
}: {
  versions: StudioVersion[]
  busy: boolean
  signedInAs: string | null
  onPublish: (versionId: string) => void
  onUnpublish: (versionId: string) => void
}) {
  if (versions.length === 0) {
    return (
      <Empty
        description={
          'No version yet. A version names what a build produced, so build this use case first — ' +
          'opening this tab afterwards records one automatically.'
        }
      />
    )
  }

  return (
    <Space direction="vertical" size={SP.base} style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: 0 }}>
        Publishing is what lets Ask, Reports and the What-if lens read this graph, and it approves
        every artifact the version names in one act — or none of them. Withdrawing it takes the use
        case back to answering from nothing rather than silently falling back to an older version.
      </Typography.Paragraph>

      {signedInAs === null ? (
        <Alert
          type="warning"
          showIcon
          title="Nobody is signed in"
          description={
            'A publication records who made it, and this app holds the identity in the browser — so ' +
            'there is nothing to credit. Sign in before publishing.'
          }
        />
      ) : null}

      {versions.map((version) => {
        const published = version.publishedAt !== null
        return (
          <Card
            key={version.graphVersionId}
            size="small"
            styles={{ header: { padding: SP.md }, body: { padding: SP.md } }}
            title={
              <Space size={SP.sm} wrap>
                {/* One expression, not `v{n}`: `renderToString` splits text-around-an-expression
                    into separate nodes, so a label written that way cannot be asserted whole. */}
                <Typography.Text strong>{`v${version.versionNumber}`}</Typography.Text>
                {published ? <Tag color="green">published</Tag> : <Tag>unpublished</Tag>}
              </Space>
            }
            extra={
              published ? (
                <Button
                  size="small"
                  danger
                  loading={busy}
                  onClick={() => onUnpublish(version.graphVersionId)}
                >
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  loading={busy}
                  disabled={signedInAs === null}
                  onClick={() => onPublish(version.graphVersionId)}
                >
                  {`Publish v${version.versionNumber}`}
                </Button>
              )
            }
          >
            <Space direction="vertical" size={SP.xs} style={{ width: '100%' }}>
              <Space size={SP.sm} wrap>
                {/* The artifacts this version names. Both lanes' ids stay visible, because the two
                    graphs remain two graphs — only the approval is joint. */}
                {version.sgbBuildId ? (
                  <Tag color="blue">structured build {version.sgbBuildId.slice(0, 8)}…</Tag>
                ) : (
                  <Tag>no structured lane</Tag>
                )}
                {version.dgbGraphVersion !== null ? (
                  <Tag color="purple">document graph v{version.dgbGraphVersion}</Tag>
                ) : (
                  <Tag>no document lane</Tag>
                )}
                {version.bridgeBuildId ? (
                  <Tag color="gold">Bridge {version.bridgeBuildId.slice(0, 8)}…</Tag>
                ) : null}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Recorded {fmt(version.createdAt)}
                {published && version.publishedAt
                  ? ` · published ${fmt(version.publishedAt)}${
                      version.publishedBy ? ` by ${version.publishedBy}` : ''
                    }`
                  : ''}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                Immutable — the artifacts it names are what identify it. Publishing gates Ask access;
                it does not mutate this graph.
              </Typography.Text>
            </Space>
          </Card>
        )
      })}
    </Space>
  )
}
