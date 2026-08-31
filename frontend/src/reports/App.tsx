import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GENERATORS, META, OPTS, STARTERS } from './data';
import { assumptionsForStarter, freshAssumptions } from './lib/assumptions';
import { instantiate, isMeasure, measures } from './lib/blocks';
import { buildStages } from './lib/buildSteps';
import { BuildRunDialog } from './components/BuildRunDialog';
import { BuildSpecDialog } from './components/BuildSpecDialog';
import {
  audienceLabel,
  fromGoverned,
  nameProblem,
  newReportId,
  seedLibrary,
  stamp,
  upsert,
} from './lib/library';
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
  /**
   * The roles the audience names, resolved. **Stated and not acted on**: the request-access /
   * pending-approval state that once gated a row on this was removed, and nothing here gates on it.
   * Which is the honest position anyway — the role is client-held and the API serves every row to a
   * caller that names none, so a gate built on it could never have been access control.
   */
  entitledRoles: { roleId: string; label: string }[];
}

/**
 * Somebody the publish dialog can pick.
 *
 * A **person**, shown with their name and address, whose **role** is what an audience stores —
 * `viewerRoles` is the audience model everything else in this section reads, and an address here
 * would be a second one. `scope` and `masked` are that persona's declared data scope, printed
 * beside them and applied nowhere: no roster is filtered per persona, so a count would state a
 * filter that never ran.
 */
export interface Person {
  email: string;
  name: string;
  roleId: string;
  roleLabel: string;
  scope: string | null;
  masked: string | null;
}

/** The publish dialog's copy, served rather than written here. */
export interface Publishing {
  title: string;
  republishTitle: string;
  lead: string;
  name: { label: string; help: string; placeholder: string };
  readers: {
    label: string;
    placeholder: string;
    empty: string;
    note: string;
    caveat: string;
    localCaveat: string;
  };
  freshness: {
    label: string;
    presets: { id: string; label: string; sentence: string }[];
    default: string;
  };
  foot: string;
  buttons: { publish: string; republish: string; cancel: string };
}

export interface Governance {
  statuses: GovernanceState[];
  reports: GovernedRow[];
  people: Person[];
  publishing: Publishing;
  /**
   * Definitions the tenant has that nothing governs — normally empty, and stated on the page when it
   * is not. A shorter list with nothing explaining it reads as data loss; this is the explanation,
   * and `restore` is the command that ends it.
   */
  ungoverned?: { reportId: string; reportTag: string; title: string }[];
  restore?: string;
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
}

/** The chip that leads the bar. Not a stored state — the server counts it as everything not archived. */
const ALL_CURRENT = 'current';

/**
 * "3 roles" / "1 role" — said the same way by Share and by Publish, which both change the same
 * field. Two copies of this drifted into "3 roles" and "3 people" for one audience.
 */
const named = (n: number) => `${n} role${n === 1 ? '' : 's'}`;

/**
 * How long the two authoring steps take, and why they take any time at all.
 *
 * Reading a question back and composing a report are the section's two pieces of *work*, and both were
 * instant: the button moved the step and the next pane was simply there. An operation that returns
 * instantly and shows nothing teaches that it is free — the same reason the profiler's stages, the
 * suggesters and the graph build are all paced, and the reason `POST /reports/read` is paced server-side
 * while `POST /reports/build` is not.
 *
 * **Client-side here because there is no request behind them.** These steps run against the prototype's
 * own dataset, so there is nothing whose return could advance them; everywhere a request *does* exist,
 * the rule stands — a stage advances when its call returns, never on a timer.
 *
 * Building is the longer of the two because it is the heavier act: it instantiates every block.
 *
 * **Building is paced per step, not as one hold.** It used to be a single 3s wait behind a button
 * that could only say "Building your report…". It is now `BUILD_STAGE_MS` per step of
 * `buildStages()`, narrated in a dialog — so the total is the list's length times this number and
 * is never written down anywhere: add a step and the run gets longer, which is the point. The same
 * derivation the graph build's panel makes from `step_ms`.
 *
 * A step is paced to be **read** rather than merely seen: each one states the value it used, and a
 * row that comes and goes faster than its own sentence can be read is a spinner with extra frames.
 * It is the pace `ASK_BLOCK_MS` gives a paragraph of an answer, and slower than the graph build's
 * 3s a substep — which makes the whole run minutes-adjacent rather than instant, and is why the
 * dialog lists every step from the first frame and says which one it is on. `check-docs` reads this
 * number and fails if the docs quote a different one.
 */
const READ_MS = 2_000;
const BUILD_STAGE_MS = 5_000;

/**
 * How long the narration runs before a framed specification takes over.
 *
 * **The spec branch narrates the same steps first**, because the wait is real work being described and
 * a document appearing the instant the button is pressed teaches that composing a report is free —
 * which is the reason every other act in this app is paced. What differs is that the steps are the
 * *preamble* here rather than the event: what ends this wait is a document to read, so the number that
 * matters is how long the reader waits in total, not how long a row is legible for.
 *
 * **So it is a stated total and the pace is derived from it** — `SPEC_RUN_MS / steps` — which is the
 * opposite derivation from `BUILD_STAGE_MS`, deliberately: adding a step there makes the run longer,
 * and adding one here makes each row shorter. Neither number is written down twice, and `check-docs`
 * reads both and fails on a doc quoting a different one.
 */
const SPEC_RUN_MS = 10_000;

/** Which step is running, so the pane can disable its button and say so. */
export type Working = 'read' | 'build' | null;

export default function App({
  identity,
  graphOptions,
  governance,
  shareRoles,
  actions,
  reportActions,
  hostOpenableIds,
  onOpenPublished,
  buildSpecs,
}: {
  identity?: ReportsIdentity;
  graphOptions?: GraphOption[];
  governance?: Governance | null;
  /** The role pool, served — never a list this component keeps. */
  shareRoles?: ShareRole[];
  actions?: GovernanceActions;
  /**
   * Which of a governed row's three acts this reader is offered — `{ open, edit, delete }`.
   *
   * **Declared as a plain record rather than imported from the host's client**, exactly as `Governance`
   * and `GraphOption` are: absent the prop this folder is the standalone prototype it was, offering every
   * act it can carry out.
   *
   * **It withholds a handler rather than adding a gate to the card.** `GovernedCard` already shows a
   * button only where there is a handler to run — "each action is offered only where it can be carried
   * out" — so a withheld permission is simply no callback. That is deliberate: a card that tested a
   * permission field of its own would be the shape of the access gate this section removed, where a row
   * whose payload stopped carrying the field rendered with no actions at all.
   *
   * **And it is not access control.** The persona is client-held and the API serves every report to a
   * caller that names no role; the Settings tab that sets this says so in those words.
   *
   * Session reports are deliberately *not* gated by it — those are the reader's own drafts, held in this
   * browser and submitted to nobody, so withholding "edit" on one would stop somebody editing work they
   * just made. What this governs is the tenant's governed definitions.
   */
  reportActions?: Record<string, boolean>;
  /**
   * Report ids the host can render itself, with no starter in this folder behind them.
   *
   * A host may serve reports that are **rendered documents** — a finished file rather than an authoring
   * definition. `Open` then works because the host can frame it; `Edit` still does not, because there is
   * nothing here to author, and offering it would be a button that opens an empty authoring pane.
   */
  hostOpenableIds?: string[];
  /**
   * Open a governed report as the host's *published* report — the rendered thing an audience reads.
   *
   * The fourth callback in the same shape as `actions`, and the vendored prototype's only knowledge of
   * it: it hands over an id and the host renders. With no host it is absent and **Open report** keeps
   * doing what it always did, so this folder standing alone is still exactly the prototype it was.
   *
   * `Open` and `Edit` stop being the same act, which is what their labels already claimed: Open reads
   * the published report, Edit loads the authoring definition behind it.
   */
  /**
   * Open a governed report as the host's own — the rendered thing an audience reads.
   *
   * **Reading only.** Editing loads the row's authoring starter in this pane, which is what editing means
   * and what makes Save work; a host that serves rendered documents supplies a starter per report so that
   * path resolves for its rows too.
   */
  onOpenPublished?: (reportId: string) => void;
  /**
   * Report id -> the URL of the specification document that says how that report is built.
   *
   * **A dataset can ship the account of its own report instead of having one narrated.** Building here
   * is `buildStages()` said a step at a time, each naming the value it used, because for the primary
   * dataset that is all there is to say. A dataset that ships a rendered report ships a specification
   * beside it — what the agent resolved, the measures it bound, the sources behind them — and five
   * generic steps in front of a reader who could be reading that is a summary standing in front of the
   * real account. So the spec is framed in place of them, and a report with none narrates as before.
   *
   * **URLs rather than filenames, because turning one into the other is the host's job.** One
   * `import.meta.glob` in `src/data/reportDocuments.ts` is the single copy of every framed document's
   * address; a second lookup in this folder would be a second answer to where a file is. Absent the
   * prop this folder is the standalone prototype it was.
   */
  buildSpecs?: Record<string, string>;
} = {}) {
  const toast = useToast();

  /*
   * Whether this reader is offered one act. **Absent means allowed**, which is the rule the sidebar's
   * own permissions follow: an unconfigured key means "not configured", never "denied", and a Library
   * whose buttons appeared a moment after its cards would read as a broken page rather than as a
   * permission model. With no prop at all — the prototype standing alone — every act is offered.
   */
  const may = (action: string) => reportActions?.[action] !== false;

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

  /**
   * Which authoring step is running, and the timer running it.
   *
   * The ref is not a nicety: leaving the tab, or clicking through to the Library, unmounts nothing here
   * but *does* change what the pending callback would do — and an unmount mid-step would fire `setState`
   * on a dead component. Cleared on unmount and before each new run, so only one step is ever in flight.
   */
  const [working, setWorking] = useState<Working>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRun = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearRun, [clearRun]);

  /** Holds `label` for `ms`, then does the work. One step at a time. */
  const run = useCallback(
    (label: Exclude<Working, null>, ms: number, done: () => void) => {
      clearRun();
      setWorking(label);
      timer.current = setTimeout(() => {
        timer.current = null;
        setWorking(null);
        done();
      }, ms);
    },
    [clearRun],
  );

  /**
   * Which build step is on screen. An index into `buildStages()`, so the dialog's rows, its
   * "step 2 of 5" line and how long the run takes all come from one list.
   */
  const [buildStep, setBuildStep] = useState(0);

  /**
   * Walks the steps, one `BUILD_STAGE_MS` each, then does the work.
   *
   * Chained timeouts rather than an interval, and always through the same `timer` ref: one
   * timer is pending at any moment, so `clearRun` on unmount stops the whole run rather than
   * the step it happens to be on. A second `setInterval` held elsewhere is how a callback
   * fires into a dead component.
   */
  const runStages = useCallback(
    /* The pace is a parameter with the narrated build's own value as its default, so the spec branch
       can hold the same list for a different total without a second copy of this walk. */
    (count: number, done: () => void, stepMs: number = BUILD_STAGE_MS) => {
      clearRun();
      setWorking('build');
      setBuildStep(0);
      const step = (i: number) => {
        timer.current = setTimeout(() => {
          timer.current = null;
          if (i + 1 < count) {
            setBuildStep(i + 1);
            step(i + 1);
            return;
          }
          setWorking(null);
          setBuildStep(0);
          done();
        }, stepMs);
      };
      step(0);
    },
    [clearRun],
  );

  /**
   * Which report the draft on screen *is*, for the purpose of showing its specification — and `null`
   * where the answer is "none of them".
   *
   * It is not `starter.id`, and the difference is the whole reason this exists. A freely typed question
   * falls back to `STARTERS[0]` because that is the only spine this engine composes on, so keying the
   * spec off the starter would frame the first report's specification over a question nobody asked of
   * it — a document making a specific claim (its version, its measures, its published state) about a
   * draft it does not describe. So it is set only where the reader really chose that report: a starter
   * card, or a row opened from the Library.
   */
  const [specFor, setSpecFor] = useState<string | null>(null);

  /**
   * The spec document to frame instead of narrating the steps, or `undefined` for the narrated build.
   *
   * Two conditions, both required: the reader is building a named report, and the host resolved a
   * document for it. A dataset that ships no specs never has one, which is why nothing about the
   * narrated build changed.
   */
  const specUrl = specFor ? buildSpecs?.[specFor] : undefined;

  /** The spec dialog's own URL while it is open — set by `build()`, cleared when the draft opens. */
  const [specOpen, setSpecOpen] = useState<string | null>(null);

  /** Set when the open report already exists in the library. */
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const scopeRows = useMemo(() => scopeSet(assumptions.scope.value), [assumptions.scope.value]);
  const rows = useMemo(() => selectRows(assumptions, filters), [assumptions, filters]);
  /* The measure slot's *value* is the column a chart and a table rank by, and its label is the tenant's
     words for it — which is why a dataset's options carry its own column keys. The fallback is the
     dataset's first measure, not 'penalty': that is a column only one dataset has, and ranking by a
     column that is not there sorts every row to zero and says nothing. */
  const measure: MeasureKey = isMeasure(assumptions.measure.value)
    ? assumptions.measure.value
    : (measures()[0] ?? '');

  /*
   * What the build dialog narrates, computed from the state the build is about to use — so a
   * step names the graph, the rows and the measure this run actually has, rather than describing
   * building in general. Recomputed with them; the dialog is open only while nothing can change.
   */
  const buildSteps = useMemo(
    () =>
      buildStages({
        graphLabel: assumptions.graph.label,
        rowCount: rows.length,
        totalCount: GENERATORS.length,
        entityPlural: META.entity_plural,
        scopeLine: META.scope_line,
        spine: starter.spine,
        measureLabel: assumptions.measure.label,
        filterCount: filters.length,
        blocks: starter.blocks,
      }),
    [assumptions.graph.label, assumptions.measure.label, rows.length, starter, filters.length],
  );

  /**
   * How long each narrated row holds on the spec branch: the stated total over the steps there are.
   *
   * Derived rather than typed, so the run is `SPEC_RUN_MS` however many steps `buildStages()` returns —
   * a number in the component would be a second answer to how long a reader waits, and it is the
   * duration `check-docs` holds the docs to.
   */
  const specStepMs = Math.round(SPEC_RUN_MS / Math.max(1, buildSteps.length));

  const opened = openedId ? library.find((r) => r.id === openedId) : undefined;

  const REPORT_TABS: TabDef<ReportTab>[] = [
    { key: 'library', label: 'Library', count: library.length },
    { key: 'author', label: 'Author a report' },
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
    /* A blank question names no report yet — the fallback starter is the engine's spine, not a choice. */
    setSpecFor(null);
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
    /* Chosen by name, so its specification describes what is about to be built. */
    setSpecFor(s.id);
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
    /*
     * **The refusal is immediate.** Errors are never paced anywhere in this app — a two-second wait for
     * "you did not type a question" is the app pretending to think about nothing.
     */
    if (!p) {
      setError(true);
      return;
    }
    setError(false);
    if (p !== starter.q) {
      setStarter(STARTERS[0]);
      /* Their own question, on the fallback spine: whatever spec was in play no longer describes it. */
      setSpecFor(null);
      setAssumptions(freshAssumptions(assumptions.graph));
      setFilters([]);
      setOpenedId(null);
    }
    run('read', READ_MS, () => go(2));
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
    /*
     * **Where the dataset ships a specification for this report, the wait ends in that document.**
     * The narrated steps are what this engine can say about composing a report in general; a spec is
     * the dataset's own account of how *that* report is built, and a summary left standing in front
     * of the real account is the one thing this section refuses everywhere else.
     *
     * **The steps still run — they are the preamble, not something the document replaces.** Same
     * list, same rows, held for `SPEC_RUN_MS` in total rather than `BUILD_STAGE_MS` each: what comes
     * next is a page to read rather than the report, so what the reader is owed is a wait that ends
     * when they expect it to, not five rows each legible for five seconds. Then the frame opens, and
     * it has no timer of its own — a document is paced by being read, and a dialog that dismissed
     * itself would take the page away mid-sentence.
     *
     * The draft is composed on the way *out* of that dialog — see `openFromSpec` — so nothing is
     * half-built behind it, which is the same reason the narrated branch instantiates at the end.
     */
    if (specUrl) {
      runStages(buildSteps.length, () => setSpecOpen(specUrl), specStepMs);
      return;
    }
    /* The blocks are instantiated at the end, not per step: a report half-composed behind a
       dialog would open onto whichever steps had run if anything ever interrupted it. */
    runStages(buildSteps.length, () => {
      setBlocks(starter.blocks.map(instantiate));
      go(3);
    });
  }

  /** The spec has been read; compose the draft and open it — the same two acts the narrated run ends on. */
  function openFromSpec() {
    setSpecOpen(null);
    setBlocks(starter.blocks.map(instantiate));
    go(3);
  }

  /* ----------------------------------------------------------- library flow */

  /** Loads a saved report back into the authoring state. */
  function load(r: SavedReport) {
    setStarter(STARTERS.find((s) => s.id === r.starterId) ?? STARTERS[0]);
    /* A row carries the report it is, so its spec describes it however its question was worded —
       which is why this is state rather than a comparison of the prompt against `starter.q`: a
       governed row's question is the tenant's, and the starter's is the package's. */
    setSpecFor(r.starterId);
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
    /*
     * Reading is the host's job now. A published report is computed from the tenant's rosters and
     * rendered in the format its audience sees; loading the authoring definition instead would show the
     * prototype's own sample figures under a card that says "Published", which is the one thing a
     * governed row must not do. Editing still loads the definition, because that is what editing is.
     */
    if (!forEdit && onOpenPublished) {
      onOpenPublished(row.reportId);
      return;
    }

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

  /**
   * Every name a published report already occupies — **across the whole list**, governed definitions
   * and session reports alike, because they sit in one grid and a reader does not know which
   * collection a name came from. Every governed definition here is published by definition; a session
   * report counts only once it has been published locally.
   */
  const takenNames = [
    ...(governance?.reports ?? []).map((r) => ({
      id: r.reportId,
      name: r.title,
      published: true,
    })),
    ...library.map((r) => ({ id: r.id, name: r.name, published: r.status === 'published' })),
  ];

  /* One rule, both paths: the dialog checks as you type, Save draft checks before it writes. */
  const problemFor = (name: string) => nameProblem(name, takenNames, openedId);

  function saveDraft() {
    const name = opened?.name ?? starter.title;
    /*
     * A draft may share a name with another draft, so this only fires when a *published* report
     * already holds it. Save draft has no name field to show the error beside, so it toasts and
     * leaves the report unsaved rather than writing a second row under a name already in use.
     */
    const problem = problemFor(name);
    if (problem) {
      toast(problem);
      return;
    }
    const r = save('draft', name, opened?.audience ?? AUDIENCE_KEY);
    toast(`Saved “${r.name}” to your library as a private draft.`);
    goTab('library');
  }

  /**
   * Publish: name it, say who may open it, say how fresh the figures stay.
   *
   * **No approval step, and the toast no longer claims one.** It used to end "— a Domain Architect
   * approves before it goes live", which described the three-act model (publish → approve →
   * activate) that was collapsed to publish/unpublish. The report went live immediately either
   * way, so the sentence was a promise the code never kept.
   */
  function publish(name: string, audience: string, viewerRoles: string[], freshness: string) {
    /* The dialog will not submit a name this refuses; checked again because it is the writer. */
    const problem = problemFor(name);
    if (problem) {
      toast(problem);
      return;
    }
    const record = save('published', name, audience);
    /* The readers and the schedule are the report's own, and they stay in this browser — the
       prototype does not post its saved reports, which is what `localOnly` tells the dialog. */
    setLibrary((prev) =>
      prev.map((r) => (r.id === record.id ? { ...r, viewerRoles, freshness } : r)),
    );
    setPublishOpen(false);
    toast(
      viewerRoles.length === 0
        ? `“${name}” is published and private — nobody else is named on it yet.`
        : `“${name}” is published to ${named(viewerRoles.length)}.`,
    );
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
            reading={working === 'read'}
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
            building={working === 'build'}
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
            /* Refused with the reason rather than opening a dialog that cannot describe itself:
               the readers and every string in it are served, so without them there is nothing to
               show. A button that silently does nothing is the failure this section avoids. */
            onPublish={() =>
              governance
                ? setPublishOpen(true)
                : toast('The publish dialog is still loading its reader directory — try again in a moment.')
            }
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
              ungoverned={governance?.ungoverned}
              restore={governance?.restore}
              /* Absent with no host, and the pane then offers no action it cannot carry out. */
              onOpenGoverned={
                actions && may('open') ? (row) => openGoverned(row, false) : undefined
              }
              onEditGoverned={actions && may('edit') ? (row) => openGoverned(row, true) : undefined}
              /* Share only *opens* the dialog — see the note on `sharing` above for why it is here. */
              onShareGoverned={
                actions ? (row) => setSharing({ kind: 'governed', id: row.reportId }) : undefined
              }
              onRemoveGoverned={actions && may('delete') ? removeGoverned : undefined}
              hostOpenableIds={hostOpenableIds}
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
        </div>
      </main>

      {/*
        * The build, while it runs. At the root beside the other two dialogs rather than inside
        * `ConfirmPane`: the pane it was started from is about to be replaced by the report, and a
        * dialog rendered inside it would unmount mid-run on the step that replaces it.
        *
        * The button in the pane still disables and still says it is building — this states *what*
        * is being built, which a disabled button cannot.
        */}
      {working === 'build' && (
        <BuildRunDialog stages={buildSteps} current={buildStep} reportTitle={reportTitle} />
      )}

      {/*
        * One or the other, never both: `build()` takes the spec branch or the narrated one, so
        * `working` is never `'build'` while a spec is open.
        */}
      {specOpen && (
        <BuildSpecDialog url={specOpen} reportTitle={reportTitle} onOpen={openFromSpec} />
      )}

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

      {/*
        * Only with a served directory and copy. Standing alone the prototype has neither, and a
        * dialog that offered an empty reader list would read as "nobody exists" rather than as the
        * host not having passed one — so the older name-only dialog is what that branch keeps.
        */}
      {publishOpen && governance && (
        <PublishDialog
          initialName={opened?.name ?? starter.title}
          initialAudience={opened?.audience ?? AUDIENCE_KEY}
          initialViewerRoles={opened?.viewerRoles ?? []}
          republish={opened?.status === 'published'}
          publishing={governance.publishing}
          people={governance.people}
          /* A report saved here never leaves the browser, so its readers stay here too. */
          localOnly
          nameProblem={problemFor}
          onCancel={() => setPublishOpen(false)}
          onConfirm={publish}
        />
      )}
    </>
  );
}
