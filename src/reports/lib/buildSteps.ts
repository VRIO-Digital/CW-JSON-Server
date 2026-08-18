import { BLOCK_TAG } from './blocks';
import type { BlockSpec, Spine } from '../types';

/*
 * What "Build the report" is doing, said one step at a time.
 *
 * Building was a three-second spinner on a button: something was happening, and the button
 * could not say what. This is the same act narrated — the four things composing a report
 * actually does, in the order it does them, each one **stating the value it used**.
 *
 * **A pure function, not copy inside the dialog.** The dialog only ever renders while
 * `working === 'build'`, so `renderToString` renders it shut and every assertion about what
 * the steps say would pass over nothing. Held here it can be called directly by a test — the
 * same reason `src/data/connectSteps.ts` and `src/data/sourceActions.ts` exist.
 *
 * **Nothing here describes work that does not happen.** Each step names something the build
 * really does: the graph the report is pinned to, the rows `selectRows` returned, the measure
 * they are ordered by, and the blocks `instantiate` is about to make. A step for a stage that
 * does not exist is the same lie as a spinner that ticks with no request behind it — which is
 * why there is no "querying the graph" step: nothing here queries anything, the prototype
 * composes over its own dataset.
 */

export interface BuildStage {
  id: string;
  /** The act, in the imperative — what is happening right now. */
  label: string;
  /** The value it used, so a five-second wait says which report is being built. */
  detail: string;
}

export interface BuildStageInput {
  /** The published graph the report is asked of. */
  graphLabel: string;
  /** Rows after the scope *and* the filter chips — what the blocks will draw. */
  rowCount: number;
  /** The whole register, so the selection reads as a fraction of something. */
  totalCount: number;
  /** "inbound generators" — the dataset's own noun, never one written here. */
  entityPlural: string;
  /**
   * The sentence for a spine that is not the generator register.
   *
   * `selectRows` only ever selects generators, so a facilities or quarterly report counting
   * "36 of 36 inbound generators" would be naming a selection that never ran against it —
   * the same claim `ConfirmPane` avoids by printing `META.scope_line` for those spines.
   */
  scopeLine: string;
  spine: Spine;
  /** "penalty exposure" — the assumption's own label, as the read-back sentence prints it. */
  measureLabel: string;
  /** How many filter chips are on. Named because they narrow what the figures describe. */
  filterCount: number;
  blocks: BlockSpec[];
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function buildStages({
  graphLabel,
  rowCount,
  totalCount,
  entityPlural,
  scopeLine,
  spine,
  measureLabel,
  filterCount,
  blocks,
}: BuildStageInput): BuildStage[] {
  /* The block kinds this report is made of, in the order they will appear, named as the
     toolbar names them. De-duplicated: "Chart · Chart · Table" describes the same report as
     "Chart · Table" and reads as a stutter. */
  const kinds = [...new Set(blocks.map((b) => BLOCK_TAG[b.type]))];

  return [
    {
      id: 'graph',
      label: 'Pinning the graph',
      detail: `${graphLabel} — the published content every figure traces back to.`,
    },
    {
      id: 'rows',
      label: 'Selecting the rows',
      detail:
        spine === 'generators'
          ? `${rowCount} of ${totalCount} ${entityPlural}` +
            (filterCount > 0 ? `, narrowed by ${plural(filterCount, 'filter')}.` : '.')
          : `${scopeLine}.`,
    },
    {
      id: 'measure',
      label: `Ranking by ${measureLabel}`,
      detail: 'Every selected row ordered by that measure — no figure is estimated.',
    },
    {
      id: 'blocks',
      label: `Composing ${plural(blocks.length, 'block')}`,
      detail: kinds.length > 0 ? kinds.join(' · ') : 'An empty report — add blocks once it opens.',
    },
    {
      id: 'draft',
      label: 'Laying out the draft',
      detail: 'It stays private to you until you publish it.',
    },
  ];
}
