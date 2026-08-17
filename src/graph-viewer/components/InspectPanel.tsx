import { colorFor, relationsOf } from "../lib/graph";
import type { Graph, GraphNode } from "../types";

type Props = {
  graph: Graph;
  byId: Map<string, GraphNode>;
  node: GraphNode | null;
  onSelect: (nodeId: string) => void;
};

const Row = ({ k, v, mono }: { k: string; v: string | number; mono?: boolean }) => (
  <div className="kv">
    <span className="k">{k}</span>
    <span className={`v${mono ? " mono" : ""}`}>{v}</span>
  </div>
);

export const InspectPanel = ({ graph, byId, node, onSelect }: Props) => {
  if (!node) {
    return <div className="empty">Click any node to inspect it.</div>;
  }

  const relations = relationsOf(node.id, graph.links, byId);

  return (
    <div>
      <span className="badge" style={{ background: colorFor(node.type) }}>
        {node.type}
      </span>

      <div style={{ fontWeight: 600, marginBottom: 8 }}>{node.label}</div>

      {node.definition && <div className="note">{node.definition}</div>}

      <div className="sect">Identity</div>
      <Row k="id" v={node.id} mono />
      <Row k="element class" v={node.element_class} />
      {node.entity_type && <Row k="entity type" v={node.entity_type} mono />}
      {node.subtype && <Row k="subtype" v={node.subtype} />}
      {typeof node.members === "number" && <Row k="members" v={node.members} />}

      {node.source_key && (
        <>
          <div className="sect">Source key</div>
          <Row k={node.source_key.field} v={node.source_key.value} mono />
        </>
      )}

      {node.event_shape && (
        <>
          <div className="sect">Event shape</div>
          <div className="note">{node.event_shape}</div>
        </>
      )}

      {node.l2 && (
        <>
          <div className="sect l2">
            Derived
            <span className="l2tag">L2</span>
          </div>
          <div className="l2box note">{node.l2}</div>
        </>
      )}

      {relations.length > 0 && (
        <>
          <div className="sect">Relationships ({relations.length})</div>
          {relations.map((rel, index) => (
            <div className="rel" key={`${rel.direction}-${rel.other.id}-${index}`}>
              <span className="k">
                {rel.direction === "out" ? "→ " : "← "}
                {rel.label || "related"}{" "}
              </span>
              <button type="button" className="t" onClick={() => onSelect(rel.other.id)}>
                {rel.other.label}
              </button>
            </div>
          ))}
        </>
      )}

      {node.provenance && <div className="prov">{node.provenance}</div>}
    </div>
  );
};
