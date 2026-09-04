import { SearchOutlined } from '@ant-design/icons'
import { Col, Empty, Input, Row, Select, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { Connector } from '../../data/connectors'
import {
  connectorDirectoryCopy,
  filterConnectors,
  type ConnectorFilter,
} from '../../data/connectorSearch'
import { SP } from '../../theme'
import './ConnectorDirectory.css'

/*
 * Step 1's connector directory: search, a filter, and a card per connector.
 *
 * **It is a grid of cards rather than a list, because a connector is recognised before it is
 * read.** The mark does most of the work — which is why `ConnectorIcon` refuses to fall back to
 * another vendor's logo, and why the vision cards keep theirs and are dimmed as a whole rather
 * than having their marks withheld.
 *
 * **The two sections stay, and they are the one thing search must not dissolve.** Available and
 * vision is not a tidy grouping, it is the difference between a connector that will register a
 * source and one that will explain why it cannot; a single flat grid ordered by relevance would
 * let a reader click three cards in a row and be told "not yet built" three times. So a search
 * narrows *within* the sections, and a section with nothing left in it is dropped rather than
 * drawn as an empty heading — the rule the sidebar's nav groups already follow.
 *
 * **There were briefly three**, splitting the pickable cards into the ones that carry a catalogue
 * and the ones that only register a source. Removed on request. *Available now* covers both kinds
 * now, which is what the heading says — it is a claim about being pickable — and which of them
 * profile is stated on each card and in the step's note, where the reader is looking anyway.
 *
 * **The filtering itself is `filterConnectors`, in `src/data/`.** This component sits inside a
 * `Modal`, which `renderToString` will not traverse, so a predicate written here could not be
 * asserted at all — the same reason the wizard's body was extracted from its dialog in the first
 * place, and the reason this file's words live beside the function rather than in its markup.
 */
export default function ConnectorDirectory({
  connectors,
  selectedKey,
  renderCard,
}: {
  connectors: Connector[]
  /** The card drawn as chosen — either the pick or the blocked one, as step 1 already tracked. */
  selectedKey: string | null
  /* No `onSelect` of its own: `renderCard` already closes over the wizard's `pick`, and a
     second way to choose a card is a second answer to what clicking one does. */
  /** The card itself stays the wizard's, so selection styling has one definition. */
  renderCard: (connector: Connector, selected: boolean) => React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ConnectorFilter>('all')

  const shown = useMemo(
    () => filterConnectors(connectors, query, filter),
    [connectors, query, filter],
  )
  /*
   * The two sections are drawn one after the other, as **direct siblings** — which is not
   * incidental: `ConnectorDirectory.css` spaces them with `.cd-section + .cd-section`, so a wrapper
   * element around either makes it an only child and the two run together with no gap. That shipped
   * for a minute while the sections were mapped from a list; it is a plain pair again.
   */
  const available = shown.filter((c) => c.available)
  const vision = shown.filter((c) => !c.available)

  const section = (heading: string, rows: Connector[]) =>
    rows.length === 0 ? null : (
      <div className="cd-section">
        <Typography.Title level={5} className="cd-heading">
          {heading}
          {/* The count is on the heading, because a section a search has narrowed says nothing
              about how much it is now showing — and a reader who cannot tell a filtered grid
              from the whole directory is reading a different page than they think. */}
          <span className="cd-count">{rows.length}</span>
        </Typography.Title>
        <Row gutter={[SP.sm, SP.sm]}>
          {rows.map((c) => (
            <Col key={c.key} xs={24} sm={12} md={8}>
              {renderCard(c, selectedKey === c.key)}
            </Col>
          ))}
        </Row>
      </div>
    )

  return (
    <div className="cd">
      <div className="cd-controls">
        <Input
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          prefix={<SearchOutlined />}
          placeholder={connectorDirectoryCopy.searchPlaceholder}
          aria-label={connectorDirectoryCopy.searchPlaceholder}
        />
        <Select
          value={filter}
          onChange={setFilter}
          className="cd-filter"
          aria-label={connectorDirectoryCopy.filterLabel}
          options={connectorDirectoryCopy.filterOptions.map((o) => ({
            value: o.value,
            label: `${connectorDirectoryCopy.filterLabel}: ${o.label}`,
          }))}
        />
      </div>

      {shown.length === 0 ? (
        /* Names the query rather than saying "no connectors" — over a grid the reader has just
           narrowed, the bare sentence is indistinguishable from a directory that failed to load. */
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <div>{connectorDirectoryCopy.noMatch(query)}</div>
              <Typography.Text type="secondary">
                {connectorDirectoryCopy.noMatchHint}
              </Typography.Text>
            </>
          }
        />
      ) : (
        <>
          {section(connectorDirectoryCopy.availableHeading, available)}
          {section(connectorDirectoryCopy.visionHeading, vision)}
        </>
      )}
    </div>
  )
}
