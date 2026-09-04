import {
  App,
  Button,
  Col,
  Flex,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SourceRow } from '../api/client'
import { useBrowseStore, useJobsStore } from '../store/catalogStore'
import { selectSources, useSourcesStore } from '../store/sourcesStore'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import ConnectorIcon from '../components/common/ConnectorIcon'
import DataModelTab from '../components/catalog/DataModelTab'
import DocumentBrowsePanel from '../components/catalog/DocumentBrowsePanel'
import MailBrowsePanel from '../components/catalog/MailBrowsePanel'
import NoSourceConnected from '../components/common/NoSourceConnected'
import PageHeader from '../components/common/PageHeader'
import ProfiledColumnsPanel from '../components/catalog/ProfiledColumnsPanel'
import ProfiledDocumentsPanel from '../components/catalog/ProfiledDocumentsPanel'
import ProfiledMailDocumentsPanel from '../components/catalog/ProfiledMailDocumentsPanel'
import ProfilingJobsTab from '../components/catalog/ProfilingJobsTab'
import SchemaUploadPanel from '../components/catalog/SchemaUploadPanel'
import StatusTag from '../components/common/StatusTag'
import { catalogUnitsFor, type CatalogPanel } from '../data/catalogUnits'
import { CONFIRM_WIDTH, profilingOutcome } from '../data/profilingOutcome'
import { SP } from '../theme'
import './CatalogPage.css'
import { rowCountLabel } from '../data/rowCount'

/* Tree keys encode the pair so a leaf can be turned back into an object. */
const leafKey = (dataset: string, table: string) => `t:${dataset}::${table}`
const parseLeaf = (key: string) => {
  const [dataset_id, table_id] = key.slice(2).split('::')
  return { dataset_id, table_id }
}

function StatBox({
  label,
  value,
  note,
  mono,
}: {
  label: string
  value: string
  note: string
  mono?: boolean
}) {
  return (
    <div className="cat-stat">
      <span className="cat-stat-label">{label}</span>
      <span className={`cat-stat-value${mono ? ' is-mono' : ''}`}>{value}</span>
      <span className="cat-stat-note">{note}</span>
    </div>
  )
}

/* ---------------- Browse & profile panel ---------------- */

function BrowsePanel({
  source,
  onProfiled,
}: {
  source: SourceRow
  onProfiled: () => void
}) {
  const { message, modal } = App.useApp()
  const data = useBrowseStore((s) => s.data)
  const loading = useBrowseStore((s) => s.loading)
  const browseError = useBrowseStore((s) => s.error)
  const running = useBrowseStore((s) => s.starting)
  const loadBrowse = useBrowseStore((s) => s.load)
  const startProfilingRun = useBrowseStore((s) => s.start)
  const [checked, setChecked] = useState<string[]>([])

  const allLeaves = useMemo(
    () =>
      (data?.datasets ?? []).flatMap((d) =>
        d.tables.map((t) => leafKey(d.dataset_id, t.table_id)),
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
      data.datasets.flatMap((d) =>
        d.tables.map((t) => leafKey(d.dataset_id, t.table_id)),
      ),
    )
  }, [data])

  const treeData: TreeDataNode[] = (data?.datasets ?? []).map((d) => ({
    key: `d:${d.dataset_id}`,
    title: (
      <span className="cat-tree-row">
        <strong className="cat-tree-dataset">{d.dataset_id}</strong>
        <span className="cat-tree-count">{d.table_count} object(s)</span>
      </span>
    ),
    children: d.tables.map((t) => ({
      key: leafKey(d.dataset_id, t.table_id),
      /* The id is what the run acts on, so it leads; the label and the grain
         are what tell a reader whether this is the view they meant. */
      title: (
        <span className="cat-tree-row">
          <span className="cat-tree-lead">
            <span>
              <Tag className="cat-tree-kind">{t.type}</Tag>
              <span className="cat-tree-table">{t.table_id}</span>
              <span className="cat-tree-label">{t.label}</span>
            </span>
            <span className="cat-tree-grain">{t.grain}</span>
          </span>
          <span className="cat-tree-count">
            {t.columns} col(s) · {rowCountLabel(t.rows)}
            {t.profiled ? ' · profiled' : ''}
          </span>
        </span>
      ),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('t:'))

  /**
   * Starts a run, and reports what it did.
   *
   * When everything picked was already profiled the run does nothing, and the old message sent the
   * reader to another tab to press Force on the job that had just done nothing — without ever
   * saying *which* objects were already profiled. Both are answered here instead: the objects are
   * named, and re-profiling is offered as the confirm on that same dialog. `force` still only ever
   * leaves this panel as a **deliberate second act**, never on the first click.
   */
  async function startProfiling(force = false) {
    const result = await startProfilingRun(source.sourceId, selected.map(parseLeaf), force)
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    const { job } = result
    const outcome = profilingOutcome(job.objects, 'table', job.short_id)
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
            {data?.object_count ?? 0} object(s) across {data?.dataset_count ?? 0}{' '}
            dataset(s). Uncheck any table — or a whole dataset — to exclude it from
            this profiling run.
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

/* ---------------- Catalog tab ---------------- */

function CatalogTab({
  sources,
  loading,
  onChanged,
}: {
  sources: SourceRow[]
  loading: boolean
  onChanged: () => void
}) {
  /*
   * **A source with no profiler is left out of the catalogue, and the omission is stated.**
   *
   * The Catalog is a dictionary of what a source holds, and a mailbox holds nothing it can describe:
   * it is connected so a report can be delivered from it. It used to appear here with both its buttons
   * greyed and nothing saying why, which reads as a profiler that failed rather than as a source that
   * has no catalogue — and the greying tested `kind !== 'bigquery' && !isDrive`, a pair of names
   * written into this component that a third profilable connector would have to be added to by hand.
   *
   * `profilable` is the server's answer, derived from whether a pipeline exists for the kind. A list
   * that is simply shorter is not a message, so the count is said in words below the list.
   */
  const catalogued = useMemo(
    /* Both halves: the server says whether a pipeline exists, and `catalogUnitsFor` says
       whether *this build* knows what to call what it holds. A row past the first test and not
       the second would have to be drawn in some other connector's nouns, which is the
       misidentifying default this repo refuses. */
    () => sources.filter((s) => s.profilable && catalogUnitsFor(s.kind)),
    [sources],
  )
  const uncatalogued = sources.length - catalogued.length
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panel, setPanel] = useState<CatalogPanel>('none')

  const selected =
    catalogued.find((s) => s.sourceId === activeId) ?? catalogued[0] ?? null
  /* Non-null for every row in `catalogued` — that is what the filter above guarantees. */
  const units = selected ? catalogUnitsFor(selected.kind) : null

  /* Which of the two actions is currently showing its panel. Derived from `panel`
     rather than tracked beside it: two pieces of state for one fact is how a button
     comes to look pressed with nothing open under it. */
  const browseOpen = panel === units?.browsePanel
  const dictionaryOpen = panel === units?.dictionaryPanel
  /*
   * The third act, where the connector declares one. `schemaPanel` is optional and only BigQuery
   * has it — a drive and a mailbox have no schema a dictionary could describe — so the test is on
   * the declaration rather than on a connector name, which is the whole reason `catalogUnits`
   * exists. A `panel` of `'none'` must not read as open, hence the explicit undefined check: the
   * two above are safe only because every row declares them.
   */
  const schemaOpen = units?.schemaPanel !== undefined && panel === units.schemaPanel

  // Keep the selection valid when the list changes underneath.
  useEffect(() => {
    if (selected && selected.sourceId !== activeId) setActiveId(selected.sourceId)
  }, [selected, activeId])

  if (!loading && catalogued.length === 0) {
    return (
      <>
        <NoSourceConnected detail="Datasets, documents and messages are discovered from connected sources. Connect a BigQuery project, a Google Drive or a Gmail mailbox and its tables, files or mail will be browsable here." />
        {/* Said even here — especially here. A tenant whose only source is a stubbed connector
            would otherwise read "nothing is connected" one line under a Sources table listing one. */}
        {uncatalogued > 0 ? (
          <Typography.Paragraph className="cat-uncatalogued">
            {`${uncatalogued} connected source${uncatalogued === 1 ? ' is' : 's are'} not catalogued here: there is no profiler behind that connector yet, so there is nothing to describe. It is listed on Sources.`}
          </Typography.Paragraph>
        ) : null}
      </>
    )
  }

  return (
    <Row gutter={[SP.lg, SP.lg]} align="top">
      <Col xs={24} xl={9} xxl={8}>
        <div className="cat-list">
          {catalogued.map((s) => (
            <button
              type="button"
              key={s.sourceId}
              className={`cat-source${s.sourceId === selected?.sourceId ? ' is-active' : ''}`}
              onClick={() => {
                setActiveId(s.sourceId)
                setPanel('none')
              }}
            >
              <span className="cat-source-icon">
                <ConnectorIcon connector={s.connector} size={20} />
              </span>
              <span className="cat-source-body">
                {/* The id leads because it is what every action acts on; the name
                    the user typed is what they recognise, so it rides beside it as
                    a tag. Neutral — a name is not a state. */}
                <span className="cat-source-head">
                  <span className="cat-source-id">{s.sourceId}</span>
                  <span className="cat-source-name">{s.sourceName}</span>
                </span>
                <span className="cat-source-meta">
                  {s.projectAccount} · {catalogUnitsFor(s.kind)?.listCount(s) ?? ''} ·{' '}
                  {s.status}
                </span>
              </span>
            </button>
          ))}
          {/* A list that is merely shorter is not a message — the rule the Library's missing
              governance rows are stated under. A connected source missing from here would
              otherwise show up on Sources and not in the Catalog, with nothing accounting for the
              difference.

              The reason changed when mail got a profiler: the sources this leaves out are now the
              stubbed connectors, which have no pipeline behind them at all. Mail is catalogued
              like a project and a drive. */}
          {uncatalogued > 0 ? (
            <Typography.Text className="cat-list-note">
              {`${uncatalogued} more connected source${uncatalogued === 1 ? '' : 's'} carr${uncatalogued === 1 ? 'ies' : 'y'} no catalogue: there is no profiler behind that connector yet, so there is nothing here to describe. It is listed on Sources.`}
            </Typography.Text>
          ) : null}
          <Typography.Text className="cat-list-note">
            Connecting a new source is an Admin action.
          </Typography.Text>
        </div>
      </Col>

      <Col xs={24} xl={15} xxl={16}>
        {selected ? (
        <div className="cat-detail">
          <Flex align="center" gap={SP.md} wrap className="cat-detail-head">
            <Typography.Text className="cat-detail-id">
              {selected.sourceId}
            </Typography.Text>
            <span className="cat-source-name">{selected.sourceName}</span>
            <StatusTag tone={selected.status === 'connected' ? 'good' : 'neutral'}>
              {selected.status}
            </StatusTag>
          </Flex>

          <Row gutter={[SP.base, SP.base]} style={{ marginBottom: SP.lg }}>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={units?.accountLabel ?? ''}
                value={selected.projectAccount}
                note={units?.accountNote ?? ''}
                mono
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={units?.scopeLabel ?? ''}
                value={String(units?.scopeCount(selected) ?? 0)}
                note="in the allowlist"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={units?.objectsLabel ?? ''}
                value={String(units?.objectsCount(selected) ?? 0)}
                note="for this source"
              />
            </Col>
            {/*
              * The fourth tile is not the same fact on every connector — Gmail states today's
              * runs where the other two state their second unit — so its note comes from the
              * same row as its label rather than being a literal here. "for this source" under
              * a date would be wrong, and a page that knew which connector was which would be
              * the nine ternaries back again.
              */}
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={units?.unitsLabel ?? ''}
                value={String(units?.unitsCount(selected) ?? 0)}
                note={units?.unitsNote(selected) ?? ''}
              />
            </Col>
          </Row>

          {/* Same two moves either way — browse and profile, then read the
              dictionary — in the unit the connector actually holds.

              Both are toggles, and the fill *is* the state: the one whose panel is
              open is the brand orange, the other is white. Neither is permanently
              the primary — that ranking was wrong in both directions, since on a
              source with nothing profiled the browse panel is the only way forward
              and on a profiled one the dictionary is what you came for.

              This carries weight it did not before: the panel no longer has a close
              button, so this is the only thing saying which one is open and the only
              way to close it. Colour never does that alone — `aria-pressed` says the
              same thing to a screen reader, and the note below says it in words. */}
          {/* Neither button carries a `disabled` any more: the list holds only sources that carry a
              catalogue, so a row that is here can always be browsed. They used to test
              `kind !== 'bigquery' && !isDrive` — a pair of connector names written into this component,
              which a third profilable connector would have had to be added to by hand, and which drew a
              mailbox as a source whose buttons happened to be broken. */}
          <Space wrap size={SP.sm} className="cat-actions">
            <Button
              type={browseOpen ? 'primary' : 'default'}
              aria-pressed={browseOpen}
              onClick={() =>
                setPanel(browseOpen ? 'none' : (units?.browsePanel ?? 'none'))
              }
            >
              {units?.browseLabel}
            </Button>
            <Button
              type={dictionaryOpen ? 'primary' : 'default'}
              aria-pressed={dictionaryOpen}
              onClick={() =>
                setPanel(dictionaryOpen ? 'none' : (units?.dictionaryPanel ?? 'none'))
              }
            >
              {units?.dictionaryLabel}
            </Button>
            {/* Drawn only where the connector declares the act, so a mailbox gets two buttons and
                not a third one that could do nothing. */}
            {units?.schemaPanel !== undefined ? (
              <Button
                type={schemaOpen ? 'primary' : 'default'}
                aria-pressed={schemaOpen}
                onClick={() => setPanel(schemaOpen ? 'none' : (units.schemaPanel ?? 'none'))}
              >
                {units.schemaLabel}
              </Button>
            ) : null}
          </Space>

          {/* Said once, where the panels open. The ✕ that used to sit inside each panel is gone,
              so the way back has to be stated somewhere — and only while something is open, or it
              is an instruction for a state the reader is not in. */}
          {browseOpen || dictionaryOpen || schemaOpen ? (
            <Typography.Paragraph className="cat-actions-hint">
              Click the same button again to close the panel.
            </Typography.Paragraph>
          ) : null}

          {/* No panel takes an `onClose`: the button that opened it is the control
              that closes it, and a panel with its own ✕ meant two controls for one
              piece of state, only one of which showed what that state was. */}
          {panel === 'browse' ? (
            <BrowsePanel
              key={selected.sourceId}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'columns' ? (
            <ProfiledColumnsPanel key={`${selected.sourceId}-cols`} source={selected} />
          ) : null}

          {/* `onProfiled` is the queued-run path, the same one Start Profiling takes: it re-reads
              the board and switches to the jobs tab, because a queued job is otherwise invisible
              from here. */}
          {panel === 'schema' ? (
            <SchemaUploadPanel
              key={`${selected.sourceId}-schema`}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'browse-documents' ? (
            <DocumentBrowsePanel
              key={`${selected.sourceId}-docs-browse`}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'documents' ? (
            <ProfiledDocumentsPanel key={`${selected.sourceId}-docs`} source={selected} />
          ) : null}

          {panel === 'browse-mail-documents' ? (
            <MailBrowsePanel
              key={`${selected.sourceId}-mail-browse`}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'mail-documents' ? (
            <ProfiledMailDocumentsPanel
              key={`${selected.sourceId}-mail`}
              source={selected}
            />
          ) : null}

          <Typography.Paragraph className="cat-detail-foot">
            {units?.foot(selected)}
          </Typography.Paragraph>
        </div>
        ) : null}
      </Col>
    </Row>
  )
}

/* ---------------- Page ---------------- */

export default function CatalogPage() {
  const error = useSourcesStore((s) => s.error)
  const loading = useSourcesStore((s) => s.loading)
  const load = useSourcesStore((s) => s.load)
  const sources = useSourcesStore(selectSources)

  /* The board's own loader. A queued run has to tell it, because its poll has stopped by
     then — see `handleQueued`. */
  const loadJobs = useJobsStore((s) => s.load)

  const [tab, setTab] = useState('catalog')
  const [running, setRunning] = useState(0)

  useEffect(() => {
    void load()
  }, [load])

  // Profiling moves the source counters, so refresh them when a run settles.
  const handleChanged = useCallback(() => {
    void load()
  }, [load])

  /*
   * Starting a run switches to the jobs board — that is where the pipeline is visible, and a
   * queued job is otherwise invisible from the Catalog tab.
   *
   * **And the board is re-read here, not left to its own poll.** It loads on mount and then
   * polls only while `active_count > 0`, so the poll that sees 0 stops the loop — which is
   * right for a board nobody is adding to, and wrong the moment a second run is queued while
   * the tab is already open. That is exactly the re-profile confirm: the first click switched
   * here with an all-skipped job that completed instantly, the loop stopped, and pressing
   * "Profile 5 table(s) again" then queued a run on the server that this list never asked
   * about. The run was real; the board was stale, which reads as a click that did nothing.
   */
  const handleQueued = useCallback(() => {
    void load()
    void loadJobs()
    setTab('jobs')
  }, [load, loadJobs])

  return (
    <>
      <PageHeader
        title="Data Catalog"
        subtitle="Browse and curate every source registered across the platform — BigQuery tables and fields, Google Drive documents, and the documents attached to a Gmail mailbox — describing, tagging, and keeping metadata accurate."
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'catalog',
              label: 'Catalog',
              children: (
                <CatalogTab
                  sources={sources}
                  loading={loading}
                  onChanged={handleQueued}
                />
              ),
            },
            {
              /*
               * **The Catalog's third act, and it comes third for a reason.** Browse says what a
               * source holds and the dictionary describes it column by column; Data Modeling is
               * where a curator says what a table *is* — the entity it stands for, the column that
               * identifies a row, and its relationships to the other tables.
               *
               * It draws over what a profiling run recorded, so it is downstream of the first tab
               * rather than beside it, and it says so on a source with nothing profiled instead of
               * drawing an empty canvas.
               */
              key: 'model',
              label: 'Data Modeling',
              children: <DataModelTab sources={sources} loading={loading} />,
            },
            {
              key: 'jobs',
              label:
                running > 0 ? `Profiling jobs (${running} running)` : 'Profiling jobs',
              children: (
                <ProfilingJobsTab
                  onChanged={handleChanged}
                  onActiveCount={setRunning}
                />
              ),
            },
          ]}
        />
      )}
    </>
  )
}
