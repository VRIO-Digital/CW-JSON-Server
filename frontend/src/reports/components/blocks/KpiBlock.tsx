import { META } from '../../data';
import { kpiOrder, kpiSpec, kpiText, kpiTone } from '../../lib/blocks';
import { SourceTag } from '../Toast';
import type { Block, Generator, KpiKey } from '../../types';

export function KpiBlock({ block, rows }: { block: Block; rows: Generator[] }) {
  /* The dataset's own first four when the block names none — not EPA's four, which a second dataset
     does not have and which rendered as four tiles reading 0. */
  const keys: KpiKey[] = block.kpis ?? kpiOrder().slice(0, 4);
  return (
    <div className="kpis">
      {keys.map((k) => {
        const spec = kpiSpec(k);
        /* A tile this dataset does not declare is left out rather than drawn empty: a blank tile reads
           as a figure of zero, which is a claim, and the block's own list is editable. */
        if (!spec) return null;
        const tone = kpiTone(spec, rows);
        return (
          <div className="kpi" key={k}>
            <div className={'v' + (tone ? ' ' + tone : '')}>{kpiText(spec, rows)}</div>
            <div className="l">{spec.label}</div>
            <SourceTag text={META.source_trace} />
          </div>
        );
      })}
    </div>
  );
}
