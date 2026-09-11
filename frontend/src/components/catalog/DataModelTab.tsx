import {
  DatabaseOutlined,
  ExpandOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Col,
  Row,
  Skeleton,
  Space,
  Spin,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelTableSuggestion, SourceRow } from '../../api/client'
import { acceptAllOutcome } from '../../data/pendingSuggestions'
import {
  confirmedRelationshipsCopy as CONFIRMED_COPY,
  relationDecision,
  unacceptedRelations,
} from '../../data/confirmedRelationships'
import {
  CARDINALITY_LABELS,
  CARDINALITY_UNDETERMINED,
  cardinalityKindFromHint,
  declaredRelationshipsFrom,
  relationshipToCanvasEdge,
  relationshipWrites,
  removeRelationshipWrite,
  type DeclaredRelationship,
} from '../../data/dataModelRelationships'
import {
  TABLE_STATUS_KIND,
  TABLE_UNDECLARED_LABEL,
  tableDeclarationState,
} from '../../data/dataModelStatus'
import { MT } from '../../data/dataModelTokens'
import { useAuthStore } from '../../store/authStore'
import { entityForTable, useDataModelStore } from '../../store/dataModelStore'
import ApiErrorAlert from '../common/ApiErrorAlert'
import ConnectorIcon from '../common/ConnectorIcon'
import EntityCanvas from './EntityCanvas'
import EntityColumnsPanel from './EntityColumnsPanel'
import EntityOverviewPanel from './EntityOverviewPanel'
import EntityRelationshipsPanel from './EntityRelationshipsPanel'
import ModelTableList from './ModelTableList'
import { PanelShell, ProvenanceBadge, StatusPill } from './ModelMarks'
import ConfirmedRelationshipsModal from './ConfirmedRelationshipsPanel'
import PendingSuggestionsModal from './PendingSuggestionsPanel'
import RelationshipModal, { type RelationshipEdit } from './RelationshipModal'

const { Text } = Typography

const DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'columns', label: 'Columns' },
  { key: 'relationships', label: 'Relationships' },
  /* Metrics was the fourth and was removed on request — see the note on `EntityCanvas`'s section. */
] as const
type DetailTabKey = (typeof DETAIL_TABS)[number]['key']

/**
 * One figure in the strip above the canvas, and optionally a way into what it counts.
 *
 * **`onClick` makes it a real `<button>` rather than a `div` with a handler**, so it is reachable by
 * keyboard and announced as an act — a count that opens a review is a control, and the alternative
 * is a number only a mouse can use. Without the prop it renders exactly the static figure it always
 * did: a tile that looked pressable and did nothing would be worse than one that plainly is not,
 * which is why the underline and the pointer are on the same condition as the handler.
 */
function StatItem({
  value,
  label,
  color,
  onClick,
  hint,
}: {
  /* A string as well as a number, so a figure nobody has computed yet can be an em dash rather
     than a 0 — the rule a declared column's null statistics already follow. */
  value: number | string
  label: string
  color?: string
  onClick?: () => void
  hint?: string
}) {
  const body = (
    <>
      <b
        style={{
          fontSize: 16,
          lineHeight: 1.1,
          color: color ?? MT.text,
          textDecoration: onClick ? 'underline dotted' : undefined,
          textUnderlineOffset: 3,
        }}
      >
        {value}
      </b>
      <span style={{ fontSize: 10.5, color: MT.dim }}>{label}</span>
    </>
  )
  if (!onClick) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{body}</div>
    )
  }
  return (
    <Tooltip title={hint}>
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          alignItems: 'flex-start',
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {body}
      </button>
    </Tooltip>
  )
}

interface DataModelTabProps {
  /**
   * Every connected source. This tab keeps the **structured** ones, because a model is tables,
   * columns and relationships — all of which come from a profiled schema. A drive or a
   * mailbox holds documents, so selecting one could only ever say "no profiled tables here": a row
   * that exists to be a dead end.
   */
  sources: SourceRow[]
  loading: boolean
}

/**
 * The Data Modeling tab.
 *
 * Three columns, and each answers a different question. **Left**: which source, and which of its
 * profiled tables. **Centre**: what the model looks like — the counts, and the canvas. **Right**:
 * everything declared about the one table in hand, over four sub-tabs.
 *
 * **Selection is one piece of state.** `selectedTableKey` is handed to the table list and to the
 * canvas, and both call the same setter, so the two can never disagree about what is selected —
 * there is nothing to sync because there is only one value.
 *
 * **A confirmed relationship is the server's; a suggestion is this component's.** The declarations
 * come back on the entities the store loaded, so there is one copy of them and a save re-reads it. A
 * suggestion sits in local state until somebody confirms it, and confirming is the act that writes
 * it — a suggestion nobody accepted is not a declaration and must not be stored as one.
 */
export default function DataModelTab({ sources, loading }: DataModelTabProps) {
  const { message } = App.useApp()
  const tables = useDataModelStore((s) => s.tables)
  const entities = useDataModelStore((s) => s.entities)
  const modelLoading = useDataModelStore((s) => s.loading)
  const modelError = useDataModelStore((s) => s.error)
  const load = useDataModelStore((s) => s.load)
  const save = useDataModelStore((s) => s.save)
  const saveWrites = useDataModelStore((s) => s.saveWrites)
  const acceptAllStored = useDataModelStore((s) => s.acceptAll)
  const suggest = useDataModelStore((s) => s.suggest)
  const saving = useDataModelStore((s) => s.saving)

  const structured = useMemo(
    () => sources.filter((s) => s.kind === 'bigquery' && s.status === 'connected'),
    [sources],
  )
  const skipped = sources.length - structured.length

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTabKey>('overview')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const fitRef = useRef<(() => void) | null>(null)

  /* Suggestions, keyed by source. Local, deliberately — see the component note. */
  const [pendingBySource, setPendingBySource] = useState<
    Record<string, DeclaredRelationship[]>
  >({})
  const [tableSuggestions, setTableSuggestions] = useState<
    Record<string, ModelTableSuggestion>
  >({})
  const [suggesting, setSuggesting] = useState(false)
  /*
   * **Which tables the last run found nothing to join, or `null` before one has been made.**
   *
   * `null` rather than an empty array, because "no orphans" and "nobody has looked" are different
   * facts and only the first is a 0 — the rule a declared column's absent statistics already
   * follow. It is the *server's* answer because only the server sees the whole scan: the list it
   * returns can be cut, so a table whose one suggestion was cut would look orphaned if this were
   * counted off what is on screen. The tab subtracts the tables a stored declaration touches,
   * which is the half the scan cannot know.
   */
  const [suggestOrphans, setSuggestOrphans] = useState<string[] | null>(null)
  /*
   * Sources a run has already been made for, as `sourceId:tableCount`.
   *
   * **The run is automatic now — there is no button** — so this is what stops it firing again on
   * every re-render and every re-read the store makes after a save. The table count is in the key
   * on purpose: profiling more tables is a different schema and deserves a fresh look, and it is
   * the one change a reader makes expecting new suggestions to appear.
   */
  const suggestedFor = useRef<Set<string>>(new Set())

  const [relationshipTarget, setRelationshipTarget] = useState<
    DeclaredRelationship | 'create' | null
  >(null)
  const [createFromTableKey, setCreateFromTableKey] = useState<string | null>(null)

  /*
   * The pending review, and whether its accept-all run is in flight.
   *
   * `acceptingAll` is its own flag rather than the store's `saving`: that one is true for a single
   * write too, so reusing it would put the run's "Confirming" label and its one-at-a-time notice on
   * screen every time somebody saved an Overview field.
   */
  const [pendingOpen, setPendingOpen] = useState(false)
  const [confirmedOpen, setConfirmedOpen] = useState(false)
  const [acceptingAll, setAcceptingAll] = useState(false)
  /*
   * True while one relation's Accept or Reject is in flight. Its own flag rather than the store's
   * `saving`, for the reason `acceptingAll` is one: that is true for a single Overview save too, so
   * reusing it would disable a whole list while somebody edited a text field.
   */
  const [deciding, setDeciding] = useState(false)
  /*
   * True while the relations dialog's own `Accept all` is working down the list. Separate from
   * `acceptingAll`, which is the pending dialog's: the two act on different lists, and one flag
   * would put this run's "Accepting" label on the other dialog's button.
   */
  const [acceptingRelations, setAcceptingRelations] = useState(false)

  /*
   * **Who is accepting, from the browser.** The identity is client-held, so a route cannot look up
   * who is signed in — the rule the consent callback and `saved_by` on a report both established.
   * Without it there is nobody to credit, and the act says so rather than recording an empty name.
   */
  const signedInAs = useAuthStore((s) => s.identity?.email ?? null)

  /* Keep the selection valid as the list arrives or changes underneath. */
  const selectedSource =
    structured.find((s) => s.sourceId === selectedSourceId) ?? structured[0] ?? null
  useEffect(() => {
    if (selectedSource && selectedSource.sourceId !== selectedSourceId) {
      setSelectedSourceId(selectedSource.sourceId)
    }
    if (!selectedSource && selectedSourceId !== null && !loading) {
      setSelectedSourceId(null)
    }
  }, [selectedSource, selectedSourceId, loading])

  useEffect(() => {
    if (selectedSource) void load(selectedSource.sourceId)
  }, [load, selectedSource])

  /*
   * **The suggestions run on arrival, because the button that started them is gone.**
   *
   * It was a control labelled *Curated by AI* beside the counts, so a reader who had just profiled
   * eighteen tables met a tab reporting no relationships at all and had to know to press something
   * to find out otherwise. Removed on request: what the profile implies about how these tables join
   * is not a separate act a reader should have to ask for.
   *
   * **The run is still narrated**, which is the rule every paced act here keeps — the strip says
   * *Reading the schema* while it is in flight, so the pending count appearing is something a reader
   * watched happen rather than a number that was always there. What is lost is a way to ask again
   * for the same tables: rejecting a suggestion drops it for good until the profile changes, which
   * is recorded rather than glossed.
   *
   * Guarded by `sourceId:tableCount`, not by a boolean: the store re-reads its tables after every
   * save, and without the guard each one would start a run.
   */
  useEffect(() => {
    if (!selectedSource || tables.length === 0) return
    const key = `${selectedSource.sourceId}:${tables.length}`
    if (suggestedFor.current.has(key)) return
    suggestedFor.current.add(key)
    void runSuggestions()
    /* `runSuggestions` closes over this render's state and is recreated every render, so it is
       deliberately not a dependency — the guard above is what makes the run happen once. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource, tables.length])

  /*
   * Table and sub-tab selection reset when the source changes — adjust-state-during-render.
   *
   * **The key is normalised before it is compared, not only before it is stored.** Comparing
   * `selectedSource?.sourceId` (`undefined` with nothing selected) against a state initialised to
   * `null` and then writing `?? null` made the two never agree: every render saw a change, set the
   * same `null` back, and re-rendered — *"Too many re-renders"* on the branch where a tenant has no
   * structured source. Found by rendering the tab rather than by reading it.
   */
  const sourceKey = selectedSource?.sourceId ?? null
  const [lastSourceKey, setLastSourceKey] = useState<string | null>(null)
  if (sourceKey !== lastSourceKey) {
    setLastSourceKey(sourceKey)
    setSelectedTableKey(null)
    setDetailTab('overview')
    /* `pendingBySource` is keyed by source, so leaving this open would swap the rows underneath a
       reader mid-review — and `Accept all` would then act on a list they never opened. */
    setPendingOpen(false)
  }

  const tableKeys = useMemo(() => tables.map((t) => t.tableKey), [tables])
  const declared = useMemo(
    () => declaredRelationshipsFrom(entities, tableKeys),
    [entities, tableKeys],
  )
  const pending = useMemo(
    () => (selectedSource ? (pendingBySource[selectedSource.sourceId] ?? []) : []),
    [selectedSource, pendingBySource],
  )
  const relationships = useMemo(() => [...declared, ...pending], [declared, pending])
  const edges = useMemo(
    () => relationships.map(relationshipToCanvasEdge),
    [relationships],
  )

  const selectedTable = useMemo(
    () => tables.find((t) => t.tableKey === selectedTableKey) ?? null,
    [tables, selectedTableKey],
  )
  const selectedEntity = selectedTable
    ? entityForTable(entities, selectedTable.tableKey)
    : null
  /* One rule, in `src/data/` so it can be asserted without rendering this tab's own state. */
  const tableStatus = tableDeclarationState(selectedEntity)

  const columnsDescribed = useMemo(
    () =>
      tables.reduce((n, t) => n + t.columns.filter((c) => !!c.description).length, 0),
    [tables],
  )
  /*
   * **An array rather than a `.length`, now that this tile opens what it counts too.** It was
   * `relationships.filter(…).length` — correct while the number was only printed, and the wrong
   * shape the moment a list stood behind it, because the modal would then have filtered a second
   * time and there would be two answers to "how many are confirmed". Same rule as the pending tile
   * below it, and the reason is the same one `selectedTableKey` follows one level up.
   */
  const confirmedRelationships = useMemo(
    () => relationships.filter((r) => r.status === 'confirmed'),
    [relationships],
  )
  const confirmedCount = confirmedRelationships.length
  /*
   * **One array, two readers.** The tile prints its length and the review modal lists its rows, so
   * the number a reader clicks and the number of rows they then count cannot disagree — there is no
   * second count to keep in step, which is the rule `selectedTableKey` follows one level up.
   */
  const pendingRelationships = useMemo(
    () => relationships.filter((r) => r.status === 'pending'),
    [relationships],
  )
  const pendingCount = pendingRelationships.length

  /**
   * The tables **no relationship on screen touches** — confirmed or pending.
   *
   * **It counted the server's `orphan_tables` instead, and that was wrong in the way a reader could
   * see.** That list is what the *scan* found nothing for, and the scan finds a shared identifier
   * for every table in CAPEX's `plan` — so the tile read 0 while `plan_account_dim` sat selected
   * beside it saying "No relationships declared or suggested yet for this entity" and its rail pill
   * showed an em dash. Reported from use, twice. A suggestion the tab drops as already-covered, and
   * every row a reader **rejects**, leave a table with nothing at all; the scan still says it found
   * that table something.
   *
   * So the count is of what is actually there, which is the thing a reader can check by clicking
   * the table — and it agrees with the rail's own em dash, because both now read `relationships`.
   *
   * `null` until a run has landed: before anything has looked, most tables have no *suggestion* yet
   * and a tile reading 15 would be a claim about a scan that never ran. The em dash is the same
   * answer a declared column's absent statistics give.
   */
  const orphanTableKeys = useMemo(() => {
    if (suggestOrphans === null) return null
    const touched = new Set(
      relationships.flatMap((r) => [r.fromTableKey, r.toTableKey]),
    )
    return tableKeys.filter((key) => !touched.has(key))
  }, [suggestOrphans, relationships, tableKeys])

  /**
   * Of those, the ones the **scan** also found nothing for.
   *
   * The two are different facts and the hint says which: a table in both lists is unjoined *in the
   * data* — no other table shares an identifier column with it — while one only in the first is
   * unjoined because its suggestions were rejected. Keeping the served list for this is what stops
   * it being a payload field nothing reads, and it is the half the client cannot work out.
   */
  const unjoinedInData = useMemo(() => {
    if (orphanTableKeys === null || suggestOrphans === null) return 0
    const scan = new Set(suggestOrphans)
    return orphanTableKeys.filter((key) => scan.has(key)).length
  }, [orphanTableKeys, suggestOrphans])

  const labelFor = (tableKey: string) =>
    tables.find((t) => t.tableKey === tableKey)?.tableId ?? tableKey

  const openRelationship = (id: string) =>
    setRelationshipTarget(relationships.find((r) => r.id === id) ?? null)
  const openCreate = (fromTableKey?: string) => {
    setCreateFromTableKey(fromTableKey ?? selectedTableKey)
    setRelationshipTarget('create')
  }

  /**
   * Persists a declaration, then lets the store's re-read decide what is on screen.
   *
   * **The acceptance travels with the edit.** Every write hands the server the whole relationship,
   * so a field left out is a field cleared: without this, editing a rationale would strip the name
   * of whoever accepted the row and quietly return it to undecided. An edit keeps what the row had;
   * a **new** declaration is the reader's own act, so it is credited to them.
   */
  const saveRelationship = async (
    input: Pick<
      DeclaredRelationship,
      | 'fromTableKey'
      | 'fromColumn'
      | 'toTableKey'
      | 'toColumn'
      | 'name'
      | 'cardinalityKind'
      | 'rationale'
    >,
    editId?: string,
  ) => {
    const existing = editId ? relationships.find((r) => r.id === editId) : undefined
    const result = await saveWrites(
      relationshipWrites({
        rel: {
          ...input,
          /* An edit keeps the row's own answer; declaring one here is the reader's act. A pending
             row being confirmed through this dialog has no `confirmedBy` yet, and the person doing
             it is the person to credit. */
          confirmedBy: existing?.confirmedBy ?? signedInAs,
        },
        editId,
        entities,
        labelFor,
      }),
    )
    if (result.ok) {
      message.success(editId ? 'Relationship updated.' : 'Relationship declared.')
    } else {
      message.error(result.error)
    }
  }

  /**
   * Confirming a suggestion is what turns it into a declaration: it is written, and only then
   * dropped from the pending list — a failed confirm leaves the suggestion where it can be retried
   * rather than losing it.
   */
  const confirmRelationship = async (id: string, edit?: RelationshipEdit) => {
    if (!selectedSource) return
    const suggestion = pending.find((r) => r.id === id)
    if (!suggestion) return

    const resolved = edit
      ? {
          ...suggestion,
          name: edit.name,
          fromTableKey: edit.fromTableKey,
          fromColumn: edit.fromColumn,
          toTableKey: edit.toTableKey,
          toColumn: edit.toColumn,
          /* Never spread the edit wholesale: the display label has to be re-derived from the kind,
             or it would go stale against the cardinality it is meant to describe. */
          cardinalityKind: edit.cardinalityKind,
          cardinality: CARDINALITY_LABELS[edit.cardinalityKind],
        }
      : suggestion

    const result = await saveWrites(
      relationshipWrites({
        rel: {
          ...resolved,
          /*
           * The run's own account of the columns it matched on becomes the declaration's rationale
           * where the reviewer added none — "why this relationship exists" is exactly what it
           * already explains, with the figures it read.
           */
          rationale: resolved.rationale.trim() || resolved.suggestionReasoning || '',
          /* Confirming a suggestion **is** the reader's act, so it is credited to them — which is
             what makes the row read *Confirmed by you* instead of *Curated by AI* afterwards. */
          confirmedBy: signedInAs,
        },
        entities,
        labelFor,
      }),
    )
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setPendingBySource((prev) => ({
      ...prev,
      [selectedSource.sourceId]: (prev[selectedSource.sourceId] ?? []).filter(
        (r) => r.id !== id,
      ),
    }))
    message.success('Relationship confirmed and saved.')
  }

  /**
   * Confirms every pending suggestion, one at a time, and reports what actually landed.
   *
   * **The entities are re-read from the store between writes, and that is load-bearing.**
   * `relationshipWrites` builds its write from the owning entity's *current* relationship array, so
   * a loop over one render's `entities` would hand the server an entity whose array is missing
   * everything the previous iterations added — each accept silently erasing the last. Worse where
   * the owner is not declared yet: that branch mints a **new** anchor entity, so two suggestions
   * from the same undeclared table would both try to create one and the second is refused with
   * "already declared". `saveWrites` reloads the entities it just wrote, so reading the store per
   * iteration is what makes each write build on the one before it.
   *
   * **It stops at the first refusal rather than pressing on.** A later write may depend on an entity
   * an earlier one was meant to create, so continuing past a failure produces a cascade of refusals
   * that say nothing about the original cause — and the rows it has not reached are still pending,
   * which is recoverable.
   */
  const acceptAllPending = async () => {
    if (!selectedSource || pendingRelationships.length === 0) return
    const queue = [...pendingRelationships]
    setAcceptingAll(true)
    let accepted = 0
    let failure: string | undefined

    for (const suggestion of queue) {
      const entitiesNow = useDataModelStore.getState().entities
      const result = await saveWrites(
        relationshipWrites({
          rel: {
            ...suggestion,
            rationale:
              suggestion.rationale.trim() || suggestion.suggestionReasoning || '',
            /* Accept all is the reader's act too, once per row — so each one lands credited, and
               the relations list reads *Confirmed by you* rather than *Curated by AI*. */
            confirmedBy: signedInAs,
          },
          entities: entitiesNow,
          labelFor,
        }),
      )
      if (!result.ok) {
        failure = result.error
        break
      }
      accepted += 1
      /* Dropped as it lands, so a partial run leaves exactly the unreached rows pending. */
      setPendingBySource((prev) => ({
        ...prev,
        [selectedSource.sourceId]: (prev[selectedSource.sourceId] ?? []).filter(
          (r) => r.id !== suggestion.id,
        ),
      }))
    }

    setAcceptingAll(false)
    const outcome = acceptAllOutcome({
      attempted: queue.length,
      accepted,
      error: failure,
    })
    if (outcome.tone === 'success') {
      message.success(outcome.message)
      setPendingOpen(false)
    } else if (outcome.tone === 'warning') {
      message.warning(outcome.message)
    } else {
      message.error(outcome.message)
    }
  }

  /**
   * **Accepts a stored relation: the same write, with a name on it.**
   *
   * A stored declaration and an accepted one are two facts — see `confirmedBy` — so this is what
   * turns the first into the second. It reuses `relationshipWrites` with the row's own `editId`
   * rather than a route of its own: the write path already carries every absent field forward and
   * already anchors the row on the right entity, and a second endpoint that set one field would be a
   * second way to write one thing.
   *
   * The address is the **browser's**, because the identity is client-held and a route cannot look up
   * who is signed in — the rule `saved_by` on a report established. Without one there is nobody to
   * credit, so the act is refused rather than recording an empty name.
   */
  const acceptRelation = async (id: string) => {
    const row = confirmedRelationships.find((r) => r.id === id)
    if (!row) return
    if (!signedInAs) {
      message.warning('Sign in to record who accepted this.')
      return
    }
    setDeciding(true)
    const result = await saveWrites(
      relationshipWrites({
        rel: { ...row, confirmedBy: signedInAs },
        editId: id,
        entities,
        labelFor,
      }),
    )
    setDeciding(false)
    if (result.ok) message.success(relationDecision('accepted', row.name))
    else message.error(result.error)
  }

  /**
   * **Accepts every undecided stored relation — one request, one commit.**
   *
   * Asked for as a bulk act rather than a sequence. It ran the row's own write down the list first,
   * which was 59 requests for one decision and, worse, a **partial** outcome on a refusal: half the
   * list accepted, with nothing on screen saying which half. So the act moved to the server —
   * `POST /data-model/relationships/accept` resolves the whole scope before it writes anything and
   * lands it in a single `commitDb`, the arrangement the multi-dictionary schema upload already
   * has. All of them or none.
   *
   * **The scope is this source's own tables**, so what the run accepts is exactly what the dialog
   * listed: both ends of a relationship have to be in scope there, and the route applies the same
   * rule. Sending the source's keys rather than letting the route default to the dataset is what
   * keeps the button's count and the run's answer about the same set.
   *
   * **The count in the message is the server's**, never `queue.length`: it reports what it wrote,
   * which is the whole reason `acceptAllOutcome` takes `accepted` separately from `attempted` — a
   * sentence composed from the submitted list is a claim about writes that may not have happened.
   *
   * Nobody signed in is a refusal rather than an empty name, the rule `acceptRelation` keeps.
   */
  const acceptAllRelations = async () => {
    if (!signedInAs) {
      message.warning('Sign in to record who accepted these.')
      return
    }
    const queue = unacceptedRelations(confirmedRelationships)
    if (queue.length === 0) return

    setAcceptingRelations(true)
    const result = await acceptAllStored(tableKeys, signedInAs)
    setAcceptingRelations(false)

    /* The dialog stays open: these rows do not leave the list, they change what they say — so the
       reader sees the marks they just made rather than an empty screen. */
    const outcome = acceptAllOutcome({
      attempted: queue.length,
      accepted: result.ok ? result.accepted : 0,
      error: result.ok ? undefined : result.error,
    })
    if (outcome.tone === 'success') message.success(outcome.message)
    else if (outcome.tone === 'warning') message.warning(outcome.message)
    else message.error(outcome.message)
  }

  /**
   * **Rejects a stored relation: the declaration goes, and the row goes back to pending.**
   *
   * Asked for in those terms — a rejected relation is not a deletion, it is a decision that puts the
   * question back where undecided things live, so the *suggested, pending* count picks it up. The
   * write is the ordinary removal; what is new is the local row that replaces it, marked `pending`
   * and `derived`, which is what it was before anybody stored it.
   *
   * The pending copy is added **after** the write lands. Adding it first would show a suggestion
   * beside a declaration that is still there — the same both-at-once state the accept path avoids.
   */
  const rejectRelation = async (id: string) => {
    const row = confirmedRelationships.find((r) => r.id === id)
    if (!row || !selectedSource) return
    const write = removeRelationshipWrite(id, entities)
    if (!write) return
    setDeciding(true)
    const result = await save(write)
    setDeciding(false)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setPendingBySource((prev) => ({
      ...prev,
      [selectedSource.sourceId]: [
        ...(prev[selectedSource.sourceId] ?? []),
        {
          ...row,
          /* A fresh id: the stored one addresses an entity's relationship array, and that entry has
             just been removed. */
          id: `pending-rejected-${row.fromTableKey}-${row.fromColumn}-${row.toTableKey}-${row.toColumn}`,
          status: 'pending',
          provenance: 'derived',
          confirmedBy: null,
          evidenceKind: 'structural',
          evidence: undefined,
          suggestionReasoning: row.rationale,
          owningEntityId: undefined,
        },
      ],
    }))
    message.success(relationDecision('rejected', row.name))
  }

  /**
   * One remover, two intents. **Reject** drops a suggestion from local state; **Delete** writes the
   * declaration away. The id decides which of the two this is.
   */
  const removeRelationship = async (id: string) => {
    if (!selectedSource) return
    if (pending.some((r) => r.id === id)) {
      setPendingBySource((prev) => ({
        ...prev,
        [selectedSource.sourceId]: (prev[selectedSource.sourceId] ?? []).filter(
          (r) => r.id !== id,
        ),
      }))
      return
    }
    const write = removeRelationshipWrite(id, entities)
    if (!write) return
    const result = await save(write)
    if (result.ok) message.success('Relationship removed.')
    else message.error(result.error)
  }

  const runSuggestions = async () => {
    if (!selectedSource) return
    setSuggesting(true)
    const result = await suggest(selectedSource.sourceId)
    setSuggesting(false)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    const data = result.data
    setSuggestOrphans(data.orphan_tables)
    setTableSuggestions((prev) => {
      const next = { ...prev }
      for (const t of data.tables) next[t.table_key] = t
      return next
    })

    /*
     * A pair already tracked by any existing relationship — stored or pending, in **either
     * direction** — is skipped. A declaration somebody confirmed is ground truth, and a fresh
     * suggestion sitting beside it would imply the question is still open.
     */
    const covered = (r: {
      from_table_key: string
      from_column: string
      to_table_key: string
      to_column: string
    }) =>
      relationships.some(
        (e) =>
          (e.fromTableKey === r.from_table_key &&
            e.fromColumn === r.from_column &&
            e.toTableKey === r.to_table_key &&
            e.toColumn === r.to_column) ||
          (e.fromTableKey === r.to_table_key &&
            e.fromColumn === r.to_column &&
            e.toTableKey === r.from_table_key &&
            e.toColumn === r.from_column),
      )

    setPendingBySource((prev) => {
      const existing = prev[selectedSource.sourceId] ?? []
      const fresh: DeclaredRelationship[] = data.relationships
        .filter((r) => !covered(r))
        .map((r) => {
          const kind = cardinalityKindFromHint(r.cardinality_hint)
          return {
            id: `derived::${r.from_table_key}::${r.from_column}::${r.to_table_key}::${r.to_column}`,
            fromTableKey: r.from_table_key,
            fromColumn: r.from_column,
            toTableKey: r.to_table_key,
            toColumn: r.to_column,
            name: r.relationship_type,
            nameAlternatives: r.relationship_type_alternatives,
            /* The *display* says the run derived nothing where it derived nothing; `kind` beside it
               is what the reviewer's Select opens on, and one of the four has to be. */
            cardinality:
              r.cardinality_hint === null
                ? CARDINALITY_UNDETERMINED
                : CARDINALITY_LABELS[kind],
            cardinalityKind: kind,
            rationale: '',
            status: 'pending' as const,
            /* From what the run said the suggestion stands on, so the badge on the row cannot
               describe it differently from the sentence inside it. */
            provenance:
              r.evidence_kind === 'recorded' ? ('recorded' as const) : ('derived' as const),
            suggestionReasoning: r.rationale,
            confidence: r.confidence,
            evidenceKind: r.evidence_kind,
          }
        })
      /* Keyed by the column pair, so a second run replaces its own earlier suggestions rather than
         listing each of them twice. */
      const keep = existing.filter((e) => !fresh.some((f) => f.id === e.id))
      if (fresh.length === 0) {
        message.info('Nothing new — every shared identifier is already declared or suggested.')
        return prev
      }
      return { ...prev, [selectedSource.sourceId]: [...keep, ...fresh] }
    })
  }

  if (loading && structured.length === 0) {
    return <Skeleton active paragraph={{ rows: 6 }} />
  }

  if (structured.length === 0) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Alert
          type="info"
          showIcon
          title="No structured source is connected"
          description="A model is tables, columns and relationships, so it is drawn over a connected BigQuery project. Connect one on Sources, then browse and profile it on the Catalog tab."
        />
        {/* A list that is merely shorter is not a message: a tenant whose only sources are a drive
            and a mailbox would otherwise read "nothing is connected" beside a Sources table
            listing two. */}
        {skipped > 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12.5 }}>
            {`${skipped} connected source${skipped === 1 ? ' is' : 's are'} not modelled here: a drive and a mailbox hold documents rather than tables, so there is no schema to draw. Both are catalogued on the Catalog tab.`}
          </Typography.Paragraph>
        ) : null}
      </div>
    )
  }

  const displayName = selectedEntity?.entity_name ?? selectedTable?.tableId

  return (
    <>
      {modelError ? (
        <ApiErrorAlert
          error={modelError}
          onRetry={() => {
            if (selectedSource) void load(selectedSource.sourceId)
          }}
        />
      ) : null}

      {/*
        `align="top"`, not stretch: each panel sizes to its own content instead of all three being
        forced to the tallest one's height — which left a tall empty gap under the canvas's legend,
        since the detail column is naturally much longer.
      */}
      <Row gutter={[16, 16]} align="top">
        {/* LEFT — sources and their tables. Collapsible, because once a table is picked the canvas
            is worth more than an always-visible list; the slim rail keeps the current selection
            visible, so collapsing loses context rather than state. */}
        <Col xs={24} lg={railCollapsed ? 1 : 4}>
          {railCollapsed ? (
            <PanelShell>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 4px',
                }}
              >
                <Tooltip title="Show sources and tables" placement="right">
                  <Button
                    size="small"
                    type="text"
                    icon={<RightOutlined />}
                    onClick={() => setRailCollapsed(false)}
                    aria-label="Expand the sources panel"
                  />
                </Tooltip>
                <Tooltip
                  title={
                    selectedSource
                      ? `${selectedSource.sourceId}${selectedTable ? ` · ${displayName}` : ''}`
                      : 'No source selected'
                  }
                  placement="right"
                >
                  <span style={{ color: selectedSource ? MT.orangeHi : MT.dim }}>
                    <DatabaseOutlined />
                  </span>
                </Tooltip>
              </div>
            </PanelShell>
          ) : (
            <PanelShell>
              <div
                style={{
                  padding: '12px 15px',
                  borderBottom: `1px solid ${MT.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <h3
                  style={{
                    fontSize: 12.5,
                    margin: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: MT.mut,
                    fontWeight: 600,
                  }}
                >
                  Sources · {structured.length}
                </h3>
                <Tooltip title="Collapse this panel">
                  <Button
                    size="small"
                    type="text"
                    icon={<LeftOutlined />}
                    onClick={() => setRailCollapsed(true)}
                    aria-label="Collapse the sources panel"
                  />
                </Tooltip>
              </div>
              <div style={{ padding: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {structured.map((s) => {
                    const active = s.sourceId === selectedSource?.sourceId
                    return (
                      <button
                        type="button"
                        key={s.sourceId}
                        onClick={() => setSelectedSourceId(s.sourceId)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          padding: '8px 9px',
                          textAlign: 'left',
                          borderRadius: MT.rS,
                          border: `1px solid ${active ? MT.orangeLine : MT.line}`,
                          background: active ? MT.orangeSoft : MT.card,
                          cursor: 'pointer',
                        }}
                      >
                        <ConnectorIcon connector={s.connector} size={18} />
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 12.5,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {s.sourceName}
                          </span>
                          <span style={{ fontSize: 10.5, color: MT.dim }}>
                            {s.profiledTables} table(s) profiled
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 6 }}>
                  {modelLoading && tables.length === 0 ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                  ) : (
                    <ModelTableList
                      tables={tables}
                      entities={entities}
                      edges={edges}
                      selectedTableKey={selectedTableKey}
                      onSelect={setSelectedTableKey}
                    />
                  )}
                </div>
              </div>
            </PanelShell>
          )}
        </Col>

        {/* CENTRE — the counts, and the canvas. */}
        <Col xs={24} lg={railCollapsed ? 16 : 13}>
          <PanelShell>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 14px',
                borderBottom: `1px solid ${MT.line}`,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <StatItem value={tables.length} label="tables" />
                {/*
                  * **"relations", renamed on request — it read "relationships confirmed".**
                  *
                  * Over twelve rows nobody in the session had accepted, because being stored was
                  * being confirmed. Those two facts came apart (`confirmedBy`), so the tile counts
                  * what this source *holds* and each row says whether anybody has accepted it. The
                  * word is `CONFIRMED_COPY.tileLabel`, declared beside the dialog's own title so
                  * the control and the thing it opens cannot come to be called two things.
                  */}
                <StatItem
                  value={confirmedCount}
                  label={CONFIRMED_COPY.tileLabel}
                  color={MT.green}
                  /* Inert at 0, exactly as the pending tile is: a count that opened an empty dialog
                     is the button-over-blank-space this repo has fixed once already. */
                  onClick={
                    confirmedCount > 0 ? () => setConfirmedOpen(true) : undefined
                  }
                  hint={
                    confirmedCount > 0
                      ? 'Accept or reject each relation this source has stored'
                      : undefined
                  }
                />
                <StatItem
                  value={pendingCount}
                  label="suggested, pending"
                  color={MT.amber}
                  /* Clickable only where there is something to show: a tile at 0 that opened an
                     empty dialog is the button-over-blank-space this repo has fixed once already. */
                  onClick={
                    pendingCount > 0 ? () => setPendingOpen(true) : undefined
                  }
                  hint={
                    pendingCount > 0
                      ? 'Review what is pending, and accept them all if you want to'
                      : undefined
                  }
                />
                {/*
                  * **Tables nothing joins, and an em dash until something has looked.**
                  *
                  * Inert: the table list beside it already marks each one — a row with no
                  * relationship shows an em dash where the others carry a count — so this is the
                  * figure and that is the naming, which is the pair a skipped profiling run
                  * already uses. It is red rather than amber because it is not a state waiting on
                  * a decision: a table the schema does not connect is a thing to go and look at.
                  */}
                <StatItem
                  value={orphanTableKeys === null ? '—' : orphanTableKeys.length}
                  label="orphan tables"
                  color={
                    orphanTableKeys && orphanTableKeys.length > 0 ? MT.red : undefined
                  }
                  /* Two facts, said apart: unjoined *in the data* is a modelling observation, and
                     unjoined because the suggestions were rejected is a decision somebody made. */
                  hint={
                    orphanTableKeys && orphanTableKeys.length > 0
                      ? `${orphanTableKeys.length} table(s) have no relationship at all — ${unjoinedInData} because nothing else shares an identifier column with them, the rest because their suggestions were rejected. The table list marks each with an em dash.`
                      : undefined
                  }
                />
                <StatItem value={columnsDescribed} label="columns described" />
              </div>
              <Space size={8}>
                {/*
                 * **Where the *Curated by AI* button was.** It started the suggestions run, and it
                 * is gone: the run happens on arrival now, so a reader who has just profiled a
                 * source is not left in front of a tab reporting no relationships until they know
                 * to press something. Removed on request.
                 *
                 * **What stayed is the narration**, which is the rule every paced act here keeps: a
                 * run that returned invisibly would teach that it is free. So the strip says what
                 * is happening while it happens, and says it in the same words the button's busy
                 * state used. It is a label rather than a disabled control, because there is
                 * nothing here to press.
                 */}
                {suggesting ? (
                  <Space size={6}>
                    <Spin size="small" />
                    <span style={{ fontSize: 11, color: MT.dim }}>Reading the schema</span>
                  </Space>
                ) : null}
                <Button
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => fitRef.current?.()}
                >
                  Fit
                </Button>
              </Space>
            </div>

            {/* The three banners this canvas used to draw here (a suggest failure, the
                degraded/no-model note, and the scan-truncated notice) are removed on request —
                a reader can still tell a run failed from the empty canvas and the toast `suggest`
                already raises, and the degraded/truncated facts still ride on the payload for
                anything that reads it later; nothing here composes copy from them any more. */}

            <EntityCanvas
              tables={tables}
              entities={entities}
              edges={edges}
              selectedTableKey={selectedTableKey}
              onSelect={setSelectedTableKey}
              onSelectEdge={openRelationship}
              onAddRelationshipFor={(tableKey) => {
                setSelectedTableKey(tableKey)
                setDetailTab('relationships')
                openCreate(tableKey)
              }}
              fitRef={fitRef}
            />
          </PanelShell>
        </Col>

        {/* RIGHT — everything declared about the table in hand. */}
        <Col xs={24} lg={7}>
          <PanelShell>
            {!selectedTable ? (
              <div style={{ padding: 20 }}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Pick a table on the left, or a card on the canvas, to see its Overview, columns
                  and relationships.
                </Text>
              </div>
            ) : (
              <>
                <div style={{ padding: '14px 16px 0' }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: MT.dim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 3,
                    }}
                  >
                    Entity detail
                  </div>
                  <h2
                    style={{
                      fontSize: 17,
                      margin: '0 0 3px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      minWidth: 0,
                    }}
                  >
                    <Tooltip title={displayName}>
                      <span
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                        }}
                      >
                        {displayName}
                      </span>
                    </Tooltip>
                    {/*
                      * **The table's status, once, beside its name.**
                      *
                      * Overview carried a `ProvenanceBadge` beside five of its fields — one
                      * question answered five times on a form whose every field is saved by one
                      * button. Removed on request, and answered here instead, because it is a fact
                      * about the table rather than about a text box.
                      *
                      * **Three states, not two.** It read *Declared* for any existing entity, and
                      * an entity exists without anybody having declared anything: the client mints
                      * an anchor whenever a relationship points at an undeclared table, and all 14
                      * of CAPEX's exist that way. So the pill is read off `confirmed_by`, which
                      * only Save Overview writes — the same split `confirmed_by` on a relationship
                      * draws between *stored* and *accepted*.
                      */}
                    {/*
                      * **A provenance mark for the two declared states, a status pill for the
                      * third — and getting that wrong is what the colour showed.**
                      *
                      * All three went through `StatusPill` at first, so *Curated by AI* arrived
                      * amber while the same words on every relationship row beside it were purple.
                      * That is the confusion the two marks are separate components to prevent:
                      * status is green/amber/red, provenance is green/purple. *Curated by AI* and
                      * *Confirmed by you* say **who**, so they wear the provenance palette and its
                      * own words; *Not yet declared* is a state, so it keeps the neutral pill.
                      */}
                    {TABLE_STATUS_KIND[tableStatus] ? (
                      <ProvenanceBadge kind={TABLE_STATUS_KIND[tableStatus]!} full />
                    ) : (
                      <StatusPill variant="mut">{TABLE_UNDECLARED_LABEL}</StatusPill>
                    )}
                  </h2>
                  <div
                    style={{
                      fontSize: 11,
                      color: MT.dim,
                      fontFamily: MT.mono,
                      marginBottom: 12,
                    }}
                  >
                    {selectedTable.tableKey} · {selectedTable.type}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 2,
                    padding: '0 12px',
                    borderBottom: `1px solid ${MT.line}`,
                  }}
                >
                  {DETAIL_TABS.map((tab) => {
                    const on = detailTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setDetailTab(tab.key)}
                        style={{
                          padding: '9px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: on ? MT.orangeHi : MT.dim,
                          border: 'none',
                          borderBottom: `2px solid ${on ? MT.orangeHi : 'transparent'}`,
                          background: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                <div style={{ padding: '15px 16px 18px' }}>
                  {detailTab === 'overview' ? (
                    <EntityOverviewPanel
                      key={`${selectedTable.tableKey}-overview`}
                      table={selectedTable}
                      entity={selectedEntity}
                      suggestion={tableSuggestions[selectedTable.tableKey] ?? null}
                    />
                  ) : null}
                  {detailTab === 'columns' && selectedSource ? (
                    <EntityColumnsPanel
                      key={`${selectedTable.tableKey}-columns`}
                      table={selectedTable}
                      tables={tables}
                      entities={entities}
                      entity={selectedEntity}
                      sourceId={selectedSource.sourceId}
                    />
                  ) : null}
                  {detailTab === 'relationships' ? (
                    <EntityRelationshipsPanel
                      key={`${selectedTable.tableKey}-relationships`}
                      table={selectedTable}
                      tables={tables}
                      entities={entities}
                      relationships={relationships}
                      onOpen={openRelationship}
                      onCreate={() => openCreate(selectedTable.tableKey)}
                      onDelete={(id) => void removeRelationship(id)}
                    />
                  ) : null}
                </div>
              </>
            )}
          </PanelShell>
        </Col>
      </Row>

      <RelationshipModal
        target={relationshipTarget}
        tables={tables}
        entities={entities}
        createFromTableKey={createFromTableKey}
        onClose={() => setRelationshipTarget(null)}
        onSave={(input, editId) => void saveRelationship(input, editId)}
        onConfirm={(id, edit) => void confirmRelationship(id, edit)}
        onReject={(id) => void removeRelationship(id)}
        onDelete={(id) => void removeRelationship(id)}
        saving={saving}
      />

      {/*
       * The review over the same array the tile counts. It is closed when the source changes with
       * it — `pendingBySource` is keyed by source, so the rows behind an open dialog would otherwise
       * be a different source's the moment the rail selection moved.
       */}
      <PendingSuggestionsModal
        open={pendingOpen && pendingCount > 0}
        rows={pendingRelationships}
        labelFor={labelFor}
        accepting={acceptingAll}
        onAcceptAll={() => void acceptAllPending()}
        onAccept={(id) => void confirmRelationship(id)}
        onReject={(id) => void removeRelationship(id)}
        onClose={() => setPendingOpen(false)}
      />

      {/*
       * The confirmed list, over the same array its tile counts.
       *
       * **A reading surface that hands over rather than acting.** A row opens the relationship
       * dialog — the one the canvas edge and the Entity detail row already open — so editing and
       * deleting a stored declaration stay on one surface. Opening it *closes this dialog first*:
       * antd will stack two `Modal`s happily, and a dialog behind a dialog leaves the reader two
       * Closes to find their way back through, with the row they came from hidden behind the one
       * they are reading.
       */}
      <ConfirmedRelationshipsModal
        open={confirmedOpen && confirmedCount > 0}
        rows={confirmedRelationships}
        labelFor={labelFor}
        onOpen={(id) => {
          setConfirmedOpen(false)
          openRelationship(id)
        }}
        /* The two decisions this list is for. It stays open through both: a reader working down
           twelve rows should not have to reopen the dialog after each one. */
        deciding={deciding}
        onAccept={(id) => void acceptRelation(id)}
        onReject={(id) => void rejectRelation(id)}
        /* The bulk half of the row's own Accept, in the top bar. There is deliberately no
           Reject all beside it: nineteen removals behind one press is the least reversible
           button this tab could have, which is the reasoning that kept both out until the
           additive one was asked for. */
        accepting={acceptingRelations}
        onAcceptAll={() => void acceptAllRelations()}
        onClose={() => setConfirmedOpen(false)}
      />
    </>
  )
}
