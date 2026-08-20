import { META } from '../../data';
import { kpiDefs, kpiOrder } from '../../lib/blocks';
import { SourceTag } from '../Toast';
import type { Block, KpiKey, Row } from '../../types';

/**
 * The summary strip.
 *
 * **The default four were EPA's keys** — `count`, `enf`, `penalty`, `cd` — so a tenant whose tiles are
 * anything else rendered four blanks, or crashed on a missing definition. The default is now the
 * dataset's own order, and a key it does not declare is skipped rather than rendered as an empty box:
 * a tile with no label and no figure reads as a number that failed to load.
 */
export function KpiBlock({ block, rows }: { block: Block; rows: Row[] }) {
  const defs = kpiDefs();
  const keys: KpiKey[] = (block.kpis ?? kpiOrder()).filter((k) => defs[k]);
  return (
    <div className="kpis">
      {keys.map((k) => {
        const def = defs[k];
        const tone = def.tone?.(rows);
        return (
          <div className="kpi" key={k}>
            <div className={'v' + (tone ? ' ' + tone : '')}>{def.value(rows)}</div>
            <div className="l">{def.label}</div>
            <SourceTag text={META.source_trace} />
          </div>
        );
      })}
    </div>
  );
}
