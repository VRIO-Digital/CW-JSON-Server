interface Props {
  audienceName: string;
  /** How many reports are already waiting for this audience. */
  publishedCount: number;
  onSeeLibrary(): void;
}

/**
 * Placeholder illustration: the audience's read-only report view, still on the
 * scaffold. Inline SVG on theme tokens so it tracks the palette.
 */
function ScaffoldArt() {
  return (
    <svg viewBox="0 0 360 216" width="360" height="216" role="img" aria-label="An audience report view still under construction">
      <ellipse cx="180" cy="200" rx="104" ry="6" fill="var(--line)" opacity=".7" />

      {/* the unbuilt frame around it */}
      <rect
        x="24"
        y="12"
        width="312"
        height="172"
        rx="14"
        fill="none"
        stroke="var(--line2)"
        strokeWidth="2"
        strokeDasharray="8 7"
      />

      {/* the report as the audience will see it */}
      <rect x="46" y="34" width="206" height="126" rx="10" fill="var(--card)" stroke="var(--line2)" strokeWidth="1.5" />
      <line x1="46" y1="57" x2="252" y2="57" stroke="var(--line)" strokeWidth="1.5" />
      <circle cx="61" cy="46" r="3" fill="var(--red)" opacity=".5" />
      <circle cx="72" cy="46" r="3" fill="var(--amber)" opacity=".5" />
      <circle cx="83" cy="46" r="3" fill="var(--green)" opacity=".5" />

      {/* summary tiles */}
      <rect x="58" y="68" width="41" height="23" rx="5" fill="var(--inset)" />
      <rect x="105" y="68" width="41" height="23" rx="5" fill="var(--inset)" />
      <rect x="152" y="68" width="41" height="23" rx="5" fill="var(--inset)" />
      <rect x="199" y="68" width="41" height="23" rx="5" fill="var(--inset)" />

      {/* ranked bars */}
      <rect x="58" y="103" width="30" height="8" rx="4" fill="var(--line2)" />
      <rect x="94" y="103" width="98" height="8" rx="4" fill="var(--orange)" opacity=".85" />
      <rect x="58" y="119" width="30" height="8" rx="4" fill="var(--line2)" />
      <rect x="94" y="119" width="68" height="8" rx="4" fill="var(--cyan)" opacity=".7" />
      <rect x="58" y="135" width="30" height="8" rx="4" fill="var(--line2)" />
      <rect x="94" y="135" width="42" height="8" rx="4" fill="var(--orange)" opacity=".4" />

      {/* read-only */}
      <circle cx="272" cy="142" r="21" fill="var(--card)" stroke="var(--orange-line)" strokeWidth="1.5" />
      <rect x="265" y="140" width="14" height="11" rx="2.5" fill="none" stroke="var(--orange-hi)" strokeWidth="2" />
      <path d="M268 140v-4a4 4 0 0 1 8 0v4" fill="none" stroke="var(--orange-hi)" strokeWidth="2" />

      {/* the audience */}
      <g fill="var(--cyan-soft)" stroke="var(--cyan)" strokeWidth="1.5">
        <circle cx="284" cy="52" r="12" />
        <circle cx="306" cy="80" r="12" />
        <circle cx="278" cy="98" r="12" />
      </g>

      {/* still being worked on */}
      <g transform="translate(300,34)" stroke="var(--orange)" fill="none" strokeWidth="2" strokeLinecap="round">
        <circle r="11" />
        <circle r="4" />
        <line x1="0" y1="-11" x2="0" y2="-16" />
        <line x1="0" y1="-11" x2="0" y2="-16" transform="rotate(60)" />
        <line x1="0" y1="-11" x2="0" y2="-16" transform="rotate(120)" />
        <line x1="0" y1="-11" x2="0" y2="-16" transform="rotate(180)" />
        <line x1="0" y1="-11" x2="0" y2="-16" transform="rotate(240)" />
        <line x1="0" y1="-11" x2="0" y2="-16" transform="rotate(300)" />
      </g>
    </svg>
  );
}

export function UnderDevelopmentPane({ audienceName, publishedCount, onSeeLibrary }: Props) {
  return (
    <div className="pane on">
      <div className="pageHead">
        <h1>Operational audience</h1>
        <p>What the {audienceName} group will see once a report is published to them.</p>
      </div>

      <div className="wip">
        <ScaffoldArt />

        <div className="wipTag">◷ Under development</div>
        <h2>The audience view isn't built yet</h2>
        <div className="wipD">
          Publishing already works — {publishedCount > 0 ? <b>{publishedCount}</b> : 'no'} report
          {publishedCount === 1 ? '' : 's'} {publishedCount === 1 ? 'is' : 'are'} queued for {audienceName}. What's
          missing is the read-only surface the group opens them in.
        </div>

        <div className="wipNext">
          <div className="h">What lands here</div>
          <ul>
            <li>
              <span className="b">◇</span>
              <span>Published reports only — drafts and works in progress stay out of sight.</span>
            </li>
            <li>
              <span className="b">◇</span>
              <span>
                Read-only: the figures the author fixed, the filters they chose, and no controls to change either.
              </span>
            </li>
            <li>
              <span className="b">◇</span>
              <span>Every number still traceable to its EPA and e-Manifest source, under the reader's own access.</span>
            </li>
          </ul>
        </div>

        <div className="wipFoot">
          In the meantime, published reports are visible in your{' '}
          <button className="linkBtn" onClick={onSeeLibrary}>
            library
          </button>
          .
        </div>
      </div>
    </div>
  );
}
