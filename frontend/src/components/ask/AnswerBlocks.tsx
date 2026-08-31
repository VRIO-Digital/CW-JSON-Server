import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import type { AnswerBlock } from '../../api/client'
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
 * **Claims read from correspondence — attributed, and never added up.**
 *
 * A runtime source is read when a question needs it, and what it yields is an *observation*:
 * a claim about a subject the graph already holds. The query set is explicit that none of it
 * is merged into the fact set, and its own block notes say so per answer — *"Each is a CLAIM
 * by its sender with the extractor's confidence attached — none of it is counted into any
 * figure above."*
 *
 * So this renders attributed claims and **computes nothing**: no total of the amounts, no
 * count of the months, no average confidence. That is not a styling preference — the moment a
 * reader can read a total off this block, the claims have become a figure, which is the one
 * thing the block exists not to be. Every amount is printed as the single claim's own.
 *
 * Nothing here is a status tint either. A contractor's claim is not a state of the project,
 * and `confidence` is the extractor's, so the band is printed as its own word beside the
 * number rather than tinted good/warn/crit.
 *
 * **An absent field draws nothing**, the rule the studio canvas follows for an absence: 10 of
 * the corpus's 27 rows name no amount and 13 no change order, and a "—" in every such slot
 * reads as a value that failed to load.
 */
function ObservationBlock({
  block,
}: {
  block: Extract<AnswerBlock, { type: 'observation' }>
}) {
  return (
    <figure className="ab-obs">
      <figcaption className="ab-obs-head">
        <span className="ab-obs-label">{block.label}</span>
        {/* What it is read from and when, so a reader knows this is not a stored figure.
            Worded once here rather than per row. */}
        <span className="ab-obs-kind">read at question time · not counted</span>
      </figcaption>
      <ul className="ab-obs-list">
        {block.items.map((it) => (
          <li key={it.message_id} className="ab-obs-item">
            <div className="ab-obs-from">
              <strong>{it.from_name}</strong>
              {it.from_side ? <span className="ab-obs-side">{it.from_side}</span> : null}
              {/* The date only — these are dated claims, and a time of day implies a
                  precision the reader has no use for here. */}
              <time dateTime={it.sent_at}>{it.sent_at.slice(0, 10)}</time>
              {it.change_order ? (
                <span className="ab-obs-co">{it.change_order}</span>
              ) : null}
            </div>
            {it.subject ? <p className="ab-obs-subject">{it.subject}</p> : null}
            <p className="ab-obs-claim">{inline(it.claim, `cl-${it.message_id}`)}</p>
            <div className="ab-obs-marks">
              {it.amount !== null && it.amount !== undefined ? (
                <span className="ab-obs-mark">
                  <em>claims</em> {it.amount.toLocaleString()}
                  {it.amount_basis ? ` (${it.amount_basis})` : ''}
                </span>
              ) : null}
              {it.months !== null && it.months !== undefined ? (
                <span className="ab-obs-mark">
                  <em>schedule</em> {it.months} month{it.months === 1 ? '' : 's'}
                </span>
              ) : null}
              {it.reason_label ? (
                <span className="ab-obs-mark">
                  <em>reason</em> {it.reason_label}
                </span>
              ) : null}
              {it.confidence !== null && it.confidence !== undefined ? (
                <span className="ab-obs-mark">
                  <em>extracted</em> {it.confidence.toFixed(2)}
                  {it.band ? ` · ${it.band}` : ''}
                </span>
              ) : null}
              {/*
                * Where the claim landed, or that it landed nowhere. This one *does* print on
                * the null branch, because "did not resolve" is a finding rather than a
                * missing value — it is the difference between a claim about a known project
                * and a claim about nothing this graph holds.
                */}
              <span className="ab-obs-mark">
                <em>{it.resolved_to ? 'resolved to' : 'resolved'}</em>{' '}
                {it.resolved_to ?? 'nothing in this graph'}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {block.note ? <p className="ab-obs-note">{inline(block.note, 'obs-note')}</p> : null}
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
          {block.type === 'observation' ? <ObservationBlock block={block} /> : null}
        </div>
      ))}
      {Array.from({ length: Math.max(0, pending) }, (_, i) => (
        <PendingBlock key={`pending-${i}`} />
      ))}
    </div>
  )
}
