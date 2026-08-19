import { Checkbox, Col, Row } from 'antd'
import type { AnswerRequirementOptions, Citations } from '../api/client'
import { SP } from '../theme'
import '../pages/AskPage.css'

/**
 * Ask's **Answer requirements** tab: what a reader wants an answer to carry.
 *
 * This was step 6 of the New Graph wizard, where the use case declared it once for
 * every answer it would ever give. It moved here because the reader asking is the one
 * who knows what they need *this* answer to be — and because a declaration nothing
 * checks is worth less than a request something reports on. The choice travels with
 * the question, and the answer says whether it was met.
 *
 * **Both halves of the honesty are the server's.** The options are served
 * (`GET /ask`), not written here, for the reason the consent screen renders the scopes
 * the endpoint returned: a list held in a component can offer a value `POST /ask`
 * refuses. And the note says which half really applies — citations do, a render format
 * is stated, not applied.
 *
 * Its own component, not a branch inside `AskPage`: a panel behind a parent's tab
 * state cannot be asserted on, because `renderToString` renders the tab that is open.
 */
export default function AnswerRequirementsPanel({
  options,
  citations,
  onCitations,
  formatIds,
  onToggleFormat,
}: {
  options: AnswerRequirementOptions
  /** The effective value — the reader's pick, or the served default. */
  citations: Citations
  onCitations: (citations: Citations) => void
  formatIds: string[]
  onToggleFormat: (formatId: string, on: boolean) => void
}) {
  return (
    <div className="ask-req">
      <div className="ask-req-field">
        <span className="ask-req-label">Citations</span>
        <div className="ask-req-toggles">
          {options.citationsOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`ask-req-toggle${citations === option.value ? ' is-on' : ''}`}
              aria-pressed={citations === option.value}
              onClick={() => onCitations(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ask-req-field">
        <span className="ask-req-label">Answer format by question type</span>

        {options.formats.length === 0 ? (
          <span className="ask-req-empty">
            No answer formats are configured — `graph_answer_formats` in db.json is the
            pool this reads.
          </span>
        ) : (
          <Row gutter={[SP.md, SP.md]}>
            {options.formats.map((f) => (
              <Col key={f.formatId} xs={24} sm={8}>
                <label
                  className={`ask-req-format${formatIds.includes(f.formatId) ? ' is-on' : ''}`}
                >
                  <Checkbox
                    checked={formatIds.includes(f.formatId)}
                    onChange={(e) => onToggleFormat(f.formatId, e.target.checked)}
                  />
                  <span className="ask-req-format-text">
                    <span className="ask-req-format-name">{f.name}</span>
                    <span className="ask-req-format-recipe">{f.format}</span>
                  </span>
                </label>
              </Col>
            ))}
          </Row>
        )}

        {/* The served sentence, not a restatement of it: which half applies is the
            server's claim to make, and it reports on it per answer. */}
        <span className="ask-req-note">{options.note}</span>
      </div>
    </div>
  )
}
