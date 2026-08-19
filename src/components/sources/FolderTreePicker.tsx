import { FolderOpenOutlined, FolderOutlined } from '@ant-design/icons'
import { Button, Flex, Tree, Typography } from 'antd'
import { useMemo, type ReactNode } from 'react'
import type { PreviewFolder } from '../../api/client'
import { SP } from '../../theme'

/**
 * The folder allowlist, drawn as the tree the drive actually is.
 *
 * A Drive nests, and the flat checkbox list this replaced could not say so: "Louisiana" and
 * "Active matters" sat side by side as peers, so checking one told you nothing about what else it
 * brought with it. The folders arrive flat with a `parent_id` (see `PreviewFolder`) and the tree is
 * built here.
 *
 * **Checking a folder checks the folders inside it**, because that is what a reader means by
 * picking a folder — antd's non-strict checking does it, and the value stays a plain list of the
 * folder ids the register call will be given. A parent is included in that list only when it is
 * fully checked, which is the same rule the drive itself follows: a folder is either in the
 * allowlist or it is not.
 *
 * Its own component, not a block inside the wizard, for the reason every other extracted panel
 * here is: a subtree behind a parent's state cannot be asserted on from outside it.
 */

interface FolderNode extends PreviewFolder {
  children: FolderNode[]
}

/** What antd's `Tree` is handed. Declared rather than inferred: the builder is recursive, and a
 *  self-referential inferred return type is an error under this tsconfig. */
interface TreeNode {
  key: string
  title: ReactNode
  children?: TreeNode[]
}

/** The flat list as a tree. A folder whose parent is not in the list is drawn at the root — the
 *  server refuses that shape at boot, so this is the presentation half of the same rule. */
export function foldersToTree(folders: PreviewFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(
    folders.map((f) => [f.folder_id, { ...f, children: [] }]),
  )
  const roots: FolderNode[] = []
  for (const folder of folders) {
    const node = byId.get(folder.folder_id)
    if (!node) continue
    const parent = folder.parent_id ? byId.get(folder.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Every folder inside this one, and this one. Used for the "with its subfolders" totals. */
function descendants(node: FolderNode): FolderNode[] {
  return [node, ...node.children.flatMap(descendants)]
}

export default function FolderTreePicker({
  folders,
  value,
  onChange,
}: {
  folders: PreviewFolder[]
  value: string[]
  onChange: (folderIds: string[]) => void
}) {
  const roots = useMemo(() => foldersToTree(folders), [folders])
  const nested = folders.filter((f) => f.parent_id).length

  const treeData = useMemo(() => {
    const toNode = (node: FolderNode): TreeNode => {
      const all = descendants(node)
      const docs = all.reduce((s, f) => s + f.document_count, 0)
      const pages = all.reduce((s, f) => s + f.page_count, 0)
      /*
       * Two counts where a folder has folders inside it: its own, and what checking it would
       * actually bring in. One number would be wrong either way — a container folder reading
       * "0 documents" beside two subfolders full of them is the flat list's mistake again.
       */
      const own =
        node.children.length > 0
          ? `${node.document_count} here · ${docs} with subfolders`
          : `${node.document_count} doc(s)`
      return {
        key: node.folder_id,
        title: (
          <span>
            {node.name}{' '}
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              — {own} · {pages} page(s)
            </Typography.Text>
          </span>
        ),
        ...(node.children.length > 0
          ? { children: node.children.map(toNode) }
          : {}),
      }
    }
    return roots.map(toNode)
  }, [roots])

  const allIds = folders.map((f) => f.folder_id)
  const checkedDocs = folders
    .filter((f) => value.includes(f.folder_id))
    .reduce((s, f) => s + f.document_count, 0)

  return (
    <div>
      <Flex align="center" justify="space-between" wrap gap={SP.sm} style={{ marginBottom: SP.sm }}>
        {/* One expression: React splits `{a} of {b}` into separate text nodes, so a summary
            assembled from literals and interpolations cannot be asserted on as the sentence it
            renders as. */}
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {`${value.length} of ${folders.length} folder(s) checked · ${checkedDocs} document(s)` +
            (nested > 0
              ? ` · ${nested} folder(s) sit inside another, and checking a folder checks what is inside it`
              : '')}
        </Typography.Text>
        <span>
          <Button size="small" type="link" onClick={() => onChange(allIds)}>
            Select all
          </Button>
          <Button size="small" type="link" onClick={() => onChange([])}>
            Clear
          </Button>
        </span>
      </Flex>

      <Tree
        checkable
        selectable={false}
        defaultExpandAll
        treeData={treeData}
        checkedKeys={value}
        onCheck={(checked) =>
          onChange(
            (Array.isArray(checked) ? checked : checked.checked).map((k) => String(k)),
          )
        }
        icon={({ expanded }: { expanded?: boolean }) =>
          expanded ? <FolderOpenOutlined /> : <FolderOutlined />
        }
        showIcon
      />
    </div>
  )
}
