import { TableOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import type { ModelEntity } from '../../api/client'
import type { CanvasEdgeVM } from '../../data/dataModelCanvas'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, type ModelTable } from '../../store/dataModelStore'
import { StatusPill } from './ModelMarks'

interface ModelTableListProps {
  tables: ModelTable[]
  entities: ModelEntity[]
  edges: CanvasEdgeVM[]
  selectedTableKey: string | null
  onSelect: (tableKey: string) => void
}

/**
 * The left rail's compact table list.
 *
 * **Selection is one piece of state, not two.** This list and the canvas are handed the same
 * `selectedTableKey` and the same `onSelect`, both lifted to the tab — so highlighting the other
 * side is "does this row's key match" rather than a second copy to keep in step. There is nothing
 * to sync because there is only one value.
 *
 * A row's pill states the relationships touching that table: confirmed if there are any, otherwise
 * the pending count, otherwise an em dash. Confirmed wins because it is the stronger fact — a table
 * with two declarations and one suggestion is a declared table.
 */
export default function ModelTableList({
  tables,
  entities,
  edges,
  selectedTableKey,
  onSelect,
}: ModelTableListProps) {
  return (
    <div>
      <div
        style={{
          padding: '9px 10px 3px',
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: MT.dim,
        }}
      >
        Tables in this source · {tables.length}
      </div>

      {tables.map((t) => {
        const entity = entityForTable(entities, t.tableKey)
        const touching = edges.filter(
          (e) => e.fromTableKey === t.tableKey || e.toTableKey === t.tableKey,
        )
        const confirmedCount = touching.filter((e) => e.status === 'confirmed').length
        const pendingCount = touching.filter((e) => e.status === 'pending').length
        const selected = t.tableKey === selectedTableKey
        const displayName = entity?.entity_name ?? t.tableId
        return (
          <div
            key={t.tableKey}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(t.tableKey)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                onSelect(t.tableKey)
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 10px',
              borderRadius: MT.rS,
              cursor: 'pointer',
              border: `1px solid ${selected ? MT.orangeLine : 'transparent'}`,
              background: selected ? MT.orangeSoft : undefined,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: selected ? MT.orange : MT.card2,
                color: selected ? '#fff' : MT.mut,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <TableOutlined style={{ fontSize: 13 }} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Tooltip title={displayName}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {displayName}
                </div>
              </Tooltip>
              <div style={{ fontSize: 10.5, color: MT.dim, fontFamily: MT.mono }}>
                {t.tableId} · {t.columns.length} cols
              </div>
            </div>
            <div style={{ flex: 'none' }}>
              {confirmedCount > 0 ? (
                <StatusPill variant="confirmed" icon>
                  {confirmedCount}
                </StatusPill>
              ) : pendingCount > 0 ? (
                <StatusPill variant="suggested">{pendingCount}</StatusPill>
              ) : (
                <StatusPill variant="mut">—</StatusPill>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
