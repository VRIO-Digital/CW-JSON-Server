import { FIELDS, META, PRESETS } from '../data';
import { BLOCK_TAG, KPI_DEFS, KPI_ORDER, blockSig, instantiate, isMeasure } from '../lib/blocks';
import { fieldLabel } from '../lib/format';
import { FieldPicker } from '../components/FieldPicker';
import { OptionList, useMenu } from '../components/MenuProvider';
import { TogglePicker } from '../components/TogglePicker';
import { useToast } from '../components/Toast';
import { BlockShell, MoveSeg, RemoveBtn, ToolbarDivider } from '../components/blocks/BlockShell';
import { ChartBlock } from '../components/blocks/ChartBlock';
import { FacilitiesBlock } from '../components/blocks/FacilitiesBlock';
import { FilterBar } from '../components/blocks/FilterBar';
import { KpiBlock } from '../components/blocks/KpiBlock';
import { QuarterlyBlock } from '../components/blocks/QuarterlyBlock';
import { TableBlock } from '../components/blocks/TableBlock';
import { TracesBlock } from '../components/blocks/TracesBlock';
import type {
  Block,
  BlockSpec,
  Filter,
  Generator,
  KpiKey,
  MeasureKey,
  Starter,
} from '../types';

const FILTER_BLOCK_ID = 'filters';

interface Props {
  starter: Starter;
  /** Heading — the published name when this came out of the library. */
  title: string;
  prompt: string;
  /** Label of the published graph the report was resolved against. */
  graphLabel: string;
  measure: MeasureKey;
  filters: Filter[];
  scopeRows: Generator[];
  rows: Generator[];
  blocks: Block[];
  editMode: boolean;
  selected: string | null;
  /** The audience view: no editing, no saving, no filter changes. */
  readOnly?: boolean;
  /** Byline shown in place of the draft bar when read-only. */
  provenance?: { publishedBy: string; savedAt: string; audience: string };
  backLabel?: string;
  onSetBlocks(next: Block[]): void;
  onSetFilters(next: Filter[]): void;
  onToggleEdit(): void;
  onSelect(id: string | null): void;
  onBack(): void;
  onSaveDraft(): void;
  onPublish(): void;
}

export function ReportPane({
  starter,
  title,
  prompt,
  graphLabel,
  measure,
  filters,
  scopeRows,
  rows,
  blocks,
  editMode,
  selected,
  readOnly = false,
  provenance,
  backLabel,
  onSetBlocks,
  onSetFilters,
  onToggleEdit,
  onSelect,
  onBack,
  onSaveDraft,
  onPublish,
}: Props) {
  const { open } = useMenu();
  const toast = useToast();
  const isGeneratorReport = starter.spine === 'generators';

  /* --------------------------------------------------------- mutations */

  function patch(id: string, changes: Partial<Block>) {
    onSetBlocks(blocks.map((b) => (b.id === id ? { ...b, ...changes } : b)));
  }

  function move(id: string, dir: -1 | 1) {
    const i = blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onSetBlocks(next);
  }

  function remove(id: string) {
    onSetBlocks(blocks.filter((b) => b.id !== id));
    onSelect(null);
    toast('Block removed. Nothing is saved until you save the draft.');
  }

  function add(spec: BlockSpec) {
    const block = instantiate(spec);
    onSetBlocks([...blocks, block]);
    onSelect(block.id);
    toast(`Added “${spec.title}”.`);
  }

  /* ----------------------------------------------------------- toolbars */

  function toolbarFor(b: Block) {
    const i = blocks.findIndex((x) => x.id === b.id);
    const common = (
      <>
        <ToolbarDivider />
        <MoveSeg
          canUp={i > 0}
          canDown={i < blocks.length - 1}
          onUp={() => move(b.id, -1)}
          onDown={() => move(b.id, 1)}
        />
        <ToolbarDivider />
        <RemoveBtn onRemove={() => remove(b.id)} />
      </>
    );

    switch (b.type) {
      case 'kpis':
        return (
          <>
            <button
              onClick={(e) =>
                open(
                  e,
                  <TogglePicker<KpiKey>
                    title="Which tiles?"
                    options={KPI_ORDER.map((k) => ({ key: k, label: KPI_DEFS[k].label }))}
                    selected={b.kpis ?? []}
                    onChange={(next) => patch(b.id, { kpis: next })}
                  />,
                )
              }
            >
              ▦ Tiles
            </button>
            {common}
          </>
        );

      case 'chart':
        return (
          <>
            <button
              onClick={(e) =>
                open(
                  e,
                  <FieldPicker
                    title="Chart this measure"
                    fields={FIELDS.filter((f) => f.kind === 'num')}
                    onPick={(key) => {
                      if (!isMeasure(key)) return;
                      patch(b.id, { measure: key, title: `${fieldLabel(key)} by generator` });
                    }}
                  />,
                  'picker',
                )
              }
            >
              ∑ {fieldLabel(b.measure ?? 'penalty')}
            </button>
            <span className="seg">
              <button
                className={b.chartType !== 'column' ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  patch(b.id, { chartType: 'bar' });
                }}
              >
                Bars
              </button>
              <button
                className={b.chartType === 'column' ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  patch(b.id, { chartType: 'column' });
                }}
              >
                Columns
              </button>
            </span>
            {common}
          </>
        );

      case 'table':
        return (
          <>
            <button
              onClick={(e) =>
                open(
                  e,
                  <TogglePicker<string>
                    title="Columns"
                    options={FIELDS.filter((f) => f.avail !== false).map((f) => ({ key: f.key, label: f.label }))}
                    selected={b.cols ?? []}
                    onChange={(next) => patch(b.id, { cols: next })}
                  />,
                )
              }
            >
              ▤ Columns
            </button>
            <button
              onClick={(e) =>
                open(
                  e,
                  <FieldPicker
                    title="Add a column"
                    fields={FIELDS}
                    onPick={(key) => {
                      const cols = b.cols ?? [];
                      if (cols.includes(key)) {
                        toast(`“${fieldLabel(key)}” is already a column.`);
                        return;
                      }
                      patch(b.id, { cols: [...cols, key] });
                    }}
                  />,
                  'picker',
                )
              }
            >
              + Field
            </button>
            {common}
          </>
        );

      case 'quarterly':
        return (
          <>
            <span className="seg">
              <button
                className={(b.metric ?? 'tons') === 'tons' ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  patch(b.id, { metric: 'tons' });
                }}
              >
                Tons
              </button>
              <button
                className={b.metric === 'manifests' ? 'on' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  patch(b.id, { metric: 'manifests' });
                }}
              >
                Manifests
              </button>
            </span>
            {common}
          </>
        );

      default:
        return common;
    }
  }

  const filterToolbar = (
    <>
      <button
        onClick={(e) =>
          open(
            e,
            <FieldPicker
              title="Filter on which field?"
              fields={FIELDS.filter((f) => f.filterable || f.avail === false)}
              onPick={(key) => {
                if (filters.some((f) => f.key === key)) {
                  toast(`Already filtering on ${fieldLabel(key)}.`);
                  return;
                }
                onSetFilters([...filters, { key, val: 'All' }]);
              }}
            />,
            'picker',
          )
        }
      >
        + Add filter
      </button>
      {filters.length > 0 && (
        <>
          <ToolbarDivider />
          <button
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              onSetFilters([]);
            }}
          >
            ✕ Clear all
          </button>
        </>
      )}
    </>
  );

  /* ------------------------------------------------------------- render */

  function body(b: Block) {
    switch (b.type) {
      case 'kpis':
        return <KpiBlock block={b} rows={rows} />;
      case 'chart':
        return <ChartBlock block={b} rows={rows} />;
      case 'table':
        return <TableBlock block={b} rows={rows} measure={measure} />;
      case 'facilities':
        return <FacilitiesBlock block={b} />;
      case 'quarterly':
        return <QuarterlyBlock block={b} />;
      case 'traces':
        return <TracesBlock block={b} />;
    }
  }

  const present = new Set(blocks.map(blockSig));
  const addable = PRESETS.filter((p) => !present.has(blockSig(p.block)));

  return (
    <div className="pane on">
      <div className="repHead">
        <div>
          <h1>{title}</h1>
          <div className="rq">“{prompt}”</div>
        </div>
        <div className="racts">
          <button className="btn ghost sm" onClick={onBack}>
            {backLabel ?? '← Adjust question'}
          </button>
          {!readOnly && (
            <button className="btn sm" onClick={onToggleEdit}>
              {editMode ? '✓ Done editing' : '✎ Edit report'}
            </button>
          )}
        </div>
      </div>

      <div className="trust">
        <span className="dotg" />
        <span>
          Resolved just now from <b>{graphLabel}</b> under <b>your</b> access —{' '}
          <b>
            {isGeneratorReport
              ? `${rows.length} of ${scopeRows.length} ${META.entity_plural}`
              : META.scope_line}
          </b>
          . Every number traces to source.{' '}
          {readOnly ? <b>Published — read-only.</b> : <b>Nothing saved yet.</b>}
        </span>
      </div>

      {editMode && (
        <div className="editBanner">
          <span className="t">
            <b>Editing.</b> Click any block to change what it shows, reorder it, or take it out.
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={onToggleEdit}>
            Done
          </button>
        </div>
      )}

      <div className={'stack' + (editMode ? ' editing' : '')}>
        {/* The audience gets no filter controls, and an empty filter bar would
            only invite them to use one. */}
        {isGeneratorReport && !(readOnly && filters.length === 0) && (
          <BlockShell
            tag="Filters"
            editMode={editMode}
            selected={selected === FILTER_BLOCK_ID}
            onSelect={() => onSelect(FILTER_BLOCK_ID)}
            toolbar={filterToolbar}
          >
            <FilterBar
              filters={filters}
              scopeRows={scopeRows}
              readOnly={readOnly}
              onSet={(key, val) => onSetFilters(filters.map((f) => (f.key === key ? { ...f, val } : f)))}
              onRemove={(key) => onSetFilters(filters.filter((f) => f.key !== key))}
            />
          </BlockShell>
        )}

        {blocks.map((b) => (
          <BlockShell
            key={b.id}
            tag={BLOCK_TAG[b.type]}
            editMode={editMode}
            selected={selected === b.id}
            onSelect={() => onSelect(b.id)}
            toolbar={toolbarFor(b)}
          >
            {body(b)}
          </BlockShell>
        ))}

        {blocks.length === 0 && (
          <div className="panel">
            <div className="emptyBlock">
              This report has no blocks left. Add one below to put something back.
            </div>
          </div>
        )}
      </div>

      {editMode && (
        <div className="addBlockRow">
          <button
            className="addBlockBtn"
            onClick={(e) =>
              open(
                e,
                <OptionList
                  title="Add a block"
                  items={
                    addable.length
                      ? addable.map((p) => ({
                          label: p.label,
                          d: p.d,
                          onPick: () => add(p.block),
                        }))
                      : [
                          {
                            label: 'Everything I can build is already here',
                            d: 'Remove a block to free its slot, or change one in place.',
                            onPick: () => {},
                          },
                        ]
                  }
                />,
              )
            }
          >
            + Add a block — chart, table, facility comparison, trend or manifest traces
          </button>
        </div>
      )}

      {readOnly ? (
        <div className="footBar">
          <span className="draft">
            {provenance ? (
              <>
                Published by <b>{provenance.publishedBy}</b> on <b>{provenance.savedAt}</b> to the{' '}
                <b>{provenance.audience}</b> audience.
              </>
            ) : (
              <>Published report — read-only.</>
            )}
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={onBack}>
            ← Back to the list
          </button>
        </div>
      ) : (
        <div className="footBar">
          <span className="draft">
            <b>Draft.</b> Save it to your library, or publish it so your audience sees it.
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={onSaveDraft}>
            Save to library
          </button>
          <button className="btn pri sm" onClick={onPublish}>
            Publish…
          </button>
        </div>
      )}

      <div className="note">
        Exploration only — demo data. Proposal for how a compliance user authors and edits a report; not wired to the
        live graph.
      </div>
    </div>
  );
}
