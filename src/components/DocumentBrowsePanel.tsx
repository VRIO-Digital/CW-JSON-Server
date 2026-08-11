import { CloseOutlined } from '@ant-design/icons'
import {
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
import type { SourceRow } from '../api/client'
import { fileKind } from '../data/mimeTypes'
import { useDocumentBrowseStore } from '../store/catalogueStore'
import '../pages/CataloguePage.css'

/* Tree keys encode the pair so a leaf can be turned back into an object. */
const leafKey = (folder: string, document: string) => `f:${folder}::${document}`
const parseLeaf = (key: string) => {
  const [folder_id, document_id] = key.slice(2).split('::')
  return { folder_id, document_id }
}

/**
 * The Drive twin of `BrowsePanel`: pick documents, queue a run.
 *
 * Like the table panel it never forces — re-profiling an already-extracted
 * document is done per-run from the Force button in Profiling jobs.
 */
export default function DocumentBrowsePanel({
  source,
  onClose,
  onProfiled,
}: {
  source: SourceRow
  onClose: () => void
  onProfiled: () => void
}) {
  const { message } = App.useApp()
  const data = useDocumentBrowseStore((s) => s.data)
  const loading = useDocumentBrowseStore((s) => s.loading)
  const browseError = useDocumentBrowseStore((s) => s.error)
  const running = useDocumentBrowseStore((s) => s.starting)
  const loadBrowse = useDocumentBrowseStore((s) => s.load)
  const startProfilingRun = useDocumentBrowseStore((s) => s.start)
  const [checked, setChecked] = useState<string[]>([])

  const allLeaves = useMemo(
    () =>
      (data?.folders ?? []).flatMap((f) =>
        f.documents.map((d) => leafKey(f.folder_id, d.document_id)),
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
      data.folders.flatMap((f) =>
        f.documents.map((d) => leafKey(f.folder_id, d.document_id)),
      ),
    )
  }, [data])

  const treeData: TreeDataNode[] = (data?.folders ?? []).map((f) => ({
    key: `d:${f.folder_id}`,
    title: (
      <span className="cat-tree-row">
        <strong className="cat-tree-dataset">{f.name}</strong>
        <span className="cat-tree-count">{f.document_count} document(s)</span>
      </span>
    ),
    children: f.documents.map((d) => ({
      key: leafKey(f.folder_id, d.document_id),
      /* The filename is what the run acts on; what the document *is* and which
         entity it maps to is what makes the list readable — the structured
         twin shows the view's label and grain for the same reason. */
      title: (
        <span className="cat-tree-row">
          <span className="cat-tree-lead">
            <span>
              <Tag className="cat-tree-kind">{fileKind(d.mime_type)}</Tag>
              <span className="cat-tree-table">{d.name}</span>
            </span>
            <span className="cat-tree-grain">
              {d.doc_type_label} · {d.linked_entity}
            </span>
          </span>
          <span className="cat-tree-count">
            {d.pages} page(s)
            {d.profiled ? ' · profiled' : ''}
          </span>
        </span>
      ),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('f:'))

  async function startProfiling() {
    const result = await startProfilingRun(
      source.sourceId,
      selected.map(parseLeaf),
      false,
    )
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    const { job } = result
    const queued = job.objects.filter((o) => o.state === 'pending').length
    const skipped = job.objects.filter((o) => o.state === 'skipped').length
    message.success(
      queued === 0
        ? `Nothing to profile — ${skipped} document(s) already profiled. Use Force on the run in Profiling jobs to redo them.`
        : `Queued ${queued} document(s) — job ${job.short_id} is starting.` +
            (skipped > 0 ? ` ${skipped} already profiled, skipped.` : ''),
    )
    onProfiled()
  }

  return (
    <div className="cat-browse">
      <Flex justify="flex-end">
        <Button type="link" size="small" icon={<CloseOutlined />} onClick={onClose}>
          close
        </Button>
      </Flex>

      {loading ? (
        <Spin />
      ) : (
        <>
          <Typography.Paragraph className="cat-browse-hint">
            {data?.object_count ?? 0} document(s) across {data?.folder_count ?? 0}{' '}
            folder(s). Uncheck any document — or a whole folder — to exclude it from
            this extraction run.
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

          <Flex align="center" justify="space-between" wrap gap={10} className="cat-browse-foot">
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
              {selected.length} of {allLeaves.length} selected
            </Typography.Text>
          </Flex>
        </>
      )}
    </div>
  )
}
