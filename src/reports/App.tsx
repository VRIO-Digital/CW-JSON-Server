import { useMemo, useState } from 'react';
import { META, OPTS, STARTERS } from './data';
import { assumptionsForStarter, freshAssumptions } from './lib/assumptions';
import { instantiate, isMeasure } from './lib/blocks';
import { audienceLabel, fromGoverned, newReportId, seedLibrary, stamp, upsert } from './lib/library';
import { ShareDialog, type ShareRole } from './components/SharePicker';
import { hasFilter, scopeSet, selectRows } from './lib/select';
import { PublishDialog } from './components/PublishDialog';
import { StepDots } from './components/StepDots';
import { Tabs, type TabDef } from './components/Tabs';
import { useToast } from './components/Toast';
import { AskPane } from './panes/AskPane';
import { ConfirmPane } from './panes/ConfirmPane';
import { LibraryPane } from './panes/LibraryPane';
import { ReportPane } from './panes/ReportPane';
import { UnderDevelopmentPane } from './panes/UnderDevelopmentPane';
import type {
  Assumptions,
  Block,
  Filter,
  MeasureKey,
  ReportStatus,
  ReportTab,
  SavedReport,
  SlotKey,
  Starter,
  Step,
} from './types';

/** The audience tab is the Operations group's view. */
const AUDIENCE_KEY = 'operations';
const AUDIENCE_TAB_LABEL = 'Operational audience';

/**
 * Who a report saved in this session is credited to.
 *
 * The one change to the prototype's behaviour, and it is a correctness fix rather than a port
 * detail. Left alone, `save()` stamped every report the *reader* saved with the vendored demo
 * persona — so the Library credited Ana Delgado for work the signed-in user did. The host page
 * passes the signed-in identity in; with none (the prototype standing alone) it falls back to
 * its own `META`, so nothing here invents a name.
 *
 * The seeded library rows keep their own bylines: those are other people's reports, which is
 * what makes the demo library look like a shared one.
 */
export interface ReportsIdentity {
  name: string
  role: string
}

/**
 * A graph the reader can actually ask. Shaped like the dataset's own slot options so both
 * pickers take one list either way.
 */
export interface GraphOption {
  value: string;
  label: string;
  /** Optional, matching the dataset's own `SlotOption` — the pickers fall back to `label`. */
  short?: string;
  d?: string;
}

/**
 * The tenant's governed report definitions, and the lifecycle states they sit in.
 *
 * **Declared here rather than imported from `client.ts`**, the same as `GraphOption` above: the
 * prototype has to keep standing alone with no host, so what it knows about the API is a shape it
 * states, not a dependency on the app's client. The served types are structurally these.
 *
 * Every field is a served fact. Nothing on a governed card is computed here — least of all a
 * count: `count` arrives decided, because a chip that counted its own filtered array would be a
 * second answer to "how many are published".
 */
export interface GovernanceState {
  key: string;
  label: string;
  /** `good` · `warn` · `crit` · `neutral` — a state colour, so the chip may not choose its own. */
  tone: string;
  count: number;
}

export interface GovernedRow {
  reportId: string;
  kind: 'written' | 'saved';
  reportTag: string;
  title: string;
  question: string;
  status: string;
  statusLabel: string;
  tone: string;
  version: string | null;
  author: string | null;
  category: string;
  asOf: string | null;
  schedule: string;
  approval: string | null;
  note: string | null;
  floor: string | null;
  /** Shared with nobody — a decision, not an audience that failed to resolve. */
  private: boolean;
  entitledRoles: { roleId: string; label: string }[];
  /**
   * Whether the signed-in role may open this report, and what it asked for if not.
   *
   * **Not access control**, and the picker says so on the page: the role is the browser's and the
   * API still serves every row to a caller that names none. What it drives is which actions a row
   * offers, and whether it says an approval is pending.
   */
  access: {
    entitled: boolean;
    request: { state: string; requestedAt: string; by: string; approvers: string[] } | null;
    mayRequest: boolean;
  };
}

export interface Governance {
  statuses: GovernanceState[];
  reports: GovernedRow[];
}

/**
 * The three acts a row offers that reach the server.
 *
 * The host performs them — the prototype does not import `client.ts`, the same reason it declares
 * the payload's shape rather than borrowing the app's types. Each returns the repo's `Result` so
 * nothing here has a `try/catch` and a refusal arrives as the server's own sentence.
 */
export interface GovernanceActions {
  share(reportId: string, audience: string[]): Promise<{ ok: boolean; error?: string }>;
  remove(reportId: string): Promise<{ ok: boolean; error?: string }>;
  requestAccess(reportId: string): Promise<{ ok: boolean; error?: string; alreadyOpen?: boolean }>;
}

/** The chip that leads the bar. Not a stored state — the server counts it as everything not archived. */
const ALL_CURRENT = 'current';

export default function App({
  identity,
  graphOptions,
  governance,
  shareRoles,
  actions,
}: {
  identity?: ReportsIdentity;
  graphOptions?: GraphOption[];
  governance?: Governance | null;
  /** The role pool, served — never a list this component keeps. */
  shareRoles?: ShareRole[];
  actions?: GovernanceActions;
} = {}) {
  const toast = useToast();

  const [tab, setTab] = useState<ReportTab>('library');
  /*
   * Seeded from the same published graph the pickers default to — otherwise every card reads
   * "Reads from the VLS Compliance graph", which is the dataset's fictional default and names a
   * graph nobody published. Declared after `graphs` below, which is why this reads it lazily.
   */
  const [library, setLibrary] = useState<SavedReport[]>(() => {
    /*
     * **Hosted, the shelf starts empty.** Its four seeded rows are the prototype's own fiction —
     * other people's reports, with bylines nobody here has — and beside a grid of the tenant's real
     * governed definitions they read as five more reports that do not exist. Standing alone the
     * prototype keeps them, because there is no real list to stand next to.
     */
    if (governance) return [];
    const first = graphOptions?.length ? graphOptions[0] : undefined;
    return seedLibrary(first ? { value: first.value, label: first.label } : undefined);
  });

  /* ------------------------------------------------------- authoring state */
  const [step, setStep] = useState<Step>(1);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState(false);
  const [starter, setStarter] = useState<Starter>(STARTERS[0]);
  /*
   * **The graph list is the host's, not the dataset's.**
   *
   * The vendored dataset ships four graphs, each described as "Published" — and none of them
   * exists. The app knows which graphs really are published, so it passes them in and both
   * pickers offer those instead. Falling back to the dataset's list keeps the prototype
   * standing alone, where there is no host to ask.
   */
  const graphs = graphOptions?.length ? graphOptions : OPTS.graph.options;

  const [assumptions, setAssumptions] = useState<Assumptions>(() => {
    const base = freshAssumptions();
    /* The default has to be one of the graphs on offer. Left at the dataset's default it named
       a graph the list no longer contains, so the pill read one thing and the menu marked
       nothing as selected. */
    const first = graphs[0];
    return first ? { ...base, graph: { value: first.value, label: first.label } } : base;
  });
  const [filters, setFilters] = useState<Filter[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  /*
   * Which lifecycle state the Library is filtered to. Held here rather than in the pane so that
   * leaving the tab and coming back does not silently reset the filter under a heading that still
   * says how many rows the state has.
   */
  const [libraryState, setLibraryState] = useState<string>(ALL_CURRENT);

  /*
   * Which report's Share dialog is open, and whether its write is in flight.
   *
   * **Held here, not in `LibraryPane`.** The picker began as a panel inside the card it changed,
   * which grew that card by ~400px — and because the grid's cards are equal-height with their action
   * row pinned by `margin-top: auto`, every sibling in the row stretched to match and four cards
   * ended up with a chasm between their text and their buttons. A dialog at this level cannot touch
   * the grid. `kind` is what tells a governed definition (a server row) from a session report (a
   * local one), because Share means something different to each.
   */
  const [sharing, setSharing] = useState<{ kind: 'governed' | 'saved'; id: string } | null>(null);
  const [savingShare, setSavingShare] = useState(false);

  /** Set when the open report already exists in the library. */
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const scopeRows = useMemo(() => scopeSet(assumptions.scope.value), [assumptions.scope.value]);
  const rows = useMemo(() => selectRows(assumptions, filters), [assumptions, filters]);
  const measure: MeasureKey = isMeasure(assumptions.measure.value) ? assumptions.measure.value : 'penalty';

  const opened = openedId ? library.find((r) => r.id === openedId) : undefined;
  const audienceReports = library.filter((r) => r.status === 'published' && r.audience === AUDIENCE_KEY);

  const REPORT_TABS: TabDef<ReportTab>[] = [
    { key: 'library', label: 'Library', count: library.length },
    { key: 'author', label: 'Author a report' },
    { key: 'audience', label: AUDIENCE_TAB_LABEL, badge: 'Soon' },
  ];

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function go(next: Step) {
    setStep(next);
    scrollTop();
  }

  function goTab(next: ReportTab) {
    setTab(next);
    setSelected(null);
    // Leaving a report open would leak it into the next tab's context.
    if (next !== 'author') setOpenedId(null);
    scrollTop();
  }

  /* --------------------------------------------------------------- ask flow */

  function authorNew() {
    setStarter(STARTERS[0]);
    setPrompt('');
    setError(false);
    setAssumptions(freshAssumptions(assumptions.graph));
    setFilters([]);
    setBlocks([]);
    setEditMode(false);
    setOpenedId(null);
    setStep(1);
    goTab('author');
  }

  function pickStarter(index: number) {
    const s = STARTERS[index];
    setStarter(s);
    setPrompt(s.q);
    setError(false);
    setAssumptions(assumptionsForStarter(s, assumptions.graph));
    setFilters(s.filters ? s.filters.map((f) => ({ ...f })) : []);
    setOpenedId(null);
    go(2);
  }

  /** Free-typed questions route to the generator report — the default spine. */
  function readQuestion() {
    const p = prompt.trim();
    if (!p) {
      setError(true);
      return;
    }
    setError(false);
    if (p !== starter.q) {
      setStarter(STARTERS[0]);
      setAssumptions(freshAssumptions(assumptions.graph));
      setFilters([]);
      setOpenedId(null);
    }
    go(2);
  }

  function setSlot(key: SlotKey, value: string, label: string) {
    setAssumptions((prev) => ({ ...prev, [key]: { value, label } }));
    // A new population invalidates whatever we were slicing by.
    if (key === 'scope') setFilters([]);
  }

  function toggleSlice(key: string) {
    setFilters((prev) => (hasFilter(prev, key) ? prev.filter((f) => f.key !== key) : [...prev, { key, val: 'All' }]));
  }

  function build() {
    setEditMode(false);
    setSelected(null);
    setBlocks(starter.blocks.map(instantiate));
    go(3);
  }

  /* ----------------------------------------------------------- library flow */

  /** Loads a saved report back into the authoring state. */
  function load(r: SavedReport) {
    setStarter(STARTERS.find((s) => s.id === r.starterId) ?? STARTERS[0]);
    setPrompt(r.question);
    setAssumptions(JSON.parse(JSON.stringify(r.assumptions)));
    setFilters(r.filters.map((f) => ({ ...f })));
    setBlocks(r.blocks.map((b) => ({ ...b })));
    setOpenedId(r.id);
    setSelected(null);
    setStep(3);
  }

  function openForEdit(r: SavedReport) {
    load(r);
    setEditMode(true);
    setTab('author');
    scrollTop();
  }

  function openFromLibrary(r: SavedReport) {
    load(r);
    setEditMode(false);
    setTab('author');
    scrollTop();
  }

  /* ------------------------------------------- the governed definitions */

  /**
   * Opens a governed definition as a report.
   *
   * It loads through the same `load()` the shelf uses, because a governed row resolves to one of the
   * prototype's starters — the definitions and the starters are the same five reports out of the
   * same file. A row that resolves to none offers no Open, so this returning early cannot leave a
   * button that quietly does nothing.
   */
  function openGoverned(row: GovernedRow, forEdit: boolean) {
    const built = fromGoverned(row, assumptions.graph);
    if (!built) {
      toast(`“${row.title}” has no authoring definition behind it, so it cannot be opened here.`);
      return;
    }
    load(built);
    setEditMode(forEdit);
    setTab('author');
    scrollTop();
  }

  /* The row the open dialog is about, resolved from whichever list it came from. */
  const sharedGoverned =
    sharing?.kind === 'governed'
      ? governance?.reports.find((r) => r.reportId === sharing.id)
      : undefined;
  const sharedSaved =
    sharing?.kind === 'saved' ? library.find((r) => r.id === sharing.id) : undefined;

  /** Share, Delete and Request access all run through the host and report its own sentence back. */
  async function saveShare(audience: string[]) {
    const named = (n: number) => `${n} role${n === 1 ? '' : 's'}`;

    if (sharedSaved) {
      /* Local, and the row says so: this report has no governance row for the API to change. */
      setLibrary((prev) =>
        prev.map((r) => (r.id === sharedSaved.id ? { ...r, viewerRoles: audience } : r)),
      );
      setSharing(null);
      toast(
        audience.length === 0
          ? `“${sharedSaved.name}” is marked private in this browser.`
          : `“${sharedSaved.name}” is marked for ${named(audience.length)} in this browser — publish it to make that real.`,
      );
      return;
    }

    if (!sharedGoverned || !actions) return;
    setSavingShare(true);
    const result = await actions.share(sharedGoverned.reportId, audience);
    setSavingShare(false);
    if (!result.ok) {
      /* The dialog stays open on a refusal, so the choice is not lost with the sentence. */
      toast(result.error ?? 'Could not change who this report is shared with.');
      return;
    }
    setSharing(null);
    toast(
      audience.length === 0
        ? `“${sharedGoverned.title}” is private — nobody else can see that it exists.`
        : `“${sharedGoverned.title}” is shared with ${named(audience.length)}.`,
    );
  }

  async function removeGoverned(row: GovernedRow) {
    if (!actions) return;
    const result = await actions.remove(row.reportId);
    /* The server's refusal verbatim — it is the one that knows why, including the last-row case. */
    toast(
      result.ok
        ? `“${row.title}” is no longer governed. Re-seed the governance rows to bring it back.`
        : (result.error ?? 'Could not remove this definition.'),
    );
  }

  async function requestGovernedAccess(row: GovernedRow) {
    if (!actions) return;
    const result = await actions.requestAccess(row.reportId);
    if (!result.ok) {
      toast(result.error ?? 'Could not request access.');
      return;
    }
    toast(
      result.alreadyOpen
        ? `Your request for “${row.title}” was already open — nobody has answered it yet.`
        : `Requested access to “${row.title}”. It shows as pending until somebody grants it.`,
    );
  }

  function deleteReport(id: string) {
    const gone = library.find((r) => r.id === id);
    setLibrary((prev) => prev.filter((r) => r.id !== id));
    if (openedId === id) setOpenedId(null);
    toast(gone ? `Deleted “${gone.name}”.` : 'Report deleted.');
  }

  /** One writer for both Save-to-library and Publish. */
  function save(status: ReportStatus, name: string, audience: string) {
    const record: SavedReport = {
      id: openedId ?? newReportId(),
      name,
      status,
      starterId: starter.id,
      question: prompt.trim() || starter.q,
      assumptions: JSON.parse(JSON.stringify(assumptions)),
      filters: filters.map((f) => ({ ...f })),
      blocks: blocks.map((b) => ({ ...b })),
      /* The signed-in reader where the host told us, the demo persona where it did not. */
      publishedBy: identity?.name ?? META.persona_name,
      publishedRole: identity?.role ?? META.persona_role,
      savedAt: stamp(),
      audience,
    };
    setLibrary((prev) => upsert(prev, record));
    setOpenedId(record.id);
    return record;
  }

  function saveDraft() {
    const r = save('draft', opened?.name ?? starter.title, opened?.audience ?? AUDIENCE_KEY);
    toast(`Saved “${r.name}” to your library as a private draft.`);
    goTab('library');
  }

  function publish(name: string, audience: string) {
    save('published', name, audience);
    setPublishOpen(false);
    toast(`“${name}” published to ${audienceLabel(audience)} — a Domain Architect approves before it goes live.`);
    goTab('library');
  }

  /* ------------------------------------------------------------- rendering */

  const reportTitle = opened?.name ?? starter.title;

  function reportFlow(readOnly: boolean) {
    return (
      <>
        {!readOnly && <StepDots step={step} />}

        {!readOnly && step === 1 && (
          <AskPane
            prompt={prompt}
            error={error}
            graph={assumptions.graph}
            graphOptions={graphs}
            onSetGraph={(value, label) => setSlot('graph', value, label)}
            onChange={(v) => {
              setPrompt(v);
              if (error) setError(false);
            }}
            onRead={readQuestion}
            onPickStarter={pickStarter}
          />
        )}

        {!readOnly && step === 2 && (
          <ConfirmPane
            starter={starter}
            assumptions={assumptions}
            graphOptions={graphs}
            filters={filters}
            scopeRows={scopeRows}
            onSetSlot={setSlot}
            onToggleSlice={toggleSlice}
            onBack={() => go(1)}
            onBuild={build}
          />
        )}

        {(readOnly || step === 3) && (
          <ReportPane
            starter={starter}
            title={reportTitle}
            prompt={prompt.trim() || starter.q}
            graphLabel={assumptions.graph.label}
            measure={measure}
            filters={filters}
            scopeRows={scopeRows}
            rows={rows}
            blocks={blocks}
            editMode={editMode}
            selected={selected}
            readOnly={readOnly}
            provenance={
              readOnly && opened
                ? {
                    publishedBy: opened.publishedBy,
                    savedAt: opened.savedAt,
                    audience: audienceLabel(opened.audience),
                  }
                : undefined
            }
            backLabel={readOnly ? '← Back to the list' : undefined}
            onSetBlocks={setBlocks}
            onSetFilters={setFilters}
            onToggleEdit={() => {
              setEditMode((v) => !v);
              setSelected(null);
            }}
            onSelect={setSelected}
            onBack={() => {
              if (readOnly) {
                setOpenedId(null);
                scrollTop();
              } else {
                go(2);
              }
            }}
            onSaveDraft={saveDraft}
            onPublish={() => setPublishOpen(true)}
          />
        )}
      </>
    );
  }

  const narrow = tab === 'author' && step !== 3;

  /*
   * The prototype's own sidebar and page shell are gone: this renders **inside** the host
   * app's shell, which already draws the sidebar, the wordmark and the signed-in persona.
   * Keeping them would have put a second navigation rail and a second identity — a different
   * one — beside the app's own.
   *
   * `.main` stays because the tab bar's sticky positioning and the content column are its,
   * and `.shell`'s `min-height: 100vh` / flex row belonged to the two-pane layout that the
   * host now provides.
   */
  return (
    <>
      <main className="main">
        <div className="tabBar">
          <Tabs tabs={REPORT_TABS} active={tab} onSelect={goTab} />
        </div>

        <div className={'wrap' + (narrow ? ' narrow' : '')} onClick={() => setSelected(null)}>
          {tab === 'library' && (
            <LibraryPane
              mode="library"
              reports={library}
              /* Absent with no host — the prototype standing alone shows the shelf and no chips. */
              states={governance?.statuses}
              governed={governance?.reports}
              activeState={libraryState}
              onPickState={setLibraryState}
              shareRoles={shareRoles}
              /* Absent with no host, and the pane then offers no action it cannot carry out. */
              onOpenGoverned={actions ? (row) => openGoverned(row, false) : undefined}
              onEditGoverned={actions ? (row) => openGoverned(row, true) : undefined}
              /* Share only *opens* the dialog — see the note on `sharing` above for why it is here. */
              onShareGoverned={
                actions ? (row) => setSharing({ kind: 'governed', id: row.reportId }) : undefined
              }
              onRemoveGoverned={actions ? removeGoverned : undefined}
              onRequestGovernedAccess={actions ? requestGovernedAccess : undefined}
              onShareSaved={
                shareRoles?.length ? (report) => setSharing({ kind: 'saved', id: report.id }) : undefined
              }
              onAuthorNew={authorNew}
              onEdit={openForEdit}
              onDelete={deleteReport}
              onOpen={openFromLibrary}
            />
          )}

          {tab === 'author' && reportFlow(false)}

          {tab === 'audience' && (
            <UnderDevelopmentPane
              audienceName={audienceLabel(AUDIENCE_KEY)}
              publishedCount={audienceReports.length}
              onSeeLibrary={() => goTab('library')}
            />
          )}
        </div>
      </main>

      {/*
        * Beside `PublishDialog`, and for the same reason it is here: a dialog at the root of the page
        * cannot be stretched by, or stretch, anything in the grid it was opened from.
        */}
      {(sharedGoverned || sharedSaved) && (
        <ShareDialog
          reportTitle={sharedGoverned?.title ?? sharedSaved?.name ?? ''}
          roles={shareRoles ?? []}
          selected={
            sharedGoverned
              ? sharedGoverned.entitledRoles.map((r) => r.roleId)
              : (sharedSaved?.viewerRoles ?? [])
          }
          saving={savingShare}
          /* A session report has no governance row, so what is picked stays in this browser. */
          localOnly={!!sharedSaved}
          onCancel={() => setSharing(null)}
          onSave={saveShare}
        />
      )}

      {publishOpen && (
        <PublishDialog
          initialName={opened?.name ?? starter.title}
          initialAudience={opened?.audience ?? AUDIENCE_KEY}
          republish={opened?.status === 'published'}
          onCancel={() => setPublishOpen(false)}
          onConfirm={publish}
        />
      )}
    </>
  );
}
