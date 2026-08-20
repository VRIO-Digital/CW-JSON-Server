/**
 * "How it's built" copy. Reconstructed from the `provenance` strings carried on
 * the exported nodes (A-02 / A-04 / A-05, Q39, Q40, Q59) — adjust the wording
 * here if the pipeline doc says it differently.
 */
export const ModelPanel = () => (
  <div className="note">
    <b>A-02 — concept nomination.</b> Concepts are type-level: one node per concept
    regardless of row count (Q39). Facility, Document, Manifest, Evaluation,
    Violation, Enforcement and Alias come from this pass.

    <div className="sect">A-04 — typing &amp; identity</div>
    Registry rows are typed and merged onto a canonical facility via{" "}
    <span className="mono">REGISTRY_ID / PGM_SYS_ID</span>. Unstructured documents
    reach the same facilities through NER extraction, and aliases record the
    identity resolutions that got them there.

    <div className="sect">A-05 — on-demand promotion</div>
    Events are promoted only when a use case names them — a manifest becomes a
    node because someone asked about manifests. This is{" "}
    <span className="strike">not eager Q40 materialisation</span>: nothing is
    promoted just because a row exists.

    <div className="sect">Q59 — event shape</div>
    Every promoted event carries an anchor, its participant references
    (generator, transporter, facility, agency) and its dates. Enforcement events
    additionally carry a penalty measure, drawn as a dashed pink aggregate edge.

    <div className="sect">Reading the graph</div>
    Green-ringed nodes are concepts, pink-ringed are measures, plain fills are
    thin instances. Click a node to isolate its one-hop neighbourhood; edge
    labels enlarge inside the selection.
  </div>
);
