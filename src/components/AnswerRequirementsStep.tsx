import { Checkbox, Col, Row, Spin } from 'antd'
import type { AnswerFormat, Citations, Suggestion } from '../api/client'
import { SP } from '../theme'
import '../pages/NewGraphPage.css'

/*
 * Step 6 of New Graph: what an answer has to carry, and how it renders.
 *
 * Both choices are declared here rather than decided by the engine at runtime —
 * that is the point of the step, and the note under the cards says so.
 */
export default function AnswerRequirementsStep({
  citations,
  onCitations,
  formats,
  loading,
  selected,
  onSelected,
}: {
  citations: Citations
  onCitations: (citations: Citations) => void
  /** Question types drafted from the domain and the brief. */
  formats: Suggestion[]
  loading: boolean
  selected: AnswerFormat[]
  onSelected: (formats: AnswerFormat[]) => void
}) {
  const isOn = (id: string) => selected.some((f) => f.formatId === id)

  function toggle(format: Suggestion, on: boolean) {
    onSelected(
      on
        ? [
            ...selected,
            { formatId: format.id, name: format.name, format: format.detail },
          ]
        : selected.filter((f) => f.formatId !== format.id),
    )
  }

  return (
    <>
      <div className="ng-field">
        <span className="ng-label">Citations</span>
        <div className="ng-toggles">
          {(
            [
              ['required', 'Required — every claim cites its source'],
              ['optional', 'Optional'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`ng-toggle${citations === value ? ' is-on' : ''}`}
              aria-pressed={citations === value}
              onClick={() => onCitations(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ng-field">
        <span className="ng-label">Answer format by question type</span>

        {loading && formats.length === 0 ? (
          <Spin />
        ) : formats.length === 0 ? (
          <span className="ng-empty">
            No question types matched this brief — go back and describe the business
            need, or add a hero question.
          </span>
        ) : (
          <Row gutter={[SP.md, SP.md]}>
            {formats.map((f) => (
              <Col key={f.id} xs={24} sm={8}>
                <label className={`ng-format${isOn(f.id) ? ' is-on' : ''}`}>
                  <Checkbox
                    checked={isOn(f.id)}
                    onChange={(e) => toggle(f, e.target.checked)}
                  />
                  <span className="ng-format-text">
                    <span className="ng-format-name">{f.name}</span>
                    <span className="ng-format-recipe">{f.detail}</span>
                  </span>
                </label>
              </Col>
            ))}
          </Row>
        )}

        <span className="ng-help">
          The use case declares how answers render. The engine never chooses the
          format at runtime.
        </span>
      </div>
    </>
  )
}
