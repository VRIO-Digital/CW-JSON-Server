import {
  Alert,
  App,
  Button,
  Flex,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { SourceRow } from '../../api/client'
import { fileKind } from '../../data/mimeTypes'
import { useMailBrowseStore } from '../../store/catalogStore'
import { CONFIRM_WIDTH, profilingOutcome } from '../../data/profilingOutcome'
import '../../pages/CatalogPage.css'

/* Tree keys encode the pair the endpoint takes, so a leaf turns back into an object. The
   message level carries no key of its own that a run acts on — it is a container. */
const leafKey = (label: string, document: string) => `d:${label}::${document}`
const parseLeaf = (key: string) => {
  const [label_id, document_id] = key.slice(2).split('::')
  return { label_id, document_id }
}

/** The date a reader recognises, not an ISO stamp. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/**
 * The Gmail twin of `DocumentBrowsePanel`: pick attached documents, queue a run.
 *
 * **The tree is one level deeper than a drive's** — label → message → document — because a
 * mailbox's documents arrive *on* something, and who sent it is how a reader recognises a file
 * whose name (`signed-agreement.pdf`) repeats across the corpus. The profiled objects are the
 * leaves; a message is a container and carries no checkbox of its own that a run acts on,
 * though antd's parent propagation still lets one be checked to take everything on it.
 *
 * **A message with nothing attached is still listed**, marked as such. An absent row would say
 * the message does not exist rather than that it has nothing to profile, and which mail carries
 * documents is most of what this panel is read for.
 *
 * Like the other two it never forces on the first click; where every document picked has already
 * been profiled, `profilingOutcome` turns that into the confirm that offers a re-run, worded from
 * one place so the three panels cannot come to word one pair of acts differently.
 */
export default function MailBrowsePanel({
  source,
  onProfiled,
}: {
  source: SourceRow
  onProfiled: () => void
}) {
  const { message, modal } = App.useApp()
  const data = useMailBrowseStore((s) => s.data)
  const loading = useMailBrowseStore((s) => s.loading)
  const browseError = useMailBrowseStore((s) => s.error)
  const running = useMailBrowseStore((s) => s.starting)
  const loadBrowse = useMailBrowseStore((s) => s.load)
  const startProfilingRun = useMailBrowseStore((s) => s.start)
  const [checked, setChecked] = useState<string[]>([])

  const allLeaves = useMemo(
    () =>
      (data?.labels ?? []).flatMap((l) =>
        l.messages.flatMap((m) =>
          m.documents.map((d) => leafKey(l.label_id, d.document_id)),
        ),
      ),
    [data],
  )

  useEffect(() => {
    void loadBrowse(source.sourceId)
  }, [loadBrowse, source.sourceId])

  useEffect(() => {
    if (browseError) message.error(browseError)
  }, [browseError, message])

  // Everything is in scope by default — the copy says "uncheck to exclude".
  useEffect(() => {
    if (!data) return
    setChecked(
      data.labels.flatMap((l) =>
        l.messages.flatMap((m) =>
          m.documents.map((d) => leafKey(l.label_id, d.document_id)),
        ),
      ),
    )
  }, [data])

  const treeData: TreeDataNode[] = (data?.labels ?? []).map((l) => ({
    key: `l:${l.label_id}`,
    title: (
      <span className="cat-tree-row">
        <strong className="cat-tree-dataset">{l.name}</strong>
        <span className="cat-tree-count">
          {`${l.document_count} document(s) on ${l.message_count} message(s)`}
        </span>
      </span>
    ),
    children: l.messages.map((m) => ({
      key: `m:${l.label_id}::${m.message_id}`,
      /* The correspondent is named by the direction the message went, because "from" on a
         sent message is the reader themselves and says nothing. */
      title: (
        <span className="cat-tree-row">
          <span className="cat-tree-lead">
            <span className="cat-tree-table">{m.subject}</span>
            <span className="cat-tree-grain">
              {`${m.direction === 'sent' ? `to ${m.to_name}` : `from ${m.from_name}`} · ${shortDate(m.received)}`}
            </span>
          </span>
          <span className="cat-tree-count">
            {/* Stated, not omitted: which mail carries nothing is the fact this level exists
                to show, and a row with no children under it reads as a failure to load. */}
            {m.document_count === 0
              ? 'no attachments'
              : `${m.document_count} document(s)`}
          </span>
        </span>
      ),
      /* A container with no leaves must not be checkable: antd would let it be ticked and the
         run would receive nothing for it, which reads as a selection that was ignored. */
      checkable: m.document_count > 0,
      selectable: false,
      children: m.documents.map((d) => ({
        key: leafKey(l.label_id, d.document_id),
        title: (
          <span className="cat-tree-row">
            <span className="cat-tree-lead">
              <span>
                {/* Through `fileKind`, so one mime type cannot read PDF in a drive and
                    something else in a mailbox. */}
                <Tag className="cat-tree-kind">{fileKind(d.mime_type)}</Tag>
                <span className="cat-tree-table">{d.name}</span>
              </span>
            </span>
            <span className="cat-tree-count">
              {`${d.size_kb} KB${d.profiled ? ' · profiled' : ''}`}
            </span>
          </span>
        ),
      })),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('d:'))

  /** The twin of the other panels', in documents. Same wording, from `profilingOutcome`. */
  async function startProfiling(force = false) {
    const result = await startProfilingRun(source.sourceId, selected.map(parseLeaf), force)
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    const { job } = result
    const outcome = profilingOutcome(job.objects, 'document', job.short_id)
    if (outcome.kind === 'nothing-to-do') {
      modal.confirm({
        title: outcome.title,
        content: (
          <>
            <Typography.Paragraph>{outcome.detail}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">{outcome.note}</Typography.Paragraph>
          </>
        ),
        okText: outcome.confirmText,
        cancelText: outcome.cancelText,
        /* Both labels are sentences, and they do not fit antd's default 416px. */
        width: CONFIRM_WIDTH,
        onOk: () => startProfiling(true),
      })
    } else {
      message.success(outcome.text)
    }
    onProfiled()
  }

  return (
    <div className="cat-browse">
      {loading ? (
        <Spin />
      ) : (
        <>
          {/*
            * Two different facts, and only one of them has a remedy.
            *
            * Attachments out of scope is a decision the reader made in the wizard, and the fix
            * is to re-run it; a mailbox that simply carries none is a fact about the mail. An
            * empty tree looks identical either way, which is why the server serves the flag
            * rather than leaving it to be inferred.
            */}
          {data && !data.attachments_in_scope ? (
            <Alert
              type="info"
              showIcon
              title="Attachments are out of scope for this source"
              description="This mailbox was connected with attachments excluded, so it has no documents to profile. Re-run the connect wizard to include them."
            />
          ) : null}

          {/* One expression, not `text {expr} text`: React splits that into separate text
              nodes, so the sentence cannot be asserted as the sentence it renders as. */}
          <Typography.Paragraph className="cat-browse-hint">
            {`${data?.object_count ?? 0} document(s) attached to ${data?.message_count ?? 0} message(s) across ${data?.label_count ?? 0} label(s). Uncheck any document — or a whole message or label — to exclude it from this extraction run.`}
          </Typography.Paragraph>

          <Tree
            checkable
            blockNode
            selectable={false}
            defaultExpandAll
            treeData={treeData}
            checkedKeys={checked}
            onCheck={(keys) => setChecked(keys as string[])}
          />

          <Flex
            align="center"
            justify="space-between"
            wrap
            gap={10}
            className="cat-browse-foot"
          >
            <Space wrap>
              <Button size="small" onClick={() => setChecked(allLeaves)}>
                Select all
              </Button>
              <Button size="small" onClick={() => setChecked([])}>
                Select none
              </Button>
              <Button
                type="primary"
                size="small"
                loading={running}
                onClick={() => void startProfiling()}
              >
                Start Profiling
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {`${selected.length} of ${allLeaves.length} selected`}
            </Typography.Text>
          </Flex>
        </>
      )}
    </div>
  )
}
