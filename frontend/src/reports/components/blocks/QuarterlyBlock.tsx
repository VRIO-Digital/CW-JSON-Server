import { QUARTERS } from '../../data';
import { tons } from '../../lib/format';
import type { Block, QuarterMetric } from '../../types';

/** A quarter at or above this many load rejections is called out. */
const REJ_SPIKE = 3;

export function QuarterlyBlock({ block }: { block: Block }) {
  const metric: QuarterMetric = block.metric ?? 'tons';
  const max = Math.max(...QUARTERS.map((q) => q[metric]));
  const spikes = QUARTERS.filter((q) => q.rej >= REJ_SPIKE);

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        {metric === 'tons' ? 'Hazardous tonnage received at Deer Park' : 'Manifests received at Deer Park'} · by quarter ·
        red columns had {REJ_SPIKE}+ load rejections
      </div>

      <div className="cols">
        {QUARTERS.map((q) => (
          <div className="col" key={q.quarter}>
            <div className="colV">
              {metric === 'tons' ? Math.round(q.tons).toLocaleString('en-US') : q.manifests}
            </div>
            <div
              className={'colBar' + (q.rej >= REJ_SPIKE ? ' over' : '')}
              style={{ height: Math.max(4, (q[metric] / max) * 140) }}
            />
            <div className="colN">{q.quarter}</div>
          </div>
        ))}
      </div>

      <div className="footNote">
        {metric === 'tons'
          ? `Total received: ${tons(QUARTERS.reduce((t, q) => t + q.tons, 0))} across ${QUARTERS.length} quarters.`
          : `Total manifests: ${QUARTERS.reduce((t, q) => t + q.manifests, 0).toLocaleString('en-US')} across ${QUARTERS.length} quarters.`}{' '}
        {spikes.length > 0 && (
          <>
            Rejection spikes: {spikes.map((q) => `${q.quarter} (${q.rej})`).join(', ')}.
          </>
        )}{' '}
        Residue shipments run {Math.min(...QUARTERS.map((q) => q.res))}–{Math.max(...QUARTERS.map((q) => q.res))} per
        quarter.
      </div>
    </div>
  );
}
