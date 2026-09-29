"""New Graph wizard pools, the committed use case, Graph Studio (review queue, canvas, sanity checks)
and the as-built studio graph (structured lane, document lane, Bridge)."""
import re, json, os, hashlib
from world import *
import tables as T
import corpus as C
import graph_model as G
import answers as AN

DOMAINS = [
    {"domain_id": "fleet-infrastructure-sgr", "name": "Fleet & Infrastructure Renewal (SGR)",
     "expected_sources": ["EAM assets & maintenance", "ERP finance & purchasing", "PPM portfolio & approvals", "Contract register", "Capital renewal documents"],
     "fit": "strong", "note": "All five expected sources are connected and profiled; the contract, amendments and project evidence are in the Drive corpus.",
     "unmet_note": "No asset, finance or project source connected.", "rank": 1},
    {"domain_id": "contract-recovery", "name": "Contract Responsibility & Recovery",
     "expected_sources": ["Contract register", "Executed contract and amendments", "ERP funding claims"],
     "fit": "partial", "note": "Responsibility assignments, amendments and claim states resolve. Legal liability is out of scope — the graph raises review items, it does not decide them.",
     "unmet_note": "No contract register or executed contract connected.", "rank": 2},
    {"domain_id": "service-readiness", "name": "Operational Readiness",
     "expected_sources": ["Service requirement", "Access windows", "Availability intervals", "Workforce & crew planning"],
     "fit": "partial", "note": "Service requirement, access windows and availability are connected; workforce planning is not, so skills and crews are never tested.",
     "unmet_note": "No service-planning or availability source connected.", "rank": 3},
    {"domain_id": "predictive-asset", "name": "Predictive Asset Failure",
     "expected_sources": ["Censored failure history", "Telemetry for every asset class", "Operating context"],
     "fit": "none", "note": "Telemetry covers buses only and no failure series is censored for assets that have not failed — prediction would not validate out of time.",
     "unmet_note": "No telemetry or censored failure history connected.", "rank": 4},
]
DOM_MAIN = ["fleet-infrastructure-sgr"]
DOM_ALL = ["fleet-infrastructure-sgr", "contract-recovery", "service-readiness"]

PERSONAS = [
    ("opco-exec", AN.OE, ["fleet-infrastructure-sgr", "contract-recovery"], ["intervention", "exposure", "readiness", "decision", "this week", "portfolio"], "Asks which projects need a decision this week, what the full exposure is, and whether approved work is ready."),
    ("investment-controller", AN.IC, ["fleet-infrastructure-sgr"], ["forecast", "budget", "variance", "accrual", "commitment", "cost to complete"], "Asks whether forecasts reconcile, what moved and why, and what sits outside the authorised scope."),
    ("maintenance-lead", AN.ML, ["fleet-infrastructure-sgr", "service-readiness"], ["condition", "failure", "acceptance", "warranty", "renewal", "backlog"], "Asks which assets need renewal, what is really accepted, and where failures concentrate."),
    ("infra-pm", AN.PM, ["fleet-infrastructure-sgr", "service-readiness"], ["track", "possession", "access", "schedule", "dependency", "scope"], "Asks whether works can start, what they depend on, and what has changed in scope."),
    ("commercial-lead", AN.CM, ["contract-recovery"], ["contract", "avenant", "clause", "responsibility", "notice", "recovery"], "Asks who pays, which clause applies, which amendment changed it, and whether notice was given."),
    ("service-planning", AN.SP, ["service-readiness"], ["peak", "reserve", "availability", "replacement bus", "closure", "timetable"], "Asks whether service can be held while assets are withdrawn."),
    ("authority-liaison", AN.AL, ["contract-recovery", "fleet-infrastructure-sgr"], ["PPI", "claim", "authority", "funding", "evidence", "quarterly review"], "Asks what the authority will see, what is claimable and what is only potential."),
]

METRICS = [
    ("forecast-total-project-cost", "Forecast Total Project Cost", ["forecast", "total", "cost", "outturn"], "Forecast_Total = [Posted actuals] + [Valid uninvoiced accruals] + [Forecast cost to complete]. Accruals are matched and reversed when invoices arrive; cost to complete excludes work already accrued."),
    ("forecast-cost-to-complete", "Forecast Cost to Complete", ["cost to complete", "remaining", "ctc"], "CTC = [Remaining committed work] + [Expected uncommitted work] + [Contingency held separately]. Never adds the full PO value again."),
    ("forecast-budget-variance", "Forecast Budget Variance", ["variance", "overrun", "budget"], "Variance = [Forecast_Total] − [Current approved budget]. Positive means overrun; the original baseline variance is kept beside it."),
    ("open-commitment", "Open Commitment", ["commitment", "po", "committed"], "Open_Commitment = [Ordered] − [Received] − [Cancelled], at the PO line's valuation basis. Unpaid invoices are not future work."),
    ("approved-funding-gap", "Approved Funding Gap", ["funding", "gap", "ppi", "grant"], "Funding_Gap = [Forecast fundable expenditure] − [Applicable approved funding], applying scope, caps and co-funding; uncovered costs labelled separately."),
    ("operator-exposure", "Operator Exposure", ["exposure", "operator", "keolis", "ger"], "Operator_Exposure = Σ costs borne by Keolis Valmont under validated allocations, with unresolved-exposure scenarios shown separately. Never equal to project cost."),
    ("service-availability-margin", "Service Availability Margin", ["availability", "peak", "reserve", "margin"], "Margin = [Eligible available vehicles] − [Peak requirement] − [Agreed reserve], by class, location and time; each unavailable vehicle subtracted once."),
    ("failure-frequency", "Failure Frequency", ["failure", "reliability", "per 100,000 km"], "Failure_Frequency = [Relevant failures] ÷ [Distance] × 100,000, with a consistent failure taxonomy and peer group."),
    ("schedule-variance", "Schedule Variance", ["schedule", "slip", "milestone", "baseline"], "Schedule_Variance = [Current forecast milestone date] − [Approved baseline milestone date], on the working calendar; approved re-baselining identified."),
    ("renewal-backlog", "Renewal Backlog", ["backlog", "need", "unfunded", "renewal"], "Renewal_Backlog = validated intervention needs not yet completed, by status (unfunded, approved, in progress, deferred), overlapping options de-duplicated."),
    ("acceptance-completeness", "Documented Acceptance Completeness", ["acceptance", "commissioning", "certificate", "handover"], "Completeness = [Verified required acceptance items] ÷ [Applicable required items]. Completeness is not permission to operate."),
    ("project-cash-position", "Project Cash Position", ["cash", "paid", "received", "claim"], "Cash_Position = [Cash paid] − [Project-related cash received] at a stated cutoff; excludes unpaid expense and uncollected approved recovery."),
]

FORMATS = [
    ("ranked-exception", "Ranked exception list", "table ranked by business rules, factors visible, owner per row", ["intervention", "attention", "this week", "exceptions"]),
    ("exposure-split", "Exposure by perspective", "metric row + authority vs operator split + claim states table", ["exposure", "who pays", "operator", "authority"]),
    ("readiness-gates", "Readiness gates", "one row per start, one column per gate, untested gates left blank", ["ready", "start", "readiness", "proceed"]),
    ("established-vs-unresolved", "Established vs unresolved", "two tables: facts with sources, open questions with owners", ["who pays", "responsible", "liable", "recovery"]),
    ("installed-accepted-eligible", "Installed · accepted · eligible", "three counts side by side + exceptions table", ["complete", "installed", "accepted", "campaign"]),
    ("variance-explained", "Variance explained", "narrative + metric row + drivers bar with evidence per driver", ["variance", "overrun", "why", "grown"]),
    ("project-360", "Project 360", "narrative + forecast decomposition + schedule + correspondence", ["project", "status", "on budget", "on time"]),
    ("what-was-known", "What was known, when", "timeline table by knowledge date", ["known", "when", "history", "at the time"]),
    ("provenance-table", "Provenance table", "every figure with dataset, basis and as-of", ["source", "provenance", "as-of", "where from"]),
    ("decline-with-alternative", "Decline with alternative", "reason for declining + what can be answered instead", ["predict", "optimise", "roi", "liable"]),
]

def pools():
    personas = []
    by_persona = {}
    heroes = [a for a in AN.ANS if a["kind"] != "decline"]
    qid = {}
    n_std = 15
    for a in heroes:
        if a["hero_ref"]:
            qid[a["answer_id"]] = a["hero_ref"]
        else:
            qid[a["answer_id"]] = f"hq{n_std}"; n_std += 1
    for pid, name, doms, kws, focus in PERSONAS:
        tq = [qid[a["answer_id"]] for a in heroes if a["persona"] == name][:6]
        personas.append({"persona_id": pid, "name": name, "domains": doms, "keywords": kws, "focus": focus, "top_questions": tq})
    hq = []
    for a in heroes:
        p = next(x for x in PERSONAS if x[1] == a["persona"])
        srcs = sorted({c["label"] for c in a["citations"] if c["kind"] == "dataset"})
        runtime = any(c["kind"] == "correspondence" for c in a["citations"])
        conf = "high" if a["confidence"] >= 0.85 else "medium"
        rat = f"Resolves across {' + '.join(srcs) if srcs else 'the document corpus'}{' + mailbox at question time' if runtime else ''} at {conf} confidence ({a['confidence']:.2f})."
        kws = [w for w in re.findall(r"[a-z][a-z\-]{3,}", a["question"].lower()) if w not in ("which", "what", "does", "with", "that", "this", "there", "still", "have", "from", "they", "their", "every")][:6]
        hq.append({"question_id": qid[a["answer_id"]], "text": a["question"], "domains": p[2], "keywords": kws, "persona": a["persona"], "answer_id": a["answer_id"], "rationale": rat})
    metrics = [{"metric_id": i, "name": n, "domains": DOM_ALL[:2], "keywords": k, "definition": d} for i, n, k, d in METRICS]
    formats = [{"format_id": i, "name": n, "format": f, "domains": DOM_ALL[:2], "keywords": k} for i, n, f, k in FORMATS]
    return personas, hq, metrics, formats, qid

USE_CASE_ID = "uc-fleet-infrastructure-renewal-kv26a01"
def use_case(personas, metrics):
    return {
        "use_case_id": USE_CASE_ID, "name": "Fleet & Infrastructure Renewal — Keolis Valmont", "status": "committed", "domain_id": "fleet-infrastructure-sgr",
        "business_need": ("Support capital renewal decisions on the Réseau Valmo operating contract (DSP-VM-2021): which projects need intervention this week, "
                          "what their full financial exposure is from the operator's and the authority's perspectives, and whether approved work is ready to "
                          "proceed without undermining service. Connect asset condition and project delivery to service requirements, contractual "
                          "responsibility, financial exposure and exact source evidence, and keep a reported issue, an approved decision, a posted cost and a realised outcome apart."),
        "personas": [{"name": p["name"], "description": p["focus"], "source": "ai", "origin": None} for p in personas[:5]],
        "metrics": [{"name": x["name"], "description": x["definition"].split(". ")[0] + ".", "source": "ai", "origin": None, "sql": None} for x in metrics[:9]],
        "sources": [{"source_id": "bigquery:keolis_valmont_ppm", "mode": "all", "objects": []}, {"source_id": "bigquery:keolis_valmont_erp", "mode": "all", "objects": []},
                    {"source_id": "bigquery:keolis_valmont_eam", "mode": "all", "objects": []}, {"source_id": f"gdrive:{C.DRIVE_ID}", "mode": "all", "objects": []},
                    {"source_id": "gmail:nishant.srivastav@vriodigital.com", "mode": "all", "objects": []}],
        "hero_questions": [
            {"text": "Which renewal projects need intervention this week, and why?", "priority": "high", "source": "ai",
             "sql": "SELECT p.project_code, p.project_name, p.stage, s.task_name, s.baseline_finish, s.current_finish\nFROM `ppm`.`project` p\nJOIN `ppm`.`schedule_task` s ON s.project_code = p.project_code\nWHERE s.current_finish > s.baseline_finish\nLIMIT 1000"},
            {"text": "What is our full financial exposure on the renewal portfolio?", "priority": "high", "source": "ai",
             "sql": "SELECT b.project_code, SUM(b.amount_eur) AS approved_eur\nFROM `fin`.`budget_line` b\nGROUP BY b.project_code\nLIMIT 1000"},
            {"text": "Is the approved work ready to proceed without undermining service?", "priority": "high", "source": "ai",
             "sql": "SELECT a.access_ref, a.segment_id, a.window_start, a.status, a.substitution_buses\nFROM `ops`.`access_window` a\nWHERE a.status <> 'Approved'\nLIMIT 1000"},
            {"text": "Who pays for the BUS-204 engine repair?", "priority": "normal", "source": "ai",
             "sql": "SELECT r.asset_scope, r.role, r.party, r.clause_ref, r.valid_from, r.valid_to, r.conditions\nFROM `contract`.`responsibility_assignment` r\nWHERE r.asset_scope LIKE 'BUS-20%'\nLIMIT 1000"},
            {"text": "Is the battery replacement campaign complete?", "priority": "normal", "source": "ai",
             "sql": "SELECT a.result, COUNT(*) AS items\nFROM `ppm`.`acceptance_item` a\nWHERE a.project_code = 'P-VM-031'\nGROUP BY a.result\nLIMIT 1000"},
        ],
        "gap_decisions": [], "golden_query_files": [], "step": 5, "updated_at": "2026-09-23T15:42:10.118Z",
    }

def template(personas, metrics, hq):
    return [{"template_id": "fleet-infrastructure-renewal", "use_case_id": "uc_fleet_infrastructure_renewal", "name": "Fleet & Infrastructure Renewal",
             "description": "One model over asset condition, project delivery, finance, contract responsibility and evidence, so a renewal question resolves once — with the perspective (operator or authority) stated.",
             "match_phrases": ["capital renewal", "state of good repair", "fleet renewal", "track renewal", "renewal backlog", "who pays", "operator exposure", "readiness"],
             "personas": [p["persona_id"] for p in personas], "metrics": [m["metric_id"] for m in metrics[:8]], "hero_questions": [h["question_id"] for h in hq[:14]]}]

# ------------------------------------------------------------------ Graph Studio
REVIEW = [
    dict(item_id="rq1", kind="measure", title="'Installed' proposed as the completion state for P-VM-031 — treat installed packs as accepted?",
         detail="The project manager's message says the campaign is 'complete' with 40 packs installed. The acceptance register shows 37 accepted. Accepting the proposal would make 'complete' mean 'installed' in every answer that names the campaign.",
         confidence=0.41, band="Low", floor="state semantics (semantics-changing)", action_set="measure",
         actions=[{"choice": "keep", "label": "Keep installed and accepted distinct"}, {"choice": "create", "label": "Create a 'complete' state = accepted"}, {"choice": "correct", "label": "Correct mapping..."}],
         evidence=["msg_008: 'all 40 battery packs are installed, so the campaign is complete'", "ppm.acceptance_item P-VM-031: 37 Passed, 2 Failed, 1 Missing", "Warranty CES-2025-114 starts at operational acceptance"],
         graph_refs=["PRJ:P-VM-031", "MEAS:acceptance_completeness", "ACP:bus-417", "ACP:bus-422"], justification=True),
    dict(item_id="rq2", kind="entity", title="Arvéa Mobility and 'ARVEA MOBILITY SAS' — same supplier across 3 documents, merge?",
         detail="The supplier appears as 'Arvéa Mobility' in the business case and the delivery programme, and as 'ARVEA MOBILITY SAS' in the authority's contract register. Same SIREN in both party blocks.",
         confidence=0.88, band="High", floor="identity merge (schema-changing)", action_set="entity",
         actions=[{"choice": "approve_merge", "label": "Approve merge"}, {"choice": "keep", "label": "Keep distinct"}, {"choice": "correct", "label": "Correct..."}],
         evidence=["VM-2025-BUS-02 party block: Arvéa Mobility", "contract register: ARVEA MOBILITY SAS", "P-VM-014 business case: Arvéa"], graph_refs=["SUP:arvea_mobility"], justification=False),
    dict(item_id="rq3", kind="relationship", title="Avenant n°3 → Annex 7 lines BUS-209..216, matched on the asset range printed in the amendment table — accept?",
         detail="The amendment states the range 'BUS-209 – BUS-216'. The extractor expanded it to eight asset links and set their replacement date to 2026-12-31 from 1 April 2026 (effective), received 18 April 2026.",
         confidence=0.86, band="High", floor="unstructured -> structured (schema-changing)", action_set="relationship",
         actions=[{"choice": "approve", "label": "Approve links"}, {"choice": "correct", "label": "Correct range..."}, {"choice": "reject", "label": "Reject"}],
         evidence=["DSP-VM-2021-AV3 p.1 table row 2", "contract.contract_version AV3 effective 2026-04-01, received 2026-04-18"], graph_refs=["CON:DSP-VM-2021-AV3", "RSP:bus-209-216_replacement", "AST:BUS-209"], justification=False),
    dict(item_id="rq4", kind="entity", title="BUS-104 (VALMO, 2017) and BUS-104 (2004 series) — merge on fleet number?",
         detail="Fleet number 104 was reissued in 2017. The retired 2004 vehicle keeps its own asset_id, VIN and history. Merging would attach 13 years of the old vehicle's failures to the current one.",
         confidence=0.33, band="Low", floor="identity merge (schema-changing)", action_set="entity",
         actions=[{"choice": "keep", "label": "Keep distinct"}, {"choice": "approve_merge", "label": "Approve merge"}, {"choice": "correct", "label": "Correct..."}],
         evidence=["asset_register: two asset_ids share source_alias 104", "different VINs", "valid_to 2017-02-28 on the retired row"], graph_refs=["AST:BUS-104", "AST:BUS-104-LEGACY"], justification=True),
    dict(item_id="rq5", kind="relationship", title="Minutes: 'tranche 3 expected to be funded' → approval of P-VM-058?",
         detail="The Q2 PPI review minutes record the authority's expectation that the Bureau will fund tranche 3 in October. The extractor proposed an APPROVES edge. The approval register has no decision on P-VM-058.",
         confidence=0.58, band="Medium", floor="authorisation (semantics-changing)", action_set="relationship",
         actions=[{"choice": "reject", "label": "Keep as reported expectation"}, {"choice": "approve", "label": "Approve as approval"}, {"choice": "correct", "label": "Correct..."}],
         evidence=["PPI_2024-2028_Quarterly_Review_Q2-2026_Minutes.pdf §2", "msg_014: 'I cannot commit the budget before the vote'", "ppm.approval_decision: none for P-VM-058"], graph_refs=["STM:tranche3_funding_expected", "PRJ:P-VM-058"], justification=True),
    dict(item_id="rq6", kind="measure", title="€25,000 external workshop proposed into the P-VM-021 forecast?",
         detail="Maintenance proposes sending 4 hybrids to an external workshop while lift set C is down. Whether it belongs in the project forecast or the maintenance operating budget is finance's decision; it is not authorised.",
         confidence=0.69, band="Medium", floor="derived element (semantics-changing)", action_set="measure",
         actions=[{"choice": "keep", "label": "Keep as proposal, outside forecast"}, {"choice": "create", "label": "Add to project forecast"}, {"choice": "correct", "label": "Correct..."}],
         evidence=["msg_003: 'Not approved — need finance view'", "fin.forecast_snapshot P-VM-021 2026-09-15: no such line"], graph_refs=["PRJ:P-VM-021"], justification=True),
    dict(item_id="rq7", kind="relationship", title="SIG-T1-044 linked to P-VM-008 from drawing revision C — add AFFECTS_ASSET?",
         detail="Revision C moves the work limit to 4+010, which takes in the SIG-T1-044 foundation. The link comes from the drawing note; no GIS is connected to confirm the geometry.",
         confidence=0.66, band="Medium", floor="unstructured -> structured (schema-changing)", action_set="relationship",
         actions=[{"choice": "approve", "label": "Approve link"}, {"choice": "correct", "label": "Correct..."}, {"choice": "reject", "label": "Reject"}],
         evidence=["VM-T1-VOI-0457 rev C change 2", "msg_006 engineering confirmation"], graph_refs=["AST:SIG-T1-044", "PRJ:P-VM-008", "CHG:p-vm-008_revc"], justification=False),
    dict(item_id="rq8", kind="relationship", title="Unallocated ledger lines at DEP-SRO (€486,210) proposed to P-VM-047 by cost centre — allocate?",
         detail="138 lines with no project code carry cost centre DEP-SRO, where P-VM-047 is delivered. A shared cost centre is not evidence that a line belongs to a project.",
         confidence=0.29, band="Low", floor="cost allocation (semantics-changing)", action_set="relationship",
         actions=[{"choice": "reject", "label": "Keep unallocated"}, {"choice": "approve", "label": "Allocate"}, {"choice": "correct", "label": "Correct..."}],
         evidence=["fin.cost_transaction: 138 lines, project_code null, cost_center DEP-SRO", "P-VM-047 depot DEP-SRO"], graph_refs=["PRJ:P-VM-047"], justification=True),
]

def graph_studio(nodes, edges):
    idx = {(e["from"], e["to"]): e["edge_id"] for e in edges}
    def eid(a, b): return idx.get((a, b)) or idx.get((b, a))
    piv = REVIEW[0]
    pivot = {"pivot_id": "pv_rq1", "alternative_id": "rq1", "title": piv["title"], "detail": piv["detail"],
             "why_pivot": "This item changes what a word means, not what a row says. Accepting it silently would make 'complete' mean 'installed' in every answer about the campaign — and start three warranties early.",
             "confidence": piv["confidence"], "band": piv["band"], "floor": piv["floor"], "evidence": piv["evidence"], "graph_refs": piv["graph_refs"][:3],
             "options": [{"option_id": "keep", "label": "Keep installed and accepted distinct", "consequence": "Answers report installed 40 · accepted 37 · duty-eligible 37."},
                         {"option_id": "create", "label": "Create a 'complete' state = accepted", "consequence": "Adds a state; 'complete' then means accepted, never installed."},
                         {"option_id": "correct", "label": "Correct mapping...", "consequence": ""}]}
    ref_nodes = {r for it in REVIEW for r in it["graph_refs"]}
    for n in nodes:
        pass
    sanity = [
        {"check_id": "sc1", "hero_question_id": "HQ-01", "question": "Which renewal projects need intervention this week, and why?", "verdict": "Answerable - with factors kept visible",
         "verdict_body": "The walk is Project -> ScheduleTask (baseline vs current) and Project -> PurchaseOrderLine -> Supplier statements, plus Project -> AccessWindow. It ranks by the agreed rules and never collapses them into one score. Supplier dates read from correspondence stay unconfirmed.",
         "context": [{"chip": "rules", "label": "six business rules", "meta": "mandatory date · service · cost · funding · supplier · approval", "ok": True},
                     {"chip": "as-of", "label": "PPM 19 Sep", "meta": "weekly publication sets the floor", "ok": True},
                     {"chip": "runtime", "label": "mailbox", "meta": "statements, not records", "ok": True}],
         "plan": "MATCH (p:Project)-[:HAS_TASK]->(t:ScheduleTask)\nOPTIONAL MATCH (p)-[:COMMITS]->(po:PurchaseOrderLine)\nOPTIONAL MATCH (p)-[:REQUIRES_ACCESS]->(a:AccessWindow)\nRETURN p, t, po, a",
         "cost_usd": 0.16, "budget_usd": 2, "path": ["CONCEPT:Project", "PRJ:P-VM-008", "ACC:ACC-T1-2026-031"], "edges_used": [eid("PRJ:P-VM-008", "ACC:ACC-T1-2026-031")]},
        {"check_id": "sc2", "hero_question_id": "HQ-05", "question": "Who pays for the BUS-204 engine repair?", "verdict": "Answerable - as established vs unresolved",
         "verdict_body": "Asset -> ResponsibilityAssignment (replacement date) -> Clause 34.4 (as restated by AV2) -> Conditions. The notice and cap conditions resolve; the maintenance-default exclusion does not, so the answer is a review item, not a receivable.",
         "context": [{"chip": "amendment", "label": "AV3 checked", "meta": "covers BUS-209–216 only", "ok": True}, {"chip": "condition", "label": "exclusion open", "meta": "OIL-60K overdue 2,400 km", "ok": False},
                     {"chip": "money", "label": "estimate", "meta": "not posted, not claimed", "ok": True}],
         "plan": "MATCH (a:Asset {id:'BUS-204'})-[:HAS_REPLACEMENT_DATE]->(r:ResponsibilityAssignment)\nMATCH (c:Clause {id:'dsp_34_4'})-[:HAS_CONDITION]->(k)\nRETURN a, r, c, k",
         "cost_usd": 0.12, "budget_usd": 2, "path": ["AST:BUS-204", "RSP:bus-201-208_replacement", "CLS:dsp_34_4", "COND:34_4_exclusion"],
         "edges_used": [eid("AST:BUS-204", "RSP:bus-201-208_replacement"), eid("CLS:dsp_34_4", "COND:34_4_exclusion")]},
        {"check_id": "sc3", "hero_question_id": "HQ-07", "question": "Is the battery replacement campaign complete?", "verdict": "Answerable - three counts, not one",
         "verdict_body": "Project -> AcceptanceItem and Asset availability give installed 40, accepted 37, duty-eligible 37. It depends on rq1 staying 'keep distinct'.",
         "context": [{"chip": "state", "label": "installed ≠ accepted", "meta": "rq1 pivot open", "ok": False}, {"chip": "source", "label": "acceptance register", "meta": "authoritative for acceptance", "ok": True}],
         "plan": "MATCH (p:Project {id:'P-VM-031'})-[:REQUIRES_ACCEPTANCE]->(i:AcceptanceItem)\nRETURN i.result, count(*)",
         "cost_usd": 0.05, "budget_usd": 2, "path": ["PRJ:P-VM-031", "ACP:bus-422"], "edges_used": [eid("PRJ:P-VM-031", "ACP:bus-422")]},
        {"check_id": "sc4", "hero_question_id": "HQ-10", "question": "Do we have enough buses for peak service while tranche 2 is late and the T1 closure runs?", "verdict": "Answerable for vehicles only",
         "verdict_body": "ServiceRequirement and availability intervals resolve the vehicle margin. Drivers cannot be tested: no workforce source.",
         "context": [{"chip": "coverage", "label": "vehicles", "meta": "availability intervals", "ok": True}, {"chip": "coverage", "label": "crews", "meta": "not connected", "ok": False}],
         "plan": "MATCH (s:ServiceRequirement {class:'Bus 12 m'})\nMATCH (a:Asset)-[:HAS_AVAILABILITY_STATE]->(st {state:'Available'})\nRETURN s.peak, s.reserve, count(a)",
         "cost_usd": 0.08, "budget_usd": 2, "path": ["SRQ:bus_12m", "CONCEPT:Asset"], "edges_used": []},
        {"check_id": "sc5", "hero_question_id": "HQ-43", "question": "Predict which trams will fail in the next quarter.", "verdict": "Declined - required data has no instances",
         "verdict_body": "Refused before planning: no tram telemetry, no censored failure history, no out-of-time validation set. The domain 'Predictive Asset Failure' ranks 'none' for the same reason.",
         "context": [{"chip": "data", "label": "telemetry", "meta": "buses only", "ok": False}, {"chip": "method", "label": "validation", "meta": "no out-of-time set", "ok": False}],
         "plan": "-- refused before planning: required inputs have no instances", "cost_usd": 0, "budget_usd": 2, "path": ["CONCEPT:FailureEvent"], "edges_used": []},
    ]
    gen = {"must_review_total": len(REVIEW), "confirmed_total": 212, "auto_approved_total": 301, "extracted_total": sum(len(d["extractions"]) for d in C.DOCS),
           "elements_total": len(nodes) + len(edges), "nodes": len(nodes), "edges": len(edges), "sample_size": len(REVIEW), "spot_check_quota": 9,
           "subjects": sorted({n["type"] for n in nodes if n["element_class"] != "concept"}), "predicates": sorted({e["label"] for e in edges})}
    return {"review_items": REVIEW, "pivot": pivot, "canvas": {"nodes": nodes, "edges": edges}, "generated": gen, "sanity_checks": sanity}

# ------------------------------------------------------------------ studio_graph (as-built lanes)
SG_TABLES = ["ppm.project", "ppm.schedule_task", "ppm.acceptance_item", "fin.budget_line", "fin.forecast_snapshot", "fin.funding_claim", "proc.po_line",
             "eam.asset_register", "eam.failure_event", "contract.responsibility_assignment"]
CONCEPT_OF = {"ppm.project": "Projects", "ppm.schedule_task": "Schedule_Tasks", "ppm.acceptance_item": "Acceptance_Items", "fin.budget_line": "Budget_Lines",
              "fin.forecast_snapshot": "Forecasts", "fin.funding_claim": "Funding_Claims", "proc.po_line": "Commitments", "eam.asset_register": "Assets",
              "eam.failure_event": "Failures", "contract.responsibility_assignment": "Responsibilities"}
CONCEPT_DESC = {
    "Projects": "Capital renewal projects under the operating contract, with stage, owner and purpose split.",
    "Schedule_Tasks": "Tasks with baseline and current finish dates and their predecessors, including external dependencies.",
    "Acceptance_Items": "Required tests, certificates and deliverables per asset before handover.",
    "Budget_Lines": "Approved budget amounts per project, cost category and budget version.",
    "Forecasts": "Forecast snapshots: remaining committed, uncommitted and separately held contingency.",
    "Funding_Claims": "Claims to the authority in five separate states.",
    "Commitments": "Purchase-order lines: ordered, received, cancelled, required and promised dates.",
    "Assets": "The canonical asset register with dated versions.",
    "Failures": "Reported failures; confirmed failure mode is separate from the symptom.",
    "Responsibilities": "Who owns, maintains, replaces, pays or approves — per asset scope and period.",
}
def _u(s): return uuid5("sg/" + s)

def studio_graph():
    gid = _u("story")
    tabs, cols, edges = [], [], []
    tk_to_ref = {}
    for proj, ds, t in T.iter_tables():
        tk = T.table_key(ds, t)
        if tk not in SG_TABLES:
            continue
        tid = _u("t/" + tk)
        tk_to_ref[tk] = f"table:{tid}"
        tabs.append({"table_ref": f"table:{tid}", "table_id": tid, "source_id": f"bigquery:{proj['project_id']}", "schema_name": ds["dataset_id"], "table_name": t[0],
                     "row_count_estimate": None, "table_kind": "base_table", "selected": True, "comment": None})
        edges.append({"edge_type": "COVERS", "src_kind": "StoryGroup", "src_ref": f"story_group:{gid}", "dst_kind": "Table", "dst_ref": f"table:{tid}", "declared": True, "properties": {"kind": "describes"}, "group_id": gid})
        for c in t[5]:
            role = {"identifier": "identifier", "date": "time", "measure_record": "measure", "measure_commitment": "measure", "measure_projection": "measure", "derived_ratio": "measure", "measure": "measure"}.get(c[2], "attribute")
            cref = f"column:{tid}:{c[0]}"
            cols.append({"column_ref": cref, "table_ref": f"table:{tid}", "column_name": c[0], "ordinal_position": None,
                         "data_type": {"STRING": "string", "DATE": "date", "TIMESTAMP": "timestamp", "NUMERIC": "decimal", "INT64": "integer", "BOOLEAN": "boolean"}[c[1]],
                         "profile": {"distinct_count_in_sample": None, "null_ratio": None, "uniqueness_in_sample": None, "format_signature": None, "example_values": [], "value_domain": None, "is_sample_claim": True},
                         "description": c[3], "semantic_role": role, "concept_name": CONCEPT_OF[tk], "catalog_comment": None})
            edges.append({"edge_type": "HAS_COLUMN", "src_kind": "Table", "src_ref": f"table:{tid}", "dst_kind": "Column", "dst_ref": cref, "declared": True, "properties": {}, "group_id": None})
            if role in ("measure", "time") or c[2] in ("lifecycle_state",):
                edges.append({"edge_type": "REALISES", "src_kind": "Column", "src_ref": cref, "dst_kind": "Concept", "dst_ref": f"concept:global:{CONCEPT_OF[tk].lower()}", "declared": False,
                              "properties": {"role": role, "group_id": gid, "attribute": c[0], "phrase": c[3].split(".")[0].lower()}, "group_id": gid})
    concepts = [{"concept_ref": f"concept:global:{n.lower()}", "name": n, "description": CONCEPT_DESC[n], "declared": True, "group_id": None, "synonyms": []} for n in CONCEPT_OF.values()]
    concepts += [{"concept_ref": f"concept:{gid}:operator_exposure", "name": "Operator_Exposure", "description": None, "declared": False, "group_id": gid, "synonyms": []},
                 {"concept_ref": f"concept:{gid}:replacement_date", "name": "Replacement_Date", "description": None, "declared": False, "group_id": gid, "synonyms": []}]
    for (ft, fc, tt, tc, rt, card, why) in __import__("build_sources_catalog").DM_REL:
        if ft in tk_to_ref and tt in tk_to_ref:
            edges.append({"edge_type": "FK_TO", "src_kind": "Table", "src_ref": tk_to_ref[ft], "dst_kind": "Table", "dst_ref": tk_to_ref[tt], "declared": True,
                          "properties": {"rationale": why, "evidence_kind": "catalog_declared", "cardinality_hint": card, "manual_entity_id": _u("me/" + ft + tt), "relationship_type": rt, "type": rt, "confidence": 1},
                          "group_id": gid})
    story = ("Keolis Valmont operates the Réseau Valmo under contract DSP-VM-2021 for Valmont Métropole, which owns the network's assets. "
             f"The renewal portfolio holds {len(PORTFOLIO)} projects ({portfolio_totals()['funded']} funded) across bus and tram fleets, depots, track, power and systems. "
             "A project is keyed by project_code (P-VM-nnn); a need that has no project yet is keyed N-VM-nnn and lives in intervention_need. "
             "Budget lines are kept per approved version; forecasts are snapshots with remaining committed, uncommitted and separately held contingency. "
             "Purchase-order lines are commitments, and the supplier's promised date can lag correspondence. Funding claims move through five states — potential, submitted, accepted, disputed, paid — and are never summed as cash. "
             "Assets have a canonical asset_id that survives fleet-number reissue. Responsibility is a dated assignment per asset scope and role taken from the contract and its amendments, never inferred from ownership. "
             "An open work order does not mean a vehicle is unavailable; availability comes from availability intervals.")
    story_group = {"story_group_id": gid, "story": story,
                   "grain": {v: T_GRAIN for v, T_GRAIN in [(CONCEPT_OF[k], next(t[3] for p_, d_, t in T.iter_tables() if T.table_key(d_, t) == k)) for k in SG_TABLES]},
                   "uncertainties": ["responsibility_assignment.asset_scope holds ranges ('BUS-201..BUS-208') as well as single ids; the join to assets needs range expansion.",
                                     "forecast_snapshot carries a Working and a Board scenario; which one is 'the forecast' is declared as Working.",
                                     "acceptance_item.result 'Waived' has no rows in this extract; its meaning for completeness is not declared.",
                                     "schedule_task.predecessor mixes task ids and external references (ACC-…, PO lines).",
                                     "funding_claim.project_code carries need codes for potential recoveries.",
                                     "failure_event.failure_mode is null on 31.6% of rows — cause not yet confirmed."],
                   "edited_by_user": False}
    # document lane
    ENT_TYPES = ["ORGANIZATION", "CONTRACT", "AMENDMENT", "CLAUSE", "CAPITAL_PROJECT", "ASSET", "PERSON", "MONETARY_AMOUNT", "DATE", "PURCHASE_ORDER",
                 "CHANGE_REQUEST", "INSPECTION", "ACCESS_WINDOW", "CONDITION", "LOCATION"]
    CLASSES = ["contract_responsibility_terms", "amendment_history", "asset_condition_evidence", "business_case_and_options", "supplier_commitments",
               "schedule_and_access", "acceptance_and_commissioning", "funding_and_claims", "change_requests_and_scope", "meeting_decisions_and_expectations",
               "lessons_learned", "cost_and_estimates", "warranty_terms", "service_impact"]
    CLASS_OF = {"contract": ["contract_responsibility_terms"], "amendment": ["amendment_history", "contract_responsibility_terms"], "inspection_report": ["asset_condition_evidence"],
                "engineering_assessment": ["asset_condition_evidence"], "business_case": ["business_case_and_options", "cost_and_estimates"], "option_study": ["business_case_and_options"],
                "supplier_submission": ["supplier_commitments", "schedule_and_access"], "supplier_quote": ["cost_and_estimates"], "method_statement": ["supplier_commitments", "schedule_and_access"],
                "access_request": ["schedule_and_access", "service_impact"], "drawing_revision": ["change_requests_and_scope"], "commissioning_pack": ["acceptance_and_commissioning"],
                "change_notice": ["change_requests_and_scope", "cost_and_estimates"], "meeting_minutes": ["meeting_decisions_and_expectations", "funding_and_claims"],
                "lessons_learned": ["lessons_learned"], "progress_report": ["schedule_and_access"], "correspondence": ["supplier_commitments", "funding_and_claims"]}
    stats = json.load(open(os.path.join(os.path.dirname(__file__), "corpus_stats.json")))
    pdfs = [d for d in C.DOCS if d["mime_type"] == "application/pdf"]
    docs = [{"document_id": uuid5("doc/" + d["document_id"]), "filename": d["name"], "mime_type": "application/pdf", "page_count": stats["docs"][d["document_id"]]["pages"],
             "content_hash": hashlib.sha256(stats["docs"][d["document_id"]]["text"].encode()).hexdigest(), "created_at": f"2026-09-23T09:{10 + i:02d}:{(i * 7) % 60:02d}.{120000 + i * 991}+00:00"}
            for i, d in enumerate(pdfs)]
    pats = [("ASSET", r"\b(?:BUS|TRAM|SST|SIG|TRK|LIFT)-[A-Z0-9\-]+\d\b"), ("CAPITAL_PROJECT", r"\bP-VM-\d{3}\b"), ("CONTRACT", r"\b(?:DSP-VM-2021(?:-AV\d)?|VM-2025-BUS-02|TRS-2024-OVH-01|VTC-2026-014|CES-2025-114)\b"),
            ("PURCHASE_ORDER", r"\bPO-\d{10}(?:/\d+)?\b"), ("CHANGE_REQUEST", r"\bRC-\d{3}-\d{3}\b"), ("INSPECTION", r"\bIR-T1-\d{4}-\d{2}\b"), ("ACCESS_WINDOW", r"\bACC-T1-\d{4}-\d{3}\b"),
            ("MONETARY_AMOUNT", r"€[\d,\.]+(?:\s?[MHk]T?)?"), ("DATE", r"\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b"),
            ("CLAUSE", r"\bArt(?:icle|\.) \d+(?:\.\d+)*\b")]
    orgs = [AUTHORITY, LEGAL_ENTITY, OVERHAUL_PARTNER, "Arvéa Mobility", "Levantis Équipements", "Voies & Travaux du Centre", "Celtia Energy Systems", "Moteurs Service Ouest",
            "Électro-Réseaux Ouest", "Signalis Systèmes", "Réseau Électrique Ouest", "Contrôle Équipements Ouest", "Bureau métropolitain"]
    persons = [v for v in OWNERS.values()] + ["O. Mercier", "N. Brun", "C. Moreau", "A. Roussel", "H. Lambert", "I. Benali", "S. Pelletier", "K. Haddad"]
    places = ["Gare Centrale", "Pont Neuf", "Technopole", "Les Aubiers", "Saint-Roch", "La Varenne", "Les Rives"]
    ents, mentions, per_doc = {}, {}, {}
    for d in pdfs:
        txt = stats["docs"][d["document_id"]]["text"]
        found = []
        for et, rx in pats:
            for mt in re.findall(rx, txt):
                found.append((et, mt.strip()))
        for o in orgs:
            if o.lower() in txt.lower(): found += [("ORGANIZATION", o)] * max(1, txt.lower().count(o.lower()))
        for pn in persons:
            if pn in txt: found += [("PERSON", pn)] * txt.count(pn)
        for pl in places:
            if pl in txt: found += [("LOCATION", pl)] * txt.count(pl)
        for (ent, etype, node_, norm, meth, page, conf) in d["extractions"]:
            if etype in ("Condition", "OpenCondition", "MaintenanceDefault"):
                found.append(("CONDITION", ent))
        per_doc[d["document_id"]] = found
        for et, nm in found:
            k = (et, nm)
            mentions[k] = mentions.get(k, 0) + 1
    for (et, nm), cnt in mentions.items():
        ents[(et, nm)] = {"entity_id": _u(f"ent/{et}/{nm}"), "canonical_name": nm, "entity_type": et, "aliases": [], "mention_count": cnt, "kind": "resolved"}
    for k, al in (((("ORGANIZATION", "Arvéa Mobility")), ["ARVEA MOBILITY SAS", "Arvéa"]), ((("ORGANIZATION", AUTHORITY)), ["VALMONT MÉTROPOLE", "the Authority"]),
                  ((("ORGANIZATION", LEGAL_ENTITY)), ["the Operator", "KEOLIS VALMONT SAS"]), ((("CONTRACT", "DSP-VM-2021")), ["the contract", "DSP"])):
        if k in ents: ents[k]["aliases"] = al
    REL = {("CAPITAL_PROJECT", "ASSET"): "renews", ("CONTRACT", "ORGANIZATION"): "is_party_to", ("CLAUSE", "CONTRACT"): "part_of", ("AMENDMENT", "CONTRACT"): "amends",
           ("MONETARY_AMOUNT", "CAPITAL_PROJECT"): "budgeted_under", ("PERSON", "ORGANIZATION"): "employee_of", ("PURCHASE_ORDER", "ORGANIZATION"): "is_awarded_to",
           ("CHANGE_REQUEST", "CAPITAL_PROJECT"): "requests_change_to", ("INSPECTION", "ASSET"): "assesses", ("ACCESS_WINDOW", "ASSET"): "grants_access_to",
           ("CONDITION", "CLAUSE"): "conditions", ("DATE", "CONTRACT"): "effective_on", ("LOCATION", "ASSET"): "locates", ("MONETARY_AMOUNT", "CHANGE_REQUEST"): "prices",
           ("CAPITAL_PROJECT", "CAPITAL_PROJECT"): "depends_on", ("ORGANIZATION", "CAPITAL_PROJECT"): "delivers",
           ("ASSET", "CONTRACT"): "listed_in", ("ASSET", "ORGANIZATION"): "owned_by", ("CAPITAL_PROJECT", "CONTRACT"): "governed_by", ("PERSON", "CAPITAL_PROJECT"): "manages",
           ("CONDITION", "CONTRACT"): "conditions", ("LOCATION", "CAPITAL_PROJECT"): "located_at", ("MONETARY_AMOUNT", "CONTRACT"): "valued_at", ("MONETARY_AMOUNT", "PURCHASE_ORDER"): "valued_at",
           ("DATE", "PURCHASE_ORDER"): "due_on", ("DATE", "ACCESS_WINDOW"): "scheduled_on", ("INSPECTION", "LOCATION"): "located_at", ("CLAUSE", "AMENDMENT"): "restated_by",
           ("ASSET", "INSPECTION"): "assessed_in", ("ASSET", "CHANGE_REQUEST"): "affected_by", ("PERSON", "CONTRACT"): "signatory_of", ("DATE", "AMENDMENT"): "effective_on"}
    rels = []
    seen_rel = set()
    for d in pdfs:
        uniq = list(dict.fromkeys(per_doc[d["document_id"]]))
        cls = CLASS_OF.get(d["doc_type"], [])
        anchors = [e for e in uniq if e[0] in ("CAPITAL_PROJECT", "CONTRACT", "AMENDMENT", "INSPECTION")][:2]
        for i, a in enumerate(uniq):
            for b in anchors:
                if a == b:
                    continue
                rt = REL.get((a[0], b[0]))
                if rt and (a, b, rt) not in seen_rel:
                    seen_rel.add((a, b, rt))
                    rels.append({"confidence": None, "relation_id": _u(f"rel/{d['document_id']}/{a}/{b}/anchor"), "subject_entity_id": ents[a]["entity_id"], "object_entity_id": ents[b]["entity_id"],
                                 "relation_type": rt, "chunk_id": _u(f"chunk/{d['document_id']}/{i // 4}"), "document_id": uuid5("doc/" + d["document_id"]), "classes": cls[:2]})
        for i, a in enumerate(uniq):
            for b in uniq[i + 1:i + 7]:
                rt = REL.get((a[0], b[0])) or REL.get((b[0], a[0]))
                if not rt or a == b:
                    continue
                s, o = (a, b) if (a[0], b[0]) in REL else (b, a)
                if (s, o, rt) in seen_rel:
                    continue
                seen_rel.add((s, o, rt))
                rels.append({"confidence": None, "relation_id": _u(f"rel/{d['document_id']}/{s}/{o}"), "subject_entity_id": ents[s]["entity_id"], "object_entity_id": ents[o]["entity_id"],
                             "relation_type": rt, "chunk_id": _u(f"chunk/{d['document_id']}/{i // 4}"), "document_id": uuid5("doc/" + d["document_id"]), "classes": cls[:2]})
    documents = {"entity_types": ENT_TYPES, "classes": CLASSES, "documents": docs, "entities": sorted(ents.values(), key=lambda e: -e["mention_count"]), "relations": rels}
    # bridge
    bid = _u("bridge")
    links, counts = [], {"identity": 0, "attribute": 0, "reject": 0, "low": 0}
    BR = [("CAPITAL_PROJECT", "Projects", "identity", "high", "Documents name projects by the same P-VM code the project table is keyed on."),
          ("ASSET", "Assets", "identity", "high", "Asset references in documents use canonical asset_ids (BUS-204, TRK-T1-S07)."),
          ("PURCHASE_ORDER", "Commitments", "identity", "high", "PO numbers in documents match po_line keys."),
          ("CONTRACT", "Responsibilities", "attribute", "high", "Contracts carry the clauses responsibility assignments cite; a contract is not itself a responsibility row."),
          ("CLAUSE", "Responsibilities", "attribute", "high", "clause_ref on the assignment points at the clause."),
          ("AMENDMENT", "Responsibilities", "attribute", "high", "Amendments change assignment periods (AV3 for BUS-209–216)."),
          ("MONETARY_AMOUNT", "Budget_Lines", "attribute", "low", "Amounts in documents may be budgets, quotes or claims — only the basis tells which."),
          ("MONETARY_AMOUNT", "Forecasts", "reject", "low", "A quoted amount is not a forecast snapshot."),
          ("CHANGE_REQUEST", "Projects", "attribute", "high", "Change requests belong to a project; the request is not an approval."),
          ("INSPECTION", "Assets", "attribute", "high", "Inspections assess an asset."),
          ("INSPECTION", "Failures", "reject", "high", "An inspection finding is not a failure event."),
          ("ACCESS_WINDOW", "Schedule_Tasks", "attribute", "high", "Access requests are predecessors of possession tasks."),
          ("CONDITION", "Responsibilities", "attribute", "high", "Conditions qualify an assignment (notice, cap, exclusion)."),
          ("ORGANIZATION", "Responsibilities", "attribute", "high", "Organisations are parties to assignments."),
          ("ORGANIZATION", "Commitments", "attribute", "low", "Suppliers named in documents may match po_line.supplier_id via the supplier register."),
          ("PERSON", "Projects", "attribute", "low", "People are named as project managers; personal data, masked for analysts."),
          ("DATE", "Schedule_Tasks", "reject", "low", "A date in a document is not a schedule date unless the project office records it."),
          ("DATE", "Responsibilities", "attribute", "high", "Effective and received dates of amendments bound assignment periods."),
          ("LOCATION", "Assets", "attribute", "low", "Stations and depots locate assets; no GIS to confirm geometry."),
          ("CAPITAL_PROJECT", "Funding_Claims", "attribute", "high", "Claims are lined per project."),
          ("CAPITAL_PROJECT", "Acceptance_Items", "attribute", "high", "Acceptance items belong to a project."),
          ("ASSET", "Failures", "attribute", "high", "Failures are about an asset."),
          ("ASSET", "Acceptance_Items", "attribute", "high", "Acceptance items name the asset accepted."),
          ("PERSON", "Responsibilities", "reject", "high", "A person is not a responsible party; the organisation is."),
          ("CHANGE_REQUEST", "Budget_Lines", "reject", "high", "A requested cost impact is not an approved budget line.")]
    have = {(b[0], b[1]) for b in BR}
    for et in ENT_TYPES:
        for cn in CONCEPT_OF.values():
            if (et, cn) not in have:
                BR.append((et, cn, "reject", "high", f"No type-level link: a {et.lower().replace('_', ' ')} mentioned in a document is not a row of {cn.replace('_', ' ').lower()}."))
    for i, (et, cn, dec, conf, why) in enumerate(BR):
        counts[dec] += 1
        if conf == "low": counts["low"] += 1
        links.append({"type_link_id": _u(f"tl/{i}"), "bridge_build_id": bid, "entity_type": et, "concept_ref": f"concept:global:{cn.lower()}", "concept_name": cn,
                      "concept_declared": True, "decision": dec, "confidence": conf, "reason": why, "decided_by": "llm", "original_decision": None, "original_confidence": None,
                      "original_reason": None, "decided_by_user_id": None, "decided_at": None, "created_at": f"2026-09-23T10:{i % 60:02d}:14.221000+00:00", "updated_at": f"2026-09-23T10:{i % 60:02d}:48.901000+00:00"})
    counts["all"] = len(links); counts["needs_review"] = len(links)
    return {"_source": {"file": "docs/samples/keolis_valmont_usecase_graph.json", "generated_at": "2026-09-23T10:31:04.000000+00:00", "from": "Keolis Valmont demo package (generated to the as-built graph-version shape)",
                        "use_case_config_id": _u("ucc"), "graph_version_id": _u("gv"), "sgb_build_id": _u("sgb"), "dgb_graph_version": 1, "bridge_build_id": bid},
            "structured": {"tables": tabs, "columns": cols, "concepts": concepts, "edges": edges, "story_group": story_group},
            "documents": documents, "bridge": {"bridge_build_id": bid, "type_links": links, "counts": counts}}

def build():
    personas, hq, metrics, formats, qid = pools()
    nodes, edges = G.build()
    return {"graph_domains": DOMAINS, "graph_personas": personas, "graph_metrics": metrics, "graph_hero_questions": hq, "graph_answer_formats": formats,
            "graph_use_cases": [use_case(personas, metrics)], "graph_use_case_templates": template(personas, metrics, hq),
            "graph_studio": graph_studio(nodes, edges), "studio_graph": studio_graph()}

if __name__ == "__main__":
    b = build()
    sg = b["studio_graph"]
    print({k: len(v) for k, v in b.items()}, "sg:", len(sg["structured"]["tables"]), len(sg["structured"]["columns"]), len(sg["structured"]["edges"]),
          len(sg["documents"]["entities"]), len(sg["documents"]["relations"]), len(sg["bridge"]["type_links"]))
