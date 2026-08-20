type Props = {
  faithful: boolean;
  note?: string;
};

const DEMO_COPY =
  "Demo payload — facility identifiers, evaluations and penalties are synthetic and shaped like the real FRS/RCRA export. Structure is faithful; values are not.";

const FAITHFUL_COPY =
  "Faithful payload — nodes and edges are materialised from the live FRS/RCRA extraction run. Values trace back to source keys.";

export const Banner = ({ faithful, note }: Props) => (
  <div className={`banner ${faithful ? "faithful" : "demo"}`}>
    {note ?? (faithful ? FAITHFUL_COPY : DEMO_COPY)}
  </div>
);
