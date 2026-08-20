import { Fragment } from 'react';
import type { Step } from '../types';

const STEPS: { s: Step; label: string }[] = [
  { s: 1, label: 'Ask' },
  { s: 2, label: 'Confirm' },
  { s: 3, label: 'Report' },
];

export function StepDots({ step }: { step: Step }) {
  return (
    <div className="stepDots">
      {STEPS.map((it, i) => (
        <Fragment key={it.s}>
          {i > 0 && <div className="bar" />}
          <div className={'dot' + (it.s === step ? ' on' : '') + (it.s < step ? ' done' : '')}>
            <span className="n">{it.s}</span> {it.label}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
