import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Col,
  Flex,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProfilingJob, SourceRow } from '../api/client'
import {
  useBrowseStore,
  useJobsStore,
  useDriveProcessStore,
  useMailProcessStore,
  useSchemaUploadStore,
} from '../store/catalogStore'
import { selectSources, useSourcesStore } from '../store/sourcesStore'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import ConnectorIcon from '../components/common/ConnectorIcon'
import DataModelTab from '../components/catalog/DataModelTab'
import { DictionaryUploadControl } from '../components/catalog/DatasetDictionaryUpload'
import DocumentBrowsePanel from '../components/catalog/DocumentBrowsePanel'
import DriveProcessPanel from '../components/catalog/DriveProcessPanel'
import MailProcessPanel from '../components/catalog/MailProcessPanel'
import NoSourceConnected from '../components/common/NoSourceConnected'
import PageHeader from '../components/common/PageHeader'
import ProfiledColumnsPanel from '../components/catalog/ProfiledColumnsPanel'
import ProfiledMailDocumentsPanel from '../components/catalog/ProfiledMailDocumentsPanel'
import ProfilingJobsTab from '../components/catalog/ProfilingJobsTab'
import StatusTag from '../components/common/StatusTag'
import { catalogUnitsFor, type CatalogPanel } from '../data/catalogUnits'
import { CONFIRM_WIDTH, profilingOutcome } from '../data/profilingOutcome'
import {
  dictionaryRefused,
  dictionaryRunSummary,
  schemaUploadCopy,
  type AppliedDictionary,
} from '../data/schemaUpload'
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
  suffix,
  note,
  mono,
}: {
  label: string
  value: string
  /**
   * The unit, set small beside the figure — `79k` **chars**.
   *
   * Only where the label does not already carry it: *documents chunked* and *labels allowed* say
   * their unit in the label, so their figure stands alone. *chunk size* names the measure instead,
   * which leaves the unit belonging to the number.
   */
  suffix?: string
  note: string
  mono?: boolean
}) {
  return (
    <div className="cat-stat">
      <span className="cat-stat-label">{label}</span>
      <span className={`cat-stat-value${mono ? ' is-mono' : ''}`}>
        {value}
        {suffix ? <span className="cat-stat-unit">{suffix}</span> : null}
      </span>
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
  /*
   * The dictionaries read against this source's datasets, and the two things Start Profiling needs
   * from them. Selected field by field, so a read of one dataset does not re-render the tree.
   */
  const staged = useSchemaUploadStore((s) => s.staged)
  const applying = useSchemaUploadStore((s) => s.applying)
  const dictionaryError = useSchemaUploadStore((s) => s.error)
  const applyStaged = useSchemaUploadStore((s) => s.applyStaged)
  const resetDictionaries = useSchemaUploadStore((s) => s.reset)

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

  /*
   * **A staged dictionary belongs to the source it was read against.** The read resolved its tables
   * against *this* source's project and allowlist, so carrying one over to another source would
   * offer to apply a report that was never computed for it. The panel is keyed by source id, so this
   * runs on arrival either way; it is here rather than left to the key because the store is a
   * module-level singleton and unmounting a component does not clear one.
   */
  useEffect(() => {
    resetDictionaries()
  }, [resetDictionaries, source.sourceId])

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
        {/* **The upload sits on the dataset**, because a dictionary lands on one dataset's tables.
            It used to be a source-level button whose panel then asked which dataset, from a Select
            the reader met after they had been looking at this very list. */}
        <DictionaryUploadControl
          source={source}
          datasetId={d.dataset_id}
          /* The one thing a landed file now produces. Raised here rather than in the control,
             because this panel is where every other message about this tree is raised from. */
          onUploaded={(filename) => message.success(schemaUploadCopy.uploaded(filename))}
        />
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
   *
   * **Two acts, one job, one thing to watch.** Where a dictionary has been read, the write and the
   * run are the *same request*: it lands the dictionary and queues one pipeline over its tables
   * **and** the rest of the selection. This used to be two calls and therefore two jobs — 12
   * dictionary tables in one and the dataset's other 6 in another, from a single press, with
   * nothing on the board saying which was which or when profiling had finished. Reported from use.
   * The order inside that one request still matters and the server keeps it: the dictionary is
   * written before the run is queued, because profiling first would profile the columns it was
   * about to replace.
   *
   * **One sentence for one job.** `dictionaryRunSummary` names the files that landed and then
   * carries `profilingOutcome`'s own text for the run, which *names* the objects it skipped.
   */
  async function startProfiling(force = false) {
    const objects = selected.map(parseLeaf)

    /*
     * One call either way, and both of them answer with the one job to watch. Everything checked
     * travels with the write: the server drops what a dictionary already covers rather than
     * queueing it twice, which is the double count `commitNextObject` updates in place to avoid.
     *
     * The two branches are written out rather than folded into one `await`, because their results
     * are different shapes and narrowing a union of two by a key in it is how a payload field comes
     * to be read as `unknown`.
     */
    let job: ProfilingJob
    let applied: AppliedDictionary[] = []
    if (Object.keys(staged).length > 0) {
      const result = await applyStaged(source.sourceId, objects, force)
      if (!result.ok) {
        /* A refused write left nothing behind and everything staged — a different fact from a run
           that could not start, and said in different words. */
        message.error(dictionaryRefused(result.error))
        return
      }
      job = result.job
      applied = result.applied
    } else {
      const result = await startProfilingRun(source.sourceId, objects, force)
      if (!result.ok) {
        message.warning(result.error)
        return
      }
      job = result.job
    }
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
      /* One message either way, and the dictionaries are a clause of it rather than a toast of
         their own: the run they are reported beside is the run they are in. A dictionary's own
         tables are never skipped, so the confirm branch above cannot be reached with one staged. */
      message.success(
        applied.length > 0 ? dictionaryRunSummary(applied, outcome.text) : outcome.text,
      )
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

          {/* The dictionary act, said where its controls are. */}
          <Typography.Paragraph className="cat-browse-hint">
            {schemaUploadCopy.lead}
          </Typography.Paragraph>

          <Typography.Paragraph type="secondary" className="cat-browse-formats">
            {schemaUploadCopy.formats}
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

          {/* The browser's refusal and the parser's land in one field, because from here they
              answer one question: why did my file not take. The sentence names its own file. */}
          {dictionaryError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: SP.base }}
              title={dictionaryError}
            />
          ) : null}

          {/*
            **The dictionary report stood here and is gone — removed on request.**

            It was drawn inline first and then as a dialog that opened itself on a landed read;
            both are removed, and a file that lands raises a toast instead. `reportFor` went with
            it, because a piece of state naming which dialog is open is an invitation for the
            dialog to come back. What it cost is recorded in `DatasetDictionaryUpload.tsx`, beside
            the components that drew it.
          */}

          {/* Start Profiling's own promise, stated only while it has a dictionary to keep it. */}
          {Object.keys(staged).length > 0 ? (
            <Typography.Paragraph type="secondary" className="cat-browse-formats">
              {schemaUploadCopy.applyNote}
            </Typography.Paragraph>
          ) : null}

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
                /* Both acts: writing a dictionary is the slower of the two, and a button that
                   looked idle through it would read as a click that did nothing. */
                loading={running || applying}
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
  onCountsChanged,
}: {
  sources: SourceRow[]
  loading: boolean
  /**
   * A run was **queued**: re-read the sources *and* switch to the jobs board, because a queued job
   * is otherwise invisible from this tab.
   */
  onChanged: () => void
  /**
   * A run **settled**: re-read the sources and nothing else.
   *
   * **Two callbacks because they are two acts, and one of them must not switch tabs.** Gmail's run
   * is deliberately absent from the Profiling jobs board and is narrated on this tab instead, so
   * sending a reader there when it lands would put them on a list that cannot contain the run they
   * were just watching. Wiring `onChanged` here was the obvious one-line fix and is the wrong one
   * for exactly that reason.
   */
  onCountsChanged: () => void
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
  const { message } = App.useApp()
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
  /* The source list's own collapse, independent of the sidebar's — a reader who has already
     picked a source may want the detail panel's room back without losing the pinned card
     entirely, so it narrows to an icon rail rather than disappearing. No persistence, matching
     the sidebar's own toggle: this is a working control, not a remembered preference. */
  const [listCollapsed, setListCollapsed] = useState(false)

  const selected =
    catalogued.find((s) => s.sourceId === activeId) ?? catalogued[0] ?? null
  /* Non-null for every row in `catalogued` — that is what the filter above guarantees. */
  const units = selected ? catalogUnitsFor(selected.kind) : null

  /*
   * Gmail's *Process documents*: no selection, so the whole mailbox, and the page owns only the
   * call. The store holds the in-flight flag; the outcome is a message and a reload, which is what
   * `onChanged` already does for every other run.
   */
  const processingMail = useMailProcessStore((s) => s.starting)
  const processMail = useMailProcessStore((s) => s.process)
  const processingDrive = useDriveProcessStore((s) => s.starting)
  const processDrive = useDriveProcessStore((s) => s.process)
  /* Either run may be the one in flight, and only one connector is selected at a time. */
  const processing = processingMail || processingDrive
  const processDocuments = useCallback(async () => {
    if (!selected) return
    /*
     * **Which run, from the row's own `runPanel`** — never `kind`, which is the connector-name
     * ternary this table exists to stop. Both acts are the same shape: no selection, so the whole
     * mailbox or the whole drive, and the page owns only the call.
     */
    const units = catalogUnitsFor(selected.kind)
    const drive = units?.runPanel === 'drive-run'
    const result = drive
      ? await processDrive(selected.sourceId, false)
      : await processMail(selected.sourceId, false)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(
      `Processing ${result.job.objects.length} document(s) from this ${drive ? 'drive' : 'mailbox'}.`,
    )
    /*
     * **Deliberately not `handleQueued()`.** That re-reads the sources *and switches to Profiling
     * jobs* — which is right for every other run and wrong for this one: a mail job is excluded
     * from that board on purpose, so sending a reader there would land them on a list that does
     * not contain the run they just started. The run is narrated right below this button instead,
     * by `MailProcessPanel`, which holds the job the store just kept and polls it from here.
     *
     * **Nothing is re-read here, because nothing has changed yet.** A queued run has moved no
     * counter; the figures land when it *completes*, and the panel calls `onProcessed` then. This
     * comment used to say the outcome was "a message and a reload", and the reload was the half
     * that did not exist — which left every tile at 0 over a finished run.
     */
  }, [selected, processMail, processDrive, message])

  /* Which of the two actions is currently showing its panel. Derived from `panel`
     rather than tracked beside it: two pieces of state for one fact is how a button
     comes to look pressed with nothing open under it. **`browsePanel` is `null` for a
     connector whose first act is a run, and `panel` is never `null`, so `browseOpen`
     is correctly false for it rather than accidentally true when nothing is open.** */
  const browseOpen = units?.browsePanel != null && panel === units.browsePanel
  /* Null-guarded like `browseOpen`: a connector may declare no second panel, and `panel` is
     never null, so two absent values must not compare equal into a pressed-looking button. */
  const dictionaryOpen =
    units?.dictionaryPanel != null && panel === units.dictionaryPanel
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
      <Col xs={24} xl={listCollapsed ? 2 : 9} xxl={listCollapsed ? 2 : 8}>
        <div className={`cat-list${listCollapsed ? ' is-collapsed' : ''}`}>
          {/* The one control that opens and closes this card — colour is never the only
              signal, so the icon flips direction and the tooltip says which act it is. */}
          <Tooltip title={listCollapsed ? 'Expand source list' : 'Collapse source list'}>
            <button
              type="button"
              className="cat-list-collapse-btn"
              aria-label={listCollapsed ? 'Expand source list' : 'Collapse source list'}
              aria-pressed={listCollapsed}
              onClick={() => setListCollapsed((v) => !v)}
            >
              {listCollapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
            </button>
          </Tooltip>

          {listCollapsed
            ? catalogued.map((s) => (
                <Tooltip key={s.sourceId} title={`${s.sourceId} · ${s.sourceName}`} placement="right">
                  <button
                    type="button"
                    className={`cat-source cat-source-mini${s.sourceId === selected?.sourceId ? ' is-active' : ''}`}
                    aria-label={s.sourceId}
                    onClick={() => {
                      setActiveId(s.sourceId)
                      setPanel('none')
                    }}
                  >
                    <span className="cat-source-icon">
                      <ConnectorIcon connector={s.connector} size={20} />
                    </span>
                  </button>
                </Tooltip>
              ))
            : catalogued.map((s) => (
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
              like a project and a drive.

              Neither note is drawn collapsed: a sentence has nowhere to fit in an icon rail, and
              both are restated the moment the card is expanded again — nothing here is lost. */}
          {!listCollapsed && uncatalogued > 0 ? (
            <Typography.Text className="cat-list-note">
              {`${uncatalogued} more connected source${uncatalogued === 1 ? '' : 's'} carr${uncatalogued === 1 ? 'ies' : 'y'} no catalogue: there is no profiler behind that connector yet, so there is nothing here to describe. It is listed on Sources.`}
            </Typography.Text>
          ) : null}
          {!listCollapsed ? (
            <Typography.Text className="cat-list-note">
              Connecting a new source is an Admin action.
            </Typography.Text>
          ) : null}
        </div>
      </Col>

      <Col xs={24} xl={listCollapsed ? 22 : 15} xxl={listCollapsed ? 22 : 16}>
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
            {/*
              * **The allowlist tile, where the connector declares one.** Gmail does not: its
              * labels are settled by the consent rather than picked, and nothing narrows a run by
              * them, so a tile counting them would state a scope that does not exist. Read off
              * the row like every other tile, and an absent one simply draws no column.
              */}
            {units?.scopeTile ? (
              <Col xs={24} sm={12} lg={6}>
                <StatBox
                  label={units.scopeTile.label}
                  value={String(units.scopeTile.count(selected))}
                  note={units.scopeTile.note}
                />
              </Col>
            ) : null}
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={units?.objectsLabel ?? ''}
                value={String(units?.objectsCount(selected) ?? 0)}
                /* The connector's own second figure where it has one — Gmail states its chunk
                   total here — and "for this source" where it does not. Declared beside the
                   label rather than chosen here, for the reason the fourth tile's note is. */
                note={units?.objectsNote?.(selected) ?? 'for this source'}
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
            {/*
              * **A further tile where the connector declares one**, and no gap where it does not.
              *
              * Gmail states its *chunk size* here — the extracted text of everything it has
              * processed, which `chunk_chars` has always carried and nothing drew. Rendered from
              * the same `catalogUnits` row as the rest, so the page still knows nothing about
              * which connector is which; an absent `extraTile` simply draws no column.
              *
              * **The strip is `lg={6}` and stays that way**, which is a correction on record. It
              * was briefly `flex="1 1 180px"`, on the reasoning that 24 does not divide by five so
              * a fifth tile would drop to a row of its own and read as one that failed to load.
              * The render said otherwise: `flex-grow` made the wrapped tile fill its whole line,
              * so what actually read as broken was a stat card at double width. A quarter-width
              * card wrapping onto the second row is an ordinary grid and looks like one. Every
              * connector declares four tiles today in any case — Gmail trades its allowlist for
              * this one — so the strip is exactly full either way.
              */}
            {units?.extraTile ? (
              <Col xs={24} sm={12} lg={6}>
                <StatBox
                  label={units.extraTile.label}
                  value={units.extraTile.value(selected)}
                  suffix={units.extraTile.suffix}
                  note={units.extraTile.note}
                />
              </Col>
            ) : null}
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
            {/*
              **One button, two kinds of act, decided by the data rather than by a connector name.**
              A connector whose `browsePanel` is `null` has no panel to open — its first act is a
              run — so the button *does* the thing instead of toggling. Gmail is the one: its
              labels are settled by the consent and its documents are whatever was attached, so
              there was never a selection worth putting to a reader. Testing the connector name
              here is the ternary `catalogUnits` exists to stop.
            */}
            {units && units.browsePanel === null ? (
              <Button
                type="primary"
                loading={processing}
                onClick={() => void processDocuments()}
              >
                {units.browseLabel}
              </Button>
            ) : (
              <Button
                type={browseOpen ? 'primary' : 'default'}
                aria-pressed={browseOpen}
                onClick={() =>
                  setPanel(browseOpen ? 'none' : (units?.browsePanel ?? 'none'))
                }
              >
                {units?.browseLabel}
              </Button>
            )}
            {/* Withheld where the connector declares no second panel — Gmail lists its documents
                on this page, under the run that produced them, so a button opening a second view
                of them was opening what is already there. An absent control, never a disabled
                one, which is the rule a Library row's acts already keep. */}
            {units?.dictionaryPanel ? (
              <Button
                type={dictionaryOpen ? 'primary' : 'default'}
                aria-pressed={dictionaryOpen}
                onClick={() =>
                  setPanel(dictionaryOpen ? 'none' : units.dictionaryPanel ?? 'none')
                }
              >
                {units.dictionaryLabel}
              </Button>
            ) : null}
            {/* **And there is no third button.** Uploading a data dictionary was one, with a
                dataset Select inside its panel; it is a control on each dataset's own row in the
                browse panel now — see `DatasetDictionaryUpload`. One act per button, and the act
                that describes a dataset is drawn where the datasets are. */}
          </Space>

          {/* Said once, where the panels open. The ✕ that used to sit inside each panel is gone,
              so the way back has to be stated somewhere — and only while something is open, or it
              is an instruction for a state the reader is not in. */}
          {browseOpen || dictionaryOpen ? (
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

          {panel === 'browse-documents' ? (
            <DocumentBrowsePanel
              key={`${selected.sourceId}-docs-browse`}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {/*
            **Gmail's catalogue is on the page, not behind a button.** Rendered whenever the
            connector declares no browse panel — the same `null` that turned its first button into
            an action — so the run it starts is narrated where it was started, and what that run
            processed is listed underneath. There is nothing to open and nothing to close.

            `ProfiledMailDocumentsPanel` is still on disk with the entity dictionary it draws, and
            now has no caller: the same waiting-for-a-caller state `/change-signals` is in.
          */}
          {/* Which run surface, read off the row rather than switched on a connector name — the
              ternary `catalogUnits` exists to stop, and there are two of these now. */}
          {units?.runPanel === 'drive-run' ? (
            <DriveProcessPanel
              key={`${selected.sourceId}-drive-run`}
              source={selected}
              onProcessed={onCountsChanged}
            />
          ) : null}

          {units?.runPanel === 'mail-run' ? (
            <MailProcessPanel
              key={`${selected.sourceId}-mail-run`}
              source={selected}
              /* The tiles are the source row, which only this reload refreshes — see the panel.
                 `onCountsChanged`, never `onChanged`: the latter switches to the jobs board, which
                 excludes mail runs on purpose. */
              onProcessed={onCountsChanged}
            />
          ) : null}

          {panel === 'mail-documents' ? (
            <ProfiledMailDocumentsPanel
              key={`${selected.sourceId}-mail`}
              source={selected}
            />
          ) : null}

          {/*
            **A drive lists what it has profiled on the page, the way a mailbox does.**

            It sat behind *View profiled documents* — a toggle opening a second view of the
            documents the tiles above were already counting, which is the two-surfaces-for-one-
            record split this repo refuses everywhere. `dictionaryPanel` is `null` on the drive row
            now, so the button is withheld by there being no panel to open rather than by a
            connector name in this page.

            **Keyed on the row's own declarations, never on `kind`.** `browsePanel != null` is what
            separates a drive from a mailbox here: a mailbox's first act is a run and it draws
            `MailProcessPanel` above, a drive still browses its folders — which is a real choice a
            reader makes, and the reason the browse button stays.
          */}


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
                  /* Sources only: a settled mail run moves the counters and must not move the
                     reader off the tab narrating it. */
                  onCountsChanged={handleChanged}
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
