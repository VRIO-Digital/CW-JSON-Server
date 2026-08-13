import { META } from '../../data';
import { KPI_DEFS } from '../../lib/blocks';
import { SourceTag } from '../Toast';
import type { Block, Generator, KpiKey } from '../../types';

export function KpiBlock({ block, rows }: { block: Block; rows: Generator[] }) {
  const keys: KpiKey[] = block.kpis ?? ['count', 'enf', 'penalty', 'cd'];
  return (
    <div className="kpis">
      {keys.map((k) => {
        const def = KPI_DEFS[k];
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
