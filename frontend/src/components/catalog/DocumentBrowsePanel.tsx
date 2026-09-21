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
import type { SourceRow } from '../../api/client'
/* One rounding rule for the unit, shared with the mail table and the profiled list. */
import { mailProcessCopy } from '../../data/mailProcess'
import { fileKind } from '../../data/mimeTypes'
import { useDocumentBrowseStore } from '../../store/catalogStore'
import { CONFIRM_WIDTH, profilingOutcome } from '../../data/profilingOutcome'
import '../../pages/CatalogPage.css'

/* Tree keys encode the pair so a leaf can be turned back into an object. */
const leafKey = (folder: string, document: string) => `f:${folder}::${document}`
const parseLeaf = (key: string) => {
  const [folder_id, document_id] = key.slice(2).split('::')
  return { folder_id, document_id }
}

/**
 * The Drive twin of `BrowsePanel`: pick documents, queue a run.
 *
 * Like the table panel it never forces on the first click. Where every document picked has
 * already been extracted the run does nothing, and that is the one place re-profiling is offered
 * from here — named, and as the confirm on a dialog, never silently. Profiling jobs keeps its own
 * per-run Force for a run that has already finished.
 */
export default function DocumentBrowsePanel({
  source,
  onProfiled,
}: {
  source: SourceRow
  onProfiled: () => void
}) {
  const { message, modal } = App.useApp()
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
          {/*
            The run's figures as columns, the way the mail table states them, rather than one prose
            cell. **Em dash where nothing counted** — a document this drive has never chunked has no
            chunk count and no extracted text, and 0 would say it produced none.
          */}
          <span className="cat-tree-figs">
            <span className="cat-tree-fig">{d.pages} pages</span>
            <span className="cat-tree-fig">
              {d.chunks == null ? '—' : `${d.chunks} chunks`}
            </span>
            <span className="cat-tree-fig is-size">
              {d.size_chars == null ? '—' : mailProcessCopy.size(d.size_chars)}
            </span>
            <span className="cat-tree-fig is-status">
              {d.profiled ? <span className="pc-doc-status">processed</span> : null}
            </span>
          </span>
        </span>
      ),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('f:'))

  /** The twin of `BrowsePanel`'s, in documents. Same wording, from `profilingOutcome`. */
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
