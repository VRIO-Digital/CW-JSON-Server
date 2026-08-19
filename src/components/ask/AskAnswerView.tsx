import { Alert } from 'antd'
import type { AskAnswer } from '../api/client'
import AnswerBlocks from './AnswerBlocks'
import StatusTag from './StatusTag'
import { SP } from '../theme'
import '../pages/AskPage.css'

/**
 * One settled answer, as the thread renders it.
 *
 * Extracted from `AskPage` when Ask became a conversation: the page shows a turn per
 * question, and a copy of this markup per turn would drift the moment one of them changed.
 * Its own component is also the only way to assert on it — the page renders the *active*
 * chat, so `renderToString` shows whatever the initial store says, which is nothing.
 *
 * Everything here is the envelope's. Nothing on this component decides anything: the tone
 * comes from `answered`, the evidence line from `requirements`, the caveats from the brief's
 * own gap decisions.
 */
export default function AskAnswerView({ answer }: { answer: AskAnswer }) {
  return (
    <div className="ask-reply">
      {/*
       * An abstention is not an error — it is the graph declining to guess, which is the
       * behaviour the page promises. `warn`, never `crit`.
       */}
      <StatusTag tone={answer.answered ? 'good' : 'warn'}>
        {answer.answered
          ? `answered · confidence ${answer.confidence?.toFixed(2)}`
          : 'abstained'}
      </StatusTag>

      <p className="ask-answer">
        {answer.answered ? (answer.summary ?? answer.answer) : answer.reason}
      </p>

      {/* The body of a recorded answer: prose, figures, chart, table, in the order it was
          written. Empty when the graph walk answered — a walk produces a sentence. */}
      <AnswerBlocks blocks={answer.blocks} />

      {answer.answered && answer.path.length > 0 ? (
        <div className="ask-path">{answer.path.join('  →  ')}</div>
      ) : null}

      <div className="ask-section-title">Reasoning</div>
      <ol className="ask-steps">
        {answer.reasoning.map((s) => (
          <li key={s.step}>
            <strong>{s.step}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>

      {/*
       * Every claim names what it rests on, or the list says so — and what was *required* of
       * this answer is the reader's own pick on the Answer requirements tab, reported back by
       * the server rather than restated here. `satisfied` is computed: citations required
       * plus an answer carrying none is a fact, and it is not dressed up as met.
       *
       * One expression, because `renderToString` splits `text {expr} text` into separate
       * nodes and the sentence is asserted on as the sentence it renders as.
       */}
      <div className="ask-section-title">
        Evidence{' '}
        <em>
          {`${answer.citations.length} citation(s) · citations ${answer.requirements.citations} for this question`}
        </em>
      </div>
      {answer.requirements.satisfied ? null : (
        <StatusTag tone="warn">requirement not met</StatusTag>
      )}
      <div className="ask-note">{answer.requirements.note}</div>

      {answer.citations.length > 0 ? (
        <ul className="ask-citations">
          {answer.citations.map((c) => (
            <li key={c.label}>
              <span className="ask-cite-label">{c.label}</span>
              <span className="ask-cite-detail">{c.detail}</span>
              {/* Only where there is a number. A recorded answer's evidence rows have none,
                  and a placeholder would be an invented score. */}
              {c.confidence !== null ? (
                <span className="ask-cite-conf">{c.confidence.toFixed(2)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="ask-note">Nothing was cited, because nothing was answered.</div>
      )}

      {answer.caveats.length > 0 ? (
        <Alert
          style={{ marginTop: SP.base }}
          type="warning"
          showIcon
          title="What this graph cannot tell you"
          description={answer.caveats.join(' · ')}
        />
      ) : null}
    </div>
  )
}
