import { ALIASES, DOCUMENTS, FACILITIES, MANIFEST_IDS } from "./facilities";
import type { RawGraph, RawLink, RawNode } from "../types";

/**
 * Builds the full-size demo payload: 189 nodes matching the counts in the
 * original export's legend (7 concepts / 49 facilities / 7 documents /
 * 11 manifests / 40 evaluations / 38 violations / 31 enforcements / 3 aliases /
 * 3 measures).
 *
 * Facility, document, manifest and alias rows are the real ones. Evaluation,
 * violation and enforcement rows are seeded with the identifiers recovered from
 * the export (`SEED_EVALS`, `SEED_ENFS`) and topped up with deterministic
 * filler to reach the legend counts — the paste this was ported from truncated
 * partway through those three arrays. Filler uses a seeded LCG, never
 * Math.random, so the layout is reproducible between reloads.
 *
 * Drop the real `DATA` export in and delete this file when you have it.
 */

const EVAL_TYPES = [
  "Compliance Evaluation Inspection",
  "Follow-up Inspection",
  "Groundwater Monitoring Eval",
  "Non-financial Record Review",
  "Financial Record Review",
  "Case Development Inspection",
];

const VIOL_TYPES = [
  "Land Disposal Restrictions",
  "Preparedness and Prevention",
  "TSD - General Facility Standards",
  "TSD - Tanks",
  "TSD - Containers",
  "Air Emissions (Subpart CC)",
  "Generators - General",
  "Manifest",
  "Used Oil",
];

const ENF_TYPES = [
  "Initial Administrative Penalty Order",
  "Final Administrative Penalty Order",
  "Written Informal",
  "Notice of Violation",
  "Consent Agreement/Final Order (CAFO)",
];

const TARGET = {
  evaluations: 40,
  violations: 38,
  enforcements: 31,
  measures: 3,
} as const;

/** [ISN, facility registry id, evaluation type, ISO date] */
type EvalSeed = [string, string, string, string];

const SEED_EVALS: EvalSeed[] = [
  ["ISN500003", "TXD515102755", "Follow-up Inspection", "2019-10-27"],
  ["ISN500001", "TXD515102755", "Groundwater Monitoring Eval", "2020-08-22"],
  ["ISN500002", "TXD515102755", "Follow-up Inspection", "2025-06-30"],
  ["ISN500015", "TXD515102755", "Follow-up Inspection", "2019-05-28"],
  ["ISN500007", "TXD515102755", "Compliance Evaluation Inspection", "2022-09-13"],
  ["ISN500005", "TXD515102755", "Compliance Evaluation Inspection", "2026-01-03"],
  ["ISN500153", "TXD791240867", "Follow-up Inspection", "2019-04-27"],
  ["ISN500147", "TXD791240867", "Groundwater Monitoring Eval", "2023-04-10"],
  ["ISN500151", "TXD791240867", "Non-financial Record Review", "2023-10-02"],
  ["ISN500155", "TXD791240867", "Follow-up Inspection", "2026-02-15"],
  ["ISN500247", "LAD727050419", "Non-financial Record Review", "2019-06-24"],
  ["ISN500264", "LAD727050419", "Financial Record Review", "2019-11-01"],
  ["ISN500253", "LAD727050419", "Groundwater Monitoring Eval", "2020-11-09"],
  ["ISN500252", "LAD727050419", "Case Development Inspection", "2021-08-11"],
  ["ISN500262", "LAD727050419", "Case Development Inspection", "2022-07-13"],
  ["ISN500258", "LAD727050419", "Follow-up Inspection", "2024-03-19"],
];

/** [ENF_KEY, enforcement type] — facility is the key's leading registry id. */
type EnfSeed = [string, string];

const SEED_ENFS: EnfSeed[] = [
  ["TXD515102755-TX-RCRA-2021-6613", "Initial Administrative Penalty Order"],
  ["TXD515102755-TX-RCRA-2022-7031", "Written Informal"],
  ["TXD620016210-TX-RCRA-2022-8009", "Final Administrative Penalty Order"],
  ["TXD620016210-TX-RCRA-2024-7552", "Initial Administrative Penalty Order"],
  ["TXD340285410-TX-RCRA-2020-8511", "Final Administrative Penalty Order"],
  ["TXD865034110-TX-RCRA-2019-7782", "Final Administrative Penalty Order"],
  ["TXD750745563-TX-RCRA-2023-5552", "Final Administrative Penalty Order"],
  ["TXD424874836-TX-RCRA-2022-5521", "Initial Administrative Penalty Order"],
  ["TXD791240867-TX-RCRA-2024-6796", "Written Informal"],
  ["TXD791240867-TX-RCRA-2026-9576", "Written Informal"],
  ["TXD791240867-TX-RCRA-2024-5475", "Notice of Violation"],
  ["TXD791240867-TX-RCRA-2024-1514", "Final Administrative Penalty Order"],
  ["TXD232817176-TX-RCRA-2023-6240", "Initial Administrative Penalty Order"],
  ["TXD191666610-TX-RCRA-2020-5422", "Final Administrative Penalty Order"],
  ["TXD191666610-TX-RCRA-2019-9225", "Consent Agreement/Final Order (CAFO)"],
  ["TXD385712593-TX-RCRA-2021-2133", "Final Administrative Penalty Order"],
  ["TXD976089325-TX-RCRA-2021-1613", "Final Administrative Penalty Order"],
  ["TXD976089325-TX-RCRA-2025-7106", "Consent Agreement/Final Order (CAFO)"],
  ["LAD727050419-LA-RCRA-2026-1015", "Initial Administrative Penalty Order"],
  ["LAD727050419-LA-RCRA-2023-4684", "Notice of Violation"],
];

// ── deterministic filler ─────────────────────────────────

/** Seeded LCG — Math.random would reshuffle the layout on every reload. */
const makeRng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const pick = <T,>(rng: () => number, items: T[]): T =>
  items[Math.floor(rng() * items.length)];

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const isoDate = (rng: () => number) => {
  const year = 2019 + Math.floor(rng() * 8);
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${year}-${pad(month)}-${pad(day)}`;
};

/** Violations are determined a few days after the evaluation that found them. */
const usDateAfter = (iso: string, offsetDays: number) => {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = day + offsetDays;
  const rolled = shifted > 28;
  const outMonth = rolled ? (month % 12) + 1 : month;
  const outYear = rolled && outMonth === 1 ? year + 1 : year;
  const outDay = rolled ? shifted - 28 : shifted;
  return `${pad(outMonth)}/${pad(outDay)}/${outYear}`;
};

const stateOf = (registryId: string) => registryId.slice(0, 2);

// ── build ────────────────────────────────────────────────

const CONCEPTS: RawNode[] = [
  {
    id: "CONCEPT:Facility",
    type: "Concept",
    element_class: "concept",
    label: "Facility",
    definition:
      "Regulated site (generator / transporter / TSDF). Registry: FRS + RCRA summary.",
    members: FACILITIES.length,
  },
  {
    id: "CONCEPT:Document",
    type: "Concept",
    element_class: "concept",
    label: "Document",
    definition:
      "Unstructured source doc (compliance report, inspection PDF) linked to a facility.",
    members: DOCUMENTS.length,
  },
  {
    id: "CONCEPT:Manifest",
    type: "Concept",
    element_class: "concept",
    label: "Manifest",
    definition:
      "Cradle-to-grave hazardous-waste shipment EVENT (Q59: anchor + gen/transporter/facility refs + dates).",
    members: MANIFEST_IDS.length,
  },
  {
    id: "CONCEPT:Evaluation",
    type: "Concept",
    element_class: "concept",
    label: "Evaluation",
    definition: "RCRA compliance evaluation EVENT against a facility.",
    members: TARGET.evaluations,
  },
  {
    id: "CONCEPT:Violation",
    type: "Concept",
    element_class: "concept",
    label: "Violation",
    definition: "Regulatory violation found in an evaluation.",
    members: TARGET.violations,
  },
  {
    id: "CONCEPT:Enforcement",
    type: "Concept",
    element_class: "concept",
    label: "Enforcement",
    definition: "Enforcement action against a facility (carries a penalty measure).",
    members: TARGET.enforcements,
  },
  {
    id: "CONCEPT:Alias",
    type: "Concept",
    element_class: "concept",
    label: "Alias",
    definition: "Identity-resolution alias resolving to a canonical facility (A-04).",
    members: ALIASES.length,
  },
].map((concept) => ({
  ...concept,
  provenance:
    "A-02 concept nomination; type-level node (one node regardless of row count, Q39)",
})) as RawNode[];

export const buildDemoGraph = (): RawGraph => {
  const rng = makeRng(0x5eed_1978);
  const nodes: RawNode[] = [...CONCEPTS];
  const links: RawLink[] = [];

  const instanceOf = (id: string, concept: string) =>
    links.push({ source: id, target: concept, label: "INSTANCE_OF" });

  // facilities
  for (const facility of FACILITIES) {
    const id = `FAC:${facility.registryId}`;
    nodes.push({
      id,
      type: "Facility",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Facility",
      label: facility.label,
      source_key: { field: "REGISTRY_ID / PGM_SYS_ID", value: facility.registryId },
      subtype: facility.role,
      provenance: "A-04 typing + identity merge; FRS/RCRA-summary registry row",
    });
    instanceOf(id, "CONCEPT:Facility");
  }

  // documents -> facility (A-04 NER)
  for (const doc of DOCUMENTS) {
    const id = `DOC:${doc.id}`;
    nodes.push({
      id,
      type: "Document",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Document",
      label: doc.label,
      source_key: null,
      subtype: "document",
      provenance: "A-04 unstructured extraction (NER) -> resolves to Facility",
    });
    instanceOf(id, "CONCEPT:Document");
    links.push({ source: id, target: `FAC:${doc.registryId}`, label: "MENTIONS" });
  }

  // manifests: generator -> transporter -> TSDF
  const generators = FACILITIES.filter((f) => f.role === "generator");
  const transporters = FACILITIES.filter((f) => f.role === "transporter");
  const tsdfs = FACILITIES.filter((f) => f.role === "tsdf");

  MANIFEST_IDS.forEach((tracking, index) => {
    const id = `MAN:${tracking}`;
    const generator = generators[(index * 5) % generators.length];
    const transporter = transporters[index % transporters.length];
    const tsdf = tsdfs[index % tsdfs.length];

    nodes.push({
      id,
      type: "Manifest",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Manifest",
      label: tracking,
      source_key: { field: "MANIFEST TRACKING NUMBER", value: tracking },
      subtype: "event",
      event_shape:
        "Q59: anchor + generator/facility/transporter refs + shipped/received dates",
      provenance:
        "A-05 on-demand promotion (use case names manifests); NOT eager Q40 materialisation",
    });
    instanceOf(id, "CONCEPT:Manifest");
    links.push(
      { source: id, target: `FAC:${generator.registryId}`, label: "GENERATED_BY" },
      { source: id, target: `FAC:${transporter.registryId}`, label: "SHIPS_TO" },
      { source: id, target: `FAC:${tsdf.registryId}`, label: "RECEIVED_AT" },
    );
  });

  // evaluations: real seeds first, then deterministic filler
  const evaluations: { id: string; registryId: string; date: string }[] = [];
  let isnCounter = 500300;

  const addEvaluation = (
    isn: string,
    registryId: string,
    evalType: string,
    date: string,
  ) => {
    const id = `EVAL:${isn}`;
    nodes.push({
      id,
      type: "Evaluation",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Evaluation",
      label: `${evalType} — ${date}`,
      source_key: { field: "ISN_RCR_EVAL", value: isn },
      subtype: "event",
      event_shape: "Q59: anchor + facility/agency refs + EVAL_DATE",
      provenance: "A-05 on-demand promotion; event row in RCRA_compliance",
    });
    instanceOf(id, "CONCEPT:Evaluation");
    links.push({ source: id, target: `FAC:${registryId}`, label: "EVALUATION_OF" });
    evaluations.push({ id, registryId, date });
  };

  for (const [isn, registryId, evalType, date] of SEED_EVALS) {
    addEvaluation(isn, registryId, evalType, date);
  }

  // Spread the filler across facilities with a coprime stride so evaluations
  // don't pile onto the first few sites.
  let facilityCursor = 3;
  while (evaluations.length < TARGET.evaluations) {
    const facility = FACILITIES[facilityCursor % FACILITIES.length];
    facilityCursor += 7;
    addEvaluation(
      `ISN${isnCounter++}`,
      facility.registryId,
      pick(rng, EVAL_TYPES),
      isoDate(rng),
    );
  }

  // violations: one per evaluation until the target is met
  evaluations.slice(0, TARGET.violations).forEach((evaluation, index) => {
    const seq = 1 + Math.floor(rng() * 4);
    const isn = evaluation.id.replace("EVAL:", "");
    const id = `VIOL:${isn}-1`;
    const violType = pick(rng, VIOL_TYPES);

    nodes.push({
      id,
      type: "Violation",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Violation",
      label: `${violType} — ${usDateAfter(evaluation.date, 1 + (index % 20))}`,
      source_key: { field: "ISN_RCR_EVAL + VIOL_SEQ", value: `${isn}/${seq}` },
      subtype: "event",
      event_shape: "Q59: found-in evaluation; facility ref + VIOL_DETERMINED_DATE",
      provenance: "A-05 on-demand promotion; violation carried on evaluation row",
    });
    instanceOf(id, "CONCEPT:Violation");
    links.push({ source: id, target: evaluation.id, label: "FOUND_IN" });
  });

  // enforcements: real seeds first, then deterministic filler
  const enforcements: { id: string; registryId: string; enfType: string }[] = [];

  const addEnforcement = (enfKey: string, enfType: string) => {
    const id = `ENF:${enfKey}`;
    const registryId = enfKey.split("-")[0];
    nodes.push({
      id,
      type: "Enforcement",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Enforcement",
      label: `${enfType} — ${enfKey.slice(registryId.length + 1)}`,
      source_key: { field: "ENF_KEY", value: enfKey },
      subtype: "event",
      event_shape: "Q59: anchor + facility ref + ENF_ACTION_DATE + penalty measure",
      provenance: "A-05 on-demand promotion; enforcement carried on evaluation row",
    });
    instanceOf(id, "CONCEPT:Enforcement");
    links.push({ source: id, target: `FAC:${registryId}`, label: "ENFORCEMENT_AGAINST" });
    enforcements.push({ id, registryId, enfType });
  };

  for (const [enfKey, enfType] of SEED_ENFS) {
    addEnforcement(enfKey, enfType);
  }

  let enfCursor = 11;
  while (enforcements.length < TARGET.enforcements) {
    const facility = FACILITIES[enfCursor % FACILITIES.length];
    enfCursor += 5;
    const year = 2019 + Math.floor(rng() * 8);
    const serial = 1000 + Math.floor(rng() * 9000);
    addEnforcement(
      `${facility.registryId}-${stateOf(facility.registryId)}-RCRA-${year}-${serial}`,
      pick(rng, ENF_TYPES),
    );
  }

  // aliases -> canonical facility
  for (const alias of ALIASES) {
    const id = `ALIAS:${alias.label.replace(/\s+/g, "_")}`;
    nodes.push({
      id,
      type: "Alias",
      element_class: "thin_instance",
      entity_type: "CONCEPT:Alias",
      label: alias.label,
      source_key: { field: "FACILITY_NAME (source system)", value: alias.label },
      provenance: "A-04 identity resolution; alias retained for lineage",
    });
    instanceOf(id, "CONCEPT:Alias");
    links.push({ source: id, target: `FAC:${alias.registryId}`, label: "RESOLVES_TO" });
  }

  // penalty measures on the highest-profile enforcements (dashed pink edges)
  const penaltyTargets = enforcements.filter((enf) =>
    enf.enfType.includes("Penalty Order"),
  );
  const measured = (
    penaltyTargets.length >= TARGET.measures ? penaltyTargets : enforcements
  ).slice(0, TARGET.measures);

  measured.forEach((enf, index) => {
    const amount = 45_000 + index * 48_500;
    const id = `${enf.id}:penalty`;
    nodes.push({
      id,
      type: "Measure",
      element_class: "measure",
      label: `Penalty — $${amount.toLocaleString("en-US")}`,
      value: amount,
      unit: "USD",
      aggregation: "sum",
      provenance: "A-05 measure attached to enforcement event (Q59 penalty slot)",
    });
    links.push({ source: enf.id, target: id, label: "PENALTY_OF", aggregate: true });
  });

  return {
    faithful: false,
    subtitle: `${nodes.length} nodes · ${links.length} edges · Context Weave extraction`,
    nodes,
    links,
  };
};
