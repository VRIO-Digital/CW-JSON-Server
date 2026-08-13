import { FACILITIES } from '../../data';
import type { Block } from '../../types';

export function FacilitiesBlock({ block }: { block: Block }) {
  const maxEval = Math.max(...FACILITIES.map((f) => f.evals));
  const maxViol = Math.max(...FACILITIES.map((f) => f.viols), 1);

  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">VLS Deer Park against its Texas comparator TSDFs · RCRA evaluations and open violations</div>

      <div className="leg">
        <span>
          <span className="sw" style={{ background: 'var(--cyan)' }} /> RCRA evaluations
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--orange)' }} /> Open violations
        </span>
      </div>

      <div className="gbars">
        {FACILITIES.map((f) => (
          <div className={'gbarRow' + (f.role.startsWith('VLS') ? ' self' : '')} key={f.facility}>
            <div className="nm">
              {f.facility}
              <span className="tag">
                {f.role} · last evaluated {f.last_eval}
              </span>
            </div>
            <div className="gpair">
              <div className="gseg">
                <span className="gl">Evaluations</span>
                <div className="gtrack">
                  <div
                    className="gf"
                    style={{ width: (f.evals / maxEval) * 100 + '%', background: 'var(--cyan)' }}
                  />
                </div>
                <span className="gv">{f.evals}</span>
              </div>
              <div className="gseg">
                <span className="gl">Violations</span>
                <div className="gtrack">
                  <div
                    className="gf"
                    style={{
                      width: (f.viols / maxViol) * 100 + '%',
                      background: f.viols > 0 ? 'var(--orange)' : 'transparent',
                    }}
                  />
                </div>
                <span className="gv">{f.viols}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="footNote">
        No comparator in this set carries an open enforcement action. Violation counts are not normalised by evaluation
        volume — a facility evaluated more often has more opportunity to be cited.
      </div>
    </div>
  );
}
