import { TRACES } from '../../data';
import type { Block } from '../../types';

export function TracesBlock({ block }: { block: Block }) {
  return (
    <div className="panel">
      <h3>{block.title}</h3>
      <div className="ph">
        Generator → transporter chain → VLS receipt · each row is one manifest tracking number on file
      </div>
      <table>
        <thead>
          <tr>
            <th>Manifest</th>
            <th>Generator</th>
            <th>Custody chain</th>
            <th className="num">Transit</th>
            <th className="num">Tons</th>
            <th>Disposition</th>
          </tr>
        </thead>
        <tbody>
          {TRACES.map((t) => (
            <tr key={t.mtn}>
              <td>
                <span className="mono">{t.mtn}</span>
                <div className="sub">shipped {t.shipped}</div>
              </td>
              <td>
                {t.generator}
                <div className="sub">{t.gen_state}</div>
              </td>
              <td>
                <div className="chain">
                  {t.transporters.map((tr, i) => (
                    <div className="hop" key={tr + i}>
                      <span className="ix">{i + 1}.</span>
                      {tr}
                    </div>
                  ))}
                  <div className="hop">
                    <span className="ix">→</span>
                    VLS Deer Park · received {t.received}
                  </div>
                </div>
              </td>
              <td className="num">{t.days}d</td>
              <td className="num">{t.tons}</td>
              <td>
                {t.rejected === 'Y' && <span className="pill bad">Rejected</span>}
                {t.residue === 'Y' && <span className="pill info">Residue</span>}
                {t.rejected !== 'Y' && t.residue !== 'Y' && <span className="pill ok">{t.status}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="footNote">
        Chain of custody is reconstructed from e-Manifest signatures — every hop shown was signed by the party named.
      </div>
    </div>
  );
}
