import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import type { AnswerBlock } from '../api/client'
import AnswerChart from './AnswerChart'
import './AnswerBlocks.css'

/*
 * An answer's body, block by block.
 *
 * A recorded answer is prose, figures, a chart and a table in the order the
 * tenant wrote them, so this renders in that order and nothing is reordered or
 * merged. The union is exhaustive: a block kind with no renderer would be a hole
 * in the middle of an answer, so `client.ts` refuses an unknown `type` at the
 * boundary and this file has a branch for every one it can receive.
 */

/**
 * The markdown these answers actually use: `**bold**`, `` `code` ``, and blank-line
 * paragraphs. Deliberately not a markdown library — the audit gate makes one
 * expensive and the corpus uses three constructs.
 *
 * Split rather than replaced-into-HTML: no `dangerouslySetInnerHTML`, so a
 * `<script>` in a db.json edit is text, not markup.
 */
function inline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((piece, i) => {
    const key = `${keyPrefix}-${i}`
    if (piece.startsWith('**') && piece.endsWith('**')) {
      return <strong key={key}>{piece.slice(2, -2)}</strong>
    }
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return <code key={key}>{piece.slice(1, -1)}</code>
    }
    return <span key={key}>{piece}</span>
  })
}

function TextBlock({ markdown }: { markdown: string }) {
  const paragraphs = markdown.split(/\n\s*\n/).filter((p) => p.trim())
  return (
    <div className="ab-text">
      {paragraphs.map((p, i) => {
        // A leading "- " runs the corpus uses for short lists.
        const bullets = p.split('\n').filter((l) => l.trim().startsWith('- '))
        if (bullets.length > 0 && bullets.length === p.split('\n').length) {
          return (
            <ul key={i}>
              {bullets.map((b, j) => (
                <li key={j}>{inline(b.replace(/^\s*-\s*/, ''), `b${i}-${j}`)}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{inline(p, `p${i}`)}</p>
      })}
    </div>
  )
}

/**
 * A row of figures. `flag` ships an icon *and* a word, never colour alone, and
 * uses the reserved status tints because "risk" here genuinely is a state of the
 * thing being reported — unlike a chart series, which never gets one.
 */
function MetricBlock({ items }: { items: Extract<AnswerBlock, { type: 'metric' }>['items'] }) {
  return (
    <ul className="ab-metrics">
      {items.map((m) => (
        <li key={m.label} className={m.flag ? `is-${m.flag}` : undefined}>
          <span className="ab-metric-label">{m.label}</span>
          <span className="ab-metric-value">
            {typeof m.value === 'number' ? m.value.toLocaleString() : m.value}
            {m.unit ? <em>{m.unit}</em> : null}
          </span>
          {m.flag ? (
            <span className={`ab-metric-flag is-${m.flag}`}>
              {m.flag === 'risk' ? <WarningFilled /> : <CheckCircleFilled />}
              {m.flag === 'risk' ? 'risk' : 'good'}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function TableBlock({ block }: { block: Extract<AnswerBlock, { type: 'table' }> }) {
  /* A column whose every cell reads as a number is right-aligned with tabular
     figures, so a column of penalties lines up on its digits. Cells arrive as
     numbers *or* strings, so each is stringified before it is tested — assuming
     a string here was the first version, and it threw on the first real table. */
  const numeric = block.columns.map((_, c) =>
    block.rows.length > 0 &&
    block.rows.every((r) => {
      const raw = r[c]
      if (typeof raw === 'number') return true
      const v = String(raw ?? '').trim()
      return /^[$\s]*-?[\d,.]+%?$/.test(v) && /\d/.test(v)
    }),
  )
  return (
    <figure className="ab-table">
      <figcaption className="ab-chart-title">{block.title}</figcaption>
      {/* Its own scroll container: a 6-column table must never make the page
          scroll sideways. */}
      <div className="ab-table-scroll">
        <table>
          <thead>
            <tr>
              {block.columns.map((c, i) => (
                <th key={c} className={numeric[i] ? 'ab-num' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className={numeric[j] ? 'ab-num' : undefined}>
                    {typeof cell === 'number'
                      ? cell.toLocaleString()
                      : inline(cell, `c${i}-${j}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

/**
 * A paragraph that has not arrived yet.
 *
 * **It is a placeholder for a promise, not an animation over nothing.** The count comes from
 * the summary event's `block_count` — the server knows how many blocks it is about to send,
 * because the answer is composed before the stream opens — so a shimmer stands for a specific
 * paragraph that is genuinely coming. Inventing one would be the same lie as a stage that
 * ticks without a request.
 *
 * Three lines of different widths rather than one bar: a paragraph is ragged, and a single
 * rectangle reads as an image loading.
 */
function PendingBlock() {
  return (
    <div className="ab-block ab-pending" aria-hidden="true">
      <span className="ab-shimmer" style={{ width: '92%' }} />
      <span className="ab-shimmer" style={{ width: '84%' }} />
      <span className="ab-shimmer" style={{ width: '46%' }} />
    </div>
  )
}

export default function AnswerBlocks({
  blocks,
  /** True while more may still arrive, so the last block gets the cursor. */
  streaming = false,
  /**
   * How many paragraphs are still to come — the server's own count, minus what has landed.
   * Drawn as shimmer placeholders, so a 5s gap between paragraphs reads as composition in
   * progress rather than as a page that stopped.
   */
  pending = 0,
}: {
  blocks: AnswerBlock[]
  streaming?: boolean
  pending?: number
}) {
  if (blocks.length === 0 && pending <= 0) return null
  return (
    <div className="ab-blocks">
      {blocks.map((block, i) => (
        <div
          key={`${block.type}-${i}`}
          className={`ab-block${streaming && i === blocks.length - 1 ? ' is-latest' : ''}`}
        >
          {block.type === 'text' ? <TextBlock markdown={block.markdown} /> : null}
          {block.type === 'metric' ? <MetricBlock items={block.items} /> : null}
          {block.type === 'chart' ? <AnswerChart block={block} /> : null}
          {block.type === 'table' ? <TableBlock block={block} /> : null}
        </div>
      ))}
      {Array.from({ length: Math.max(0, pending) }, (_, i) => (
        <PendingBlock key={`pending-${i}`} />
      ))}
    </div>
  )
}
