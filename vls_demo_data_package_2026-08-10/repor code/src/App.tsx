import { useMemo, useState } from 'react';
import { META, STARTERS } from './data';
import { assumptionsForStarter, freshAssumptions } from './lib/assumptions';
import { instantiate, isMeasure } from './lib/blocks';
import { audienceLabel, newReportId, seedLibrary, stamp, upsert } from './lib/library';
import { hasFilter, scopeSet, selectRows } from './lib/select';
import { PublishDialog } from './components/PublishDialog';
import { Sidebar } from './components/Sidebar';
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

export default function App() {
  const toast = useToast();

  const [tab, setTab] = useState<ReportTab>('library');
  const [library, setLibrary] = useState<SavedReport[]>(seedLibrary);

  /* ------------------------------------------------------- authoring state */
  const [step, setStep] = useState<Step>(1);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState(false);
  const [starter, setStarter] = useState<Starter>(STARTERS[0]);
  const [assumptions, setAssumptions] = useState<Assumptions>(freshAssumptions);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

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
      publishedBy: META.persona_name,
      publishedRole: META.persona_role,
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

  return (
    <div className="shell">
      <Sidebar reportCount={library.length} onNavigate={() => goTab('library')} />

      <main className="main">
        <div className="tabBar">
          <Tabs tabs={REPORT_TABS} active={tab} onSelect={goTab} />
        </div>

        <div className={'wrap' + (narrow ? ' narrow' : '')} onClick={() => setSelected(null)}>
          {tab === 'library' && (
            <LibraryPane
              mode="library"
              reports={library}
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

      {publishOpen && (
        <PublishDialog
          initialName={opened?.name ?? starter.title}
          initialAudience={opened?.audience ?? AUDIENCE_KEY}
          republish={opened?.status === 'published'}
          onCancel={() => setPublishOpen(false)}
          onConfirm={publish}
        />
      )}
    </div>
  );
}
