"""The Keolis Valmont graph as the canvas draws it: concepts, thin instances and measure elements,
typed edges, and a deterministic layout. Node ids here are the ids every graph_ref points at."""
import networkx as nx
from world import *
import corpus as C

NODES, EDGES = {}, []

def node(nid, label, sub, typ, cls, group, source, review=None):
    if nid not in NODES:
        NODES[nid] = dict(node_id=nid, label=label, sublabel=sub, type=typ, element_class=cls, group=group, source=source, confidence=None)
        if review:
            NODES[nid]["review_item_id"] = review
    return nid

def edge(a, b, label, detail, review=None):
    e = dict(edge_id=f"E{len(EDGES) + 1:04d}", **{"from": a}, to=b, label=label, detail=detail)
    if review:
        e["review_item_id"] = review
    EDGES.append(e)

CONCEPTS = [
    ("Project", "A capital project: the unit scope, budget, schedule and approval resolve to."),
    ("Need", "A validated intervention need. Exists before any project does — the unfunded backlog lives here."),
    ("Option", "An alternative appraised for a need: repair, overhaul, replace or defer."),
    ("Asset", "A physical asset or functional location with a stable canonical identity."),
    ("Component", "A serialised component that moves between vehicles over dated installation intervals."),
    ("Contract", "The operating contract (DSP) and its executed amendments."),
    ("Amendment", "An executed avenant; effective date and received date are kept apart."),
    ("Clause", "A contract clause that assigns responsibility or sets a condition."),
    ("ResponsibilityAssignment", "Who owns, maintains, replaces, pays or approves — dated, per asset scope."),
    ("Organisation", "A legal entity or authority with a dated relationship to others."),
    ("Supplier", "A supplier or contractor."),
    ("PurchaseOrderLine", "A commitment. Its promised date can lag the supplier's correspondence."),
    ("FundingClaim", "A claim to the authority: potential, submitted, accepted, disputed, paid — five states."),
    ("ScheduleTask", "A task with baseline and current dates and its dependencies."),
    ("AccessWindow", "A track possession request. Only an approved window is access."),
    ("AcceptanceItem", "A required test, certificate or deliverable before handover."),
    ("FailureEvent", "A reported failure; the confirmed cause is a separate fact from the symptom."),
    ("ConditionAssessment", "An inspection result on its own scale."),
    ("ServiceRequirement", "Vehicles required at peak plus agreed reserve, by class."),
    ("Depot", "A depot or workshop site."),
    ("Line", "A tram, BRT or bus line."),
    ("Statement", "A dated claim made in a document or a message — evidence, never a record by itself."),
    ("Measure", "A governed measure with a named definition, grain and date basis."),
]

MEASURES = [
    ("forecast_total", "Forecast total project cost", "actuals + valid uninvoiced accruals + forecast cost to complete"),
    ("forecast_ctc", "Forecast cost to complete", "remaining committed + expected uncommitted + separately held contingency"),
    ("budget_variance", "Forecast budget variance", "forecast total − current approved budget"),
    ("open_commitment", "Open commitment", "approved commitment less recognised or cancelled scope"),
    ("funding_gap", "Approved funding gap", "forecast fundable expenditure − applicable approved funding"),
    ("operator_exposure", "Operator exposure", "costs borne by Keolis Valmont under validated allocations"),
    ("availability_margin", "Service availability margin", "eligible available vehicles − peak requirement − agreed reserve"),
    ("failure_frequency", "Failure frequency", "relevant failures per 100,000 km"),
    ("schedule_variance", "Schedule variance", "current forecast milestone − approved baseline milestone (days)"),
    ("renewal_backlog", "Renewal backlog", "validated needs not yet completed, by status"),
    ("acceptance_completeness", "Documented acceptance completeness", "verified required acceptance items ÷ applicable required items"),
    ("project_cash", "Project cash position", "cash paid − project-related cash received at a cutoff"),
]

def slug(s):
    import re, unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def build():
    NODES.clear(); EDGES.clear()
    for name, sub in CONCEPTS:
        node(f"CONCEPT:{name}", name, sub, "Concept", "concept", "Concept", "concept nomination; declared data model")
    for mid, lab, d in MEASURES:
        node(f"MEAS:{mid}", lab, d, "Measure", "measure_element", "Measure", "governed measure register (brief metrics)")
        edge(f"MEAS:{mid}", "CONCEPT:Measure", "INSTANCE_OF", "schema · confidence 1.00")
    # organisations
    for oid, lab, sub in (("ORG:keolis_group", GROUP, "Group"), ("ORG:keolis_france_co", REGION, "Region"),
                          ("ORG:keolis_valmont", LEGAL_ENTITY, "Operator — legal entity"), ("ORG:valmont_metropole", AUTHORITY, AUTHORITY_ROLE),
                          ("ORG:transalp", OVERHAUL_PARTNER, "Tram overhaul partner")):
        node(oid, lab, sub, "Organisation", "thin_instance", "Organisation", "contract.org_relationship")
        edge(oid, "CONCEPT:Organisation", "INSTANCE_OF", "schema · confidence 1.00")
    edge("ORG:keolis_valmont", "ORG:keolis_france_co", "SUBSIDIARY_OF", "declared · contract.org_relationship")
    edge("ORG:keolis_france_co", "ORG:keolis_group", "SUBSIDIARY_OF", "declared · contract.org_relationship")
    edge("ORG:keolis_valmont", "ORG:valmont_metropole", "OPERATES_FOR", "declared · 2021-01-01 → 2028-12-31")
    edge("ORG:transalp", "ORG:valmont_metropole", "OVERHAULS_FOR", "declared · TRS-2024-OVH-01")
    # contract, amendments, clauses, conditions
    node("CON:DSP-VM-2021", "DSP-VM-2021", CONTRACT["title"], "Contract", "thin_instance", "Contract", "contract.contract_version; DSP-VM-2021 extract (Drive)")
    edge("CON:DSP-VM-2021", "CONCEPT:Contract", "INSTANCE_OF", "schema · confidence 1.00")
    edge("CON:DSP-VM-2021", "ORG:valmont_metropole", "PARTY", "extracted · confidence 0.99")
    edge("CON:DSP-VM-2021", "ORG:keolis_valmont", "PARTY", "extracted · confidence 0.99")
    for a in AMENDMENTS:
        nid = f"CON:{a['id']}"
        node(nid, a["id"], f"{a['title']} · effective {a['effective']} · received {a['received']}", "Amendment", "thin_instance", "Amendment", "contract.contract_version; executed copy (Drive)",
             review="rq3" if a["no"] == 3 else None)
        edge(nid, "CON:DSP-VM-2021", "AMENDS", "extracted · confidence 0.98")
        edge(nid, "CONCEPT:Amendment", "INSTANCE_OF", "schema · confidence 1.00")
    for cid, lab, sub in (("CLS:dsp_12", "Art. 12 — biens de retour", "Authority owns Annex 7 assets; they return at contract end"),
                          ("CLS:dsp_34_3", "Art. 34.3 — renewal funded by the Authority", "PPI; delegated project management reimbursed on quarterly claims"),
                          ("CLS:dsp_34_4", "Art. 34.4 — heavy components after replacement date", "Authority bears > €5,000 repairs after the replacement date, as restated by AV2"),
                          ("CLS:dsp_34_2", "Art. 34.2 — GER below threshold", "Operator bears major maintenance up to €5,000 per intervention")):
        node(cid, lab, sub, "Clause", "thin_instance", "Clause", "extracted from DSP-VM-2021 / AV2")
        edge("CON:DSP-VM-2021", cid, "CONTAINS_CLAUSE", "extracted · confidence 0.97")
        edge(cid, "CONCEPT:Clause", "INSTANCE_OF", "schema · confidence 1.00")
    edge("CON:DSP-VM-2021-AV2", "CLS:dsp_34_4", "RESTATES", "extracted · confidence 0.97")
    for cid, lab in (("COND:34_4_notice", "Notice within 30 days"), ("COND:34_4_cap", "Cap €35,000 per vehicle per event"),
                     ("COND:34_4_exclusion", "Exclusion — operator maintenance default"), ("COND:ger_threshold", "GER threshold €5,000")):
        node(cid, lab, "Condition on Art. 34.4" if "34_4" in cid else "Condition on Art. 34.2", "Condition", "thin_instance", "Clause", "extracted from AV2")
        edge("CLS:dsp_34_4" if "34_4" in cid else "CLS:dsp_34_2", cid, "HAS_CONDITION", "extracted · confidence 0.94")
    for rid, lab, sub in (("RSP:bus-201-208_replacement", "BUS-201..208 replacement date 2026-06-30", "Annex 7 (unchanged by AV3)"),
                          ("RSP:bus-209-216_replacement", "BUS-209..216 replacement date 2026-12-31", "Annex 7 as amended by AV3 (effective 2026-04-01)"),
                          ("RSP:heavy_component_payer", "Payer after replacement date: Valmont Métropole", "Art. 34.4, subject to notice, cap and exclusion"),
                          ("RSP:maintainer", "Maintainer: Keolis Valmont", "Art. 34.1 — all Annex 7 assets"),
                          ("RSP:renewal_obligor", "Renewal decided and funded by Valmont Métropole", "Art. 34.3")):
        node(rid, lab, sub, "ResponsibilityAssignment", "thin_instance", "ResponsibilityAssignment", "contract.responsibility_assignment")
        edge(rid, "CONCEPT:ResponsibilityAssignment", "INSTANCE_OF", "schema · confidence 1.00")
    edge("CLS:dsp_34_4", "RSP:heavy_component_payer", "ASSIGNS", "declared · clause_ref Art. 34.4 / AV2")
    edge("CON:DSP-VM-2021-AV3", "RSP:bus-209-216_replacement", "SETS_DATE", "extracted · confidence 0.96", review="rq3")
    edge("CON:DSP-VM-2021", "RSP:bus-201-208_replacement", "SETS_DATE", "extracted · confidence 0.95")
    edge("RSP:maintainer", "ORG:keolis_valmont", "ASSIGNED_TO", "declared")
    edge("RSP:renewal_obligor", "ORG:valmont_metropole", "ASSIGNED_TO", "declared")
    edge("RSP:heavy_component_payer", "ORG:valmont_metropole", "ASSIGNED_TO", "declared")
    # depots and lines
    for d in DEPOTS:
        node(f"DEP:{d['id']}", d["name"], d["kind"], "Depot", "thin_instance", "Depot", "eam.asset_register (functional location)")
        edge(f"DEP:{d['id']}", "CONCEPT:Depot", "INSTANCE_OF", "schema · confidence 1.00")
    for l in LINES[:3]:
        node(f"LINE:{l['id']}", l["name"], l["mode"], "Line", "thin_instance", "Line", "ops.service_requirement")
        edge(f"LINE:{l['id']}", "CONCEPT:Line", "INSTANCE_OF", "schema · confidence 1.00")
    node("SRQ:bus_12m", "Bus 12 m — peak 168 + reserve 17", "Timetable HIV-2026, weekday", "ServiceRequirement", "thin_instance", "ServiceRequirement", "ops.service_requirement")
    node("SRQ:tram", "Tram — peak 26 + reserve 2", "Timetable HIV-2026, weekday", "ServiceRequirement", "thin_instance", "ServiceRequirement", "ops.service_requirement")
    edge("SRQ:bus_12m", "CONCEPT:ServiceRequirement", "INSTANCE_OF", "schema"); edge("SRQ:tram", "CONCEPT:ServiceRequirement", "INSTANCE_OF", "schema")
    edge("SRQ:tram", "LINE:T1", "REQUIRED_FOR", "declared"); edge("SRQ:tram", "LINE:T2", "REQUIRED_FOR", "declared")
    # suppliers
    sup_node = {}
    for sid, name, what in SUPPLIERS:
        nid = f"SUP:{slug(name)}"
        sup_node[name] = nid
        node(nid, name, what, "Supplier", "thin_instance", "Supplier", "proc.supplier", review="rq2" if name == "Arvéa Mobility" else None)
        edge(nid, "CONCEPT:Supplier", "INSTANCE_OF", "schema · confidence 1.00")
    # assets
    assets = [(f"BUS-{n}", "Arvéa Citybus 12 D (2011)", "DEP:DEP-AUB") for n in range(201, 217)]
    assets += [("BUS-417", "Arvéa eCity 12", "DEP:DEP-SRO"), ("BUS-422", "Arvéa eCity 12", "DEP:DEP-SRO"), ("BUS-431", "Arvéa eCity 12", "DEP:DEP-SRO"),
               ("BUS-104", "Arvéa Citybus 12 D — current BUS-104 (VALMO, 2017)", "DEP:DEP-AUB"), ("BUS-104-LEGACY", "Retired BUS-104 (2004 series, number reissued 2017)", "DEP:DEP-AUB"),
               ("LIFT-AUB-03", "Column lift set C, bays 3–4", "DEP:DEP-AUB"), ("TRK-T1-S07", "T1 track, chainage 3+420 → 3+980 (rev B) / 4+010 (rev C)", "LINE:T1"),
               ("SIG-T1-044", "Signal SIG-T1-044 — foundation inside rev C limit", "LINE:T1"), ("SST-04", "Traction substation Pont Neuf", "LINE:T1"),
               ("SST-02", "Traction substation Les Rives", "LINE:T2"), ("TRK-T2-S03", "T2 track, Les Rives curve", "LINE:T2"), ("CHG-SRO-B2", "Saint-Roch charging bank 2", "DEP:DEP-SRO"),
               ("SYS-SAE-01", "SAEIV on-board units (fleet-wide)", "DEP:DEP-AUB")]
    assets += [(f"TRAM-{n}", "Transalp TV-100", "DEP:DEP-CMT") for n in range(101, 113)]
    for aid, sub, loc in assets:
        rv = "rq4" if aid.startswith("BUS-104") else ("rq7" if aid == "SIG-T1-044" else None)
        node(f"AST:{aid}", aid, sub, "Asset", "thin_instance", "Asset", "eam.asset_register", review=rv)
        edge(f"AST:{aid}", "CONCEPT:Asset", "INSTANCE_OF", "schema · confidence 1.00")
        edge(f"AST:{aid}", loc, "LOCATED_AT", "resolved · confidence 0.95")
    for n in range(201, 209):
        edge(f"AST:BUS-{n}", "RSP:bus-201-208_replacement", "HAS_REPLACEMENT_DATE", "resolved · confidence 0.95")
    for n in range(209, 217):
        edge(f"AST:BUS-{n}", "RSP:bus-209-216_replacement", "HAS_REPLACEMENT_DATE", "resolved · confidence 0.96", review="rq3" if n == 209 else None)
    # components & events
    for bus, ser in (("BUS-417", "CES-420-26-0117"), ("BUS-422", "CES-420-26-0122"), ("BUS-431", "CES-420-26-0131")):
        node(f"CMP:{ser}", ser, "Celtia CES-LFP-420 traction battery pack", "Component", "thin_instance", "Component", "eam.component_installation")
        edge(f"AST:{bus}", f"CMP:{ser}", "HOSTS_COMPONENT", "resolved · installed 2026-08")
        edge(f"CMP:{ser}", "CONCEPT:Component", "INSTANCE_OF", "schema")
        edge(f"CMP:{ser}", sup_node["Celtia Energy Systems"], "SUPPLIED_BY", "resolved · confidence 0.94")
    node("FAIL:bus-204_2026-07-12", "BUS-204 engine seizure 2026-07-12", "WO-2026-071244 · loss of oil pressure, line L07", "FailureEvent", "thin_instance", "FailureEvent", "eam.failure_event")
    edge("AST:BUS-204", "FAIL:bus-204_2026-07-12", "HAS_FAILURE", "resolved · confidence 0.98"); edge("FAIL:bus-204_2026-07-12", "CONCEPT:FailureEvent", "INSTANCE_OF", "schema")
    node("MNT:bus-204_oil60k", "OIL-60K overdue by 2,400 km", "eam.maintenance_plan_due — planned task not done at due point", "Statement", "thin_instance", "Statement", "eam.maintenance_plan_due")
    edge("MNT:bus-204_oil60k", "AST:BUS-204", "ABOUT", "resolved"); edge("MNT:bus-204_oil60k", "COND:34_4_exclusion", "MAY_TRIGGER", "extracted · confidence 0.74")
    for iid, lab, a in (("INSP:ir-t1-2026-07", "IR-T1-2026-07 — wear index 94 (threshold)", "TRK-T1-S07"), ("INSP:lift-aub-03_2025", "Statutory 2025 — restricted to 12 t", "LIFT-AUB-03"),
                        ("INSP:sst-04_2026", "SST-04 — score 2 on 1–5", "SST-04")):
        node(iid, lab, "condition assessment", "ConditionAssessment", "thin_instance", "ConditionAssessment", "eam.condition_assessment; inspection report (Drive)")
        edge(f"AST:{a}", iid, "ASSESSED_BY", "resolved · confidence 0.95"); edge(iid, "CONCEPT:ConditionAssessment", "INSTANCE_OF", "schema")
    # projects
    for p in PORTFOLIO:
        pid = f"PRJ:{p['code']}"
        node(pid, p["code"], p["name"], "Project", "thin_instance", "Project", "ppm.project")
        edge(pid, "CONCEPT:Project", "INSTANCE_OF", "schema · confidence 1.00")
        edge(pid, "CON:DSP-VM-2021", "GOVERNED_BY", "declared · ppm.project.contract_id")
        edge(pid, f"DEP:{p['depot']}", "LOCATED_AT", "resolved · confidence 0.9")
    for p in ANCHORS:
        pid = f"PRJ:{p['code']}"
        for mid in ("forecast_total", "budget_variance", "open_commitment", "schedule_variance"):
            edge(pid, f"MEAS:{mid}", "HAS_MEASURE", "derived · governed measure")
    # needs
    for nid_, title, scope, trig, est, status, owner in NEEDS:
        nid = f"NEED:{nid_}"
        node(nid, nid_, title, "Need", "thin_instance", "Need", "ppm.intervention_need")
        edge(nid, "CONCEPT:Need", "INSTANCE_OF", "schema")
        edge(nid, "MEAS:renewal_backlog", "COUNTED_IN", "derived")
    edge("FAIL:bus-204_2026-07-12", "NEED:N-VM-044", "LEADS_TO_NEED", "declared · engineering assessment")
    edge("NEED:N-VM-044", "CLS:dsp_34_4", "TESTED_AGAINST", "derived · rule check")
    edge("NEED:N-VM-041", "PRJ:P-VM-042", "ADDRESSED_BY", "declared"); edge("NEED:N-VM-042", "PRJ:P-VM-065", "ADDRESSED_BY", "declared")
    edge("NEED:N-VM-039", "PRJ:P-VM-012", "ADDRESSED_BY", "declared"); edge("NEED:N-VM-047", "PRJ:P-VM-067", "ADDRESSED_BY", "declared")
    edge("NEED:N-VM-043", "PRJ:P-VM-063", "ADDRESSED_BY", "declared"); edge("NEED:N-VM-045", "PRJ:P-VM-055", "ADDRESSED_BY", "declared")
    edge("NEED:N-VM-046", "PRJ:P-VM-069", "ADDRESSED_BY", "declared")
    # project ↔ asset
    for n in range(201, 217):
        edge("PRJ:P-VM-014", f"AST:BUS-{n}", "REPLACES", "declared · ppm.project_asset_link")
    edge("PRJ:P-VM-021", "AST:LIFT-AUB-03", "REPLACES", "declared"); edge("PRJ:P-VM-008", "AST:TRK-T1-S07", "RENEWS", "declared")
    edge("PRJ:P-VM-008", "AST:SIG-T1-044", "AFFECTS_ASSET", "extracted from drawing rev C · confidence 0.66", review="rq7")
    edge("PRJ:P-VM-008", "LINE:T1", "AFFECTS_SERVICE_OF", "declared · withdrawal 2026-10-17 → 10-19")
    edge("PRJ:P-VM-017", "AST:SST-04", "RENEWS", "declared"); edge("PRJ:P-VM-026", "AST:CHG-SRO-B2", "RENEWS", "declared")
    for bus in ("BUS-417", "BUS-422", "BUS-431"):
        edge("PRJ:P-VM-031", f"AST:{bus}", "RENEWS", "declared")
    for n in range(101, 113):
        edge("PRJ:P-VM-005", f"AST:TRAM-{n}", "RENEWS", "declared")
    edge("PRJ:P-VM-014", "PRJ:P-VM-026", "DEPENDS_ON", "extracted from business case · confidence 0.91")
    edge("PRJ:P-VM-040", "PRJ:P-VM-021", "DEPENDS_ON", "extracted · bays 3–4 · confidence 0.86")
    edge("PRJ:P-VM-008", "PRJ:P-VM-014", "DEPENDS_ON", "derived · replacement buses for the closure need batch 3")
    edge("PRJ:P-VM-012", "AST:SYS-SAE-01", "RENEWS", "declared"); edge("PRJ:P-VM-042", "AST:TRK-T2-S03", "RENEWS", "declared")
    edge("PRJ:P-VM-065", "AST:SST-02", "RENEWS", "declared")
    # POs, access, acceptance, claims, change
    for pol, lab, proj, sup in (("POL:4500018812-30", "PO-4500018812/30 — HPU-9 control unit", "P-VM-021", "Levantis Équipements"),
                                ("POL:vm-2025-bus-02-b3", "VM-2025-BUS-02 batch 3 — 8 buses", "P-VM-014", "Arvéa Mobility"),
                                ("POL:vtc-2026-014", "VTC-2026-014 — rail replacement works", "P-VM-008", "Voies & Travaux du Centre (VTC)"),
                                ("POL:ero-sst04-rg", "SST-04 rectifier group", "P-VM-017", "Électro-Réseaux Ouest"),
                                ("POL:trs-2024-ovh-01", "TRS-2024-OVH-01 — overhaul base scope", "P-VM-005", "Transalp Rail Services")):
        node(pol, lab, f"commitment on {proj}", "PurchaseOrderLine", "thin_instance", "PurchaseOrderLine", "proc.po_line")
        edge(f"PRJ:{proj}", pol, "COMMITS", "declared · proc.po_line.project_code"); edge(pol, sup_node[sup], "SUPPLIED_BY", "declared")
        edge(pol, "CONCEPT:PurchaseOrderLine", "INSTANCE_OF", "schema")
    node("ACC:ACC-T1-2026-031", "ACC-T1-2026-031 (provisional)", "Weekend closure 17–19 Oct · 14 replacement buses", "AccessWindow", "thin_instance", "AccessWindow", "ops.access_window")
    edge("PRJ:P-VM-008", "ACC:ACC-T1-2026-031", "REQUIRES_ACCESS", "declared · schedule_task.predecessor"); edge("ACC:ACC-T1-2026-031", "AST:TRK-T1-S07", "GRANTS_ACCESS_TO", "declared")
    edge("ACC:ACC-T1-2026-031", "CONCEPT:AccessWindow", "INSTANCE_OF", "schema")
    node("CHG:p-vm-008_revc", "Drawing VM-T1-VOI-0457 rev C", "Work limit 3+980 → 4+010; interface review outstanding", "Statement", "thin_instance", "Statement", "drawing revision note (Drive)")
    edge("CHG:p-vm-008_revc", "PRJ:P-VM-008", "CHANGES_SCOPE_OF", "extracted · confidence 0.93"); edge("CHG:p-vm-008_revc", "AST:SIG-T1-044", "ABOUT", "extracted · confidence 0.95")
    node("CHG:rc-005-009", "RC-005-009 — frame replacement (not approved)", "€2,640,000 requested · +122 days", "Statement", "thin_instance", "Statement", "ppm.risk_change_register; change request (Drive)")
    edge("CHG:rc-005-009", "PRJ:P-VM-005", "REQUESTS_CHANGE_TO", "declared")
    for bus, st in (("BUS-417", "open defect E-214"), ("BUS-422", "certificate missing"), ("BUS-431", "open defect — temperature spread")):
        aid = f"ACP:{bus.lower()}"
        node(aid, f"{bus} — {st}", "P-VM-031 acceptance item", "AcceptanceItem", "thin_instance", "AcceptanceItem", "ppm.acceptance_item; commissioning pack (Drive)")
        edge("PRJ:P-VM-031", aid, "REQUIRES_ACCEPTANCE", "declared"); edge(aid, f"AST:{bus}", "ABOUT", "resolved")
        edge(aid, "MEAS:acceptance_completeness", "COUNTED_IN", "derived")
    for cid, proj, sub, amt, status, note in CLAIMS:
        nid = f"CLM:{cid}"
        node(nid, f"{cid} ({status})", note, "FundingClaim", "thin_instance", "FundingClaim", "fin.funding_claim")
        edge(nid, "PRJ:" + proj if proj.startswith("P-") else "NEED:" + proj, "CLAIMS_FOR", "declared")
        edge(nid, "CONCEPT:FundingClaim", "INSTANCE_OF", "schema")
    # statements from correspondence and documents (runtime observations are not canvas facts — only document statements)
    for sid, lab, about, rel, rv in (("STM:tranche3_funding_expected", "Minutes: tranche 3 'expected' to be funded", "PRJ:P-VM-058", "ABOUT", "rq5"),
                                     ("STM:p-vm-021_on_schedule", "Progress report: P-VM-021 on schedule", "PRJ:P-VM-021", "ABOUT", None),
                                     ("STM:vtc_rev_b", "VTC method statement assumes rev B", "PRJ:P-VM-008", "CONTRADICTS", None),
                                     ("STM:bus-204_draft_position", "Draft: BUS-204 recoverable €28,000", "NEED:N-VM-044", "ABOUT", None),
                                     ("STM:p-vm-005_assumption", "Option study: no frame replacement assumed", "PRJ:P-VM-005", "ABOUT", None),
                                     ("SCM:vm-2025-bus-02_batch3", "Arvéa rev 3: batch 3 on 2026-09-30", "POL:vm-2025-bus-02-b3", "ABOUT", None),
                                     ("SCM:dso_energisation", "DSO: energisation 2026-10-20", "PRJ:P-VM-026", "ABOUT", None),
                                     ("SCM:vtc_mobilisation", "VTC mobilisation 2026-10-12", "POL:vtc-2026-014", "ABOUT", None)):
        node(sid, lab, "dated statement — evidence, not a record", "Statement", "thin_instance", "Statement", "extracted from Drive document", review=rv)
        edge(sid, about, rel, "extracted · confidence 0.85", review=rv)
        edge(sid, "CONCEPT:Statement", "INSTANCE_OF", "schema")
    edge("STM:vtc_rev_b", "CHG:p-vm-008_revc", "CONTRADICTS", "derived · revision mismatch")
    edge("STM:p-vm-005_assumption", "CHG:rc-005-009", "CONTRADICTS", "derived · 31% of frames cracked vs 10% trigger")
    # schedule tasks for the anchor projects (baseline vs current)
    TASKS = {
        "P-VM-021": [("T01", "Civil works bays 3–4", None), ("T02", "Columns delivered", None), ("T03", "HPU-9 delivered", "POL:4500018812-30"), ("T04", "Installation", "T03"), ("T05", "Commissioning & statutory test", "T04"), ("T06", "Handover to depot", "T05")],
        "P-VM-008": [("T01", "Drawing rev C issued", None), ("T02", "Signalling interface review", "T01"), ("T03", "Possession approved", "ACC:ACC-T1-2026-031"), ("T04", "Mobilisation", None), ("T05", "Rail replacement (closure)", "T03"), ("T06", "Welding & grinding (nights)", "T05")],
        "P-VM-014": [("T01", "Batch 1 accepted", None), ("T02", "Batch 2 accepted", None), ("T03", "Batch 3 delivered", "POL:vm-2025-bus-02-b3"), ("T04", "Charging bank 2 energised", "PRJ:P-VM-026"), ("T05", "Batch 3 released for duty", "T03"), ("T06", "BUS-201–216 withdrawn", "T05")],
        "P-VM-031": [("T01", "40 packs installed", None), ("T02", "Acceptance tests", "T01"), ("T03", "Defect rectification BUS-417/431", "T02"), ("T04", "Certificate BUS-422", "T02"), ("T05", "Operational acceptance (warranty start)", "T03")],
        "P-VM-005": [("T01", "NDT batch 1 (trams 101–108)", None), ("T02", "Change decision RC-005-009", "CHG:rc-005-009"), ("T03", "Overhaul trams 109–116", "T02"), ("T04", "Overhaul trams 117–124", "T03")],
        "P-VM-017": [("T01", "Rectifier ordered", None), ("T02", "Rectifier delivered", "POL:ero-sst04-rg"), ("T03", "Night possessions for cut-over", "T02"), ("T04", "SST-04 energised", "T03")],
        "P-VM-026": [("T01", "Bank 1 energised", None), ("T02", "DSO reinforcement", "SCM:dso_energisation"), ("T03", "Bank 2 energised", "T02")],
    }
    for proj, tasks in TASKS.items():
        for tid, lab, pred in tasks:
            nid = f"TSK:{proj}-{tid}"
            node(nid, f"{proj} · {lab}", "ppm.schedule_task", "ScheduleTask", "thin_instance", "ScheduleTask", "ppm.schedule_task")
            edge(f"PRJ:{proj}", nid, "HAS_TASK", "declared")
            if pred:
                tgt = f"TSK:{proj}-{pred}" if pred.startswith("T0") else pred
                edge(nid, tgt, "DEPENDS_ON", "declared · schedule_task.predecessor")
    # every funded project carries its governed measures
    for p in PORTFOLIO:
        if p["budget"] and p["code"] not in {a["code"] for a in ANCHORS}:
            edge(f"PRJ:{p['code']}", "MEAS:forecast_total", "HAS_MEASURE", "derived · governed measure")
    # concept-level schema edges
    for a, b, l in (("Project", "Asset", "AFFECTS_ASSET"), ("Project", "Contract", "GOVERNED_BY"), ("Need", "Project", "ADDRESSED_BY"), ("Need", "Option", "HAS_OPTION"),
                    ("Contract", "Clause", "CONTAINS_CLAUSE"), ("Amendment", "Contract", "AMENDS"), ("Clause", "ResponsibilityAssignment", "ASSIGNS"),
                    ("ResponsibilityAssignment", "Organisation", "ASSIGNED_TO"), ("Project", "PurchaseOrderLine", "COMMITS"), ("PurchaseOrderLine", "Supplier", "SUPPLIED_BY"),
                    ("Project", "FundingClaim", "CLAIMED_UNDER"), ("Project", "ScheduleTask", "HAS_TASK"), ("ScheduleTask", "AccessWindow", "DEPENDS_ON_ACCESS"),
                    ("Project", "AcceptanceItem", "REQUIRES_ACCEPTANCE"), ("Asset", "FailureEvent", "HAS_FAILURE"), ("Asset", "ConditionAssessment", "ASSESSED_BY"),
                    ("Asset", "Component", "HOSTS_COMPONENT"), ("FailureEvent", "Need", "LEADS_TO_NEED"), ("Asset", "Depot", "LOCATED_AT"),
                    ("ServiceRequirement", "Line", "REQUIRED_FOR"), ("Statement", "Project", "ABOUT"), ("Project", "Measure", "HAS_MEASURE")):
        edge(f"CONCEPT:{a}", f"CONCEPT:{b}", l, "schema · confidence 0.98")
    NODES["MEAS:acceptance_completeness"]["review_item_id"] = "rq1"
    # degree + layout
    G = nx.Graph()
    G.add_nodes_from(NODES)
    for e in EDGES:
        G.add_edge(e["from"], e["to"])
    pos = nx.spring_layout(G, seed=7, k=0.9 / (len(NODES) ** 0.5), iterations=120)
    xs = [p[0] for p in pos.values()]; ys = [p[1] for p in pos.values()]
    for nid, n in NODES.items():
        d = G.degree(nid)
        n["degree"] = d
        n["r"] = 12 if n["element_class"] == "concept" else (min(14, 4 + d // 2) if d > 2 else 4)
        n["x"] = round(40 + (pos[nid][0] - min(xs)) / (max(xs) - min(xs)) * 1120, 1)
        n["y"] = round(40 + (pos[nid][1] - min(ys)) / (max(ys) - min(ys)) * 820, 1)
    # stable key order (review_item_id last, as in the package)
    order = ["node_id", "label", "sublabel", "type", "element_class", "group", "source", "confidence", "degree", "r", "x", "y", "review_item_id"]
    nodes = [{k: n[k] for k in order if k in n} for n in NODES.values()]
    return nodes, list(EDGES)

if __name__ == "__main__":
    n, e = build()
    print(len(n), "nodes", len(e), "edges")
