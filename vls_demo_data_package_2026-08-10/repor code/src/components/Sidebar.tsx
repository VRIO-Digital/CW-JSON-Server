import { META } from '../data';

interface Props {
  reportCount: number;
  onNavigate(): void;
}

export function Sidebar({ reportCount, onNavigate }: Props) {
  return (
    <aside className="side">
      <div className="sideTop">
        <span className="wordmark">
          Context<b>·</b>Weave
        </span>
      </div>

      <div className="sideLbl">Workspace</div>
      <nav>
        <button className="navItem on" onClick={onNavigate}>
          <span className="ic">▤</span>
          Reports
          <span className="ct">{reportCount}</span>
        </button>
      </nav>

      <div className="sideFoot">
        <div className="av">{META.persona_initials}</div>
        <div className="who">
          <div className="n">{META.persona_name}</div>
          <div className="r">{META.persona_role}</div>
        </div>
      </div>
    </aside>
  );
}
