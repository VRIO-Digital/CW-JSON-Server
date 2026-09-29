"""Upload files: Data Catalog dictionaries (CSV) and the New Graph wizard brief documents (DOCX),
plus the proposed `document_readings` key that lets the wizard quote these documents instead of its
built-in generic pool. Also writes a reference DDL for the whole warehouse."""
import csv, json, os, subprocess, sys, tempfile
from world import *
import tables as T
import build_graph as BG

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/keolis/out"
HERE = os.path.dirname(os.path.abspath(__file__))
FOOT = "Keolis Valmont — hypothetical demonstration document for ContextWeave · 24 September 2026"

def dictionaries():
    d = os.path.join(OUT, "uploads", "01_data_catalog")
    os.makedirs(d, exist_ok=True)
    written = []
    for proj, ds in ((p, ds) for p in T.PROJECTS for ds in p["datasets"] if ds["declared"]):
        path = os.path.join(d, ds["dictionary"])
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["table", "column", "data_type", "semantic_class", "description", "pii", "table_grain"])
            for (tid, label, typ, grain, rows, cols) in ds["tables"]:
                for c in cols:
                    w.writerow([tid, c[0], c[1], c[2], c[3], "yes" if c[4] else "no", grain])
        written.append((ds["dataset_id"], ds["dictionary"], sum(len(t[5]) for t in ds["tables"]), len(ds["tables"])))
    # reference DDL (not an upload for the profiled datasets)
    ref = os.path.join(OUT, "reference")
    os.makedirs(ref, exist_ok=True)
    tm = {"STRING": "STRING", "DATE": "DATE", "TIMESTAMP": "TIMESTAMP", "NUMERIC": "NUMERIC", "INT64": "INT64", "BOOLEAN": "BOOL"}
    with open(os.path.join(ref, "keolis-valmont-warehouse.ddl.sql"), "w", encoding="utf-8") as fh:
        fh.write("-- Keolis Valmont warehouse — reference DDL for the demo (BigQuery dialect). Hypothetical.\n-- Do NOT upload this on the profiled datasets (eam, telemetry, fin, proc): see README §Data Catalog.\n\n")
        for proj, ds, t in T.iter_tables():
            fh.write(f"-- {t[1]} · grain: {t[3]} · rows: {t[4]:,}\nCREATE TABLE `{proj['project_id']}.{ds['dataset_id']}.{t[0]}` (\n")
            fh.write(",\n".join(f"  `{c[0]}` {tm[c[1]]} OPTIONS(description=\"{c[3].replace(chr(34), chr(39))}\")" for c in t[5]))
            fh.write("\n);\n\n")
    return written

# ------------------------------------------------------------------ wizard documents
METRIC_DOC = [
    # name, purpose, description, usedFor, note, query, question, priority
    ("Forecast Total Project Cost", "is the headline figure of the monthly investment review and the number the authority's quarterly PPI review is judged against",
     "Posted actuals plus valid uninvoiced accruals plus the forecast cost to complete, per project, EUR HT.", "the monthly investment review and the quarterly PPI review.",
     "Accruals are reversed when the invoice arrives; the cost to complete excludes anything already accrued, so nothing is counted twice.",
     "SELECT p.project_code,\n       SUM(t.amount_eur) + COALESCE(a.accrued, 0) + f.ctc_committed_eur + f.ctc_uncommitted_eur + f.contingency_eur AS forecast_total_eur\nFROM `ppm`.`project` p\nJOIN `fin`.`cost_transaction` t ON t.project_code = p.project_code\nLEFT JOIN (SELECT project_code, SUM(amount_eur) AS accrued FROM `fin`.`accrual_line` WHERE matched_invoice IS NULL GROUP BY 1) a ON a.project_code = p.project_code\nJOIN `fin`.`forecast_snapshot` f ON f.project_code = p.project_code AND f.scenario = 'Working'\nGROUP BY p.project_code, a.accrued, f.ctc_committed_eur, f.ctc_uncommitted_eur, f.contingency_eur;",
     "Which renewal projects are forecasting above their approved budget, and by how much?", "high"),
    ("Operator Exposure", "is what the Directrice générale reports to Keolis France — the part of the renewal programme Keolis Valmont itself bears",
     "Costs borne by Keolis Valmont under validated allocations: GER projects in the contract price plus its share of co-funded projects; unresolved exposure shown as a separate scenario.",
     "the Keolis France investment committee.", "Never equal to project cost: an authority-funded renewal is not operator exposure, and a disputed recovery is not counted as certain.",
     "SELECT p.project_code, b.funding_source, SUM(b.amount_eur) AS approved_eur\nFROM `ppm`.`project` p\nJOIN `fin`.`budget_line` b ON b.project_code = p.project_code\nWHERE b.funding_source IN ('GER')\nGROUP BY 1, 2;",
     "What is Keolis Valmont's own exposure on the renewal portfolio, separate from the authority's?", "high"),
    ("Service Availability Margin", "is checked before any vehicle withdrawal or track closure is approved",
     "Eligible available vehicles minus the peak requirement minus the agreed reserve, by vehicle class and day type.", "service planning and the weekly readiness call.",
     "Each unavailable vehicle is subtracted once, from its availability interval — an open work order alone does not make a vehicle unavailable.",
     "SELECT r.vehicle_class, r.day_type, r.peak_required, r.reserve_required\nFROM `ops`.`service_requirement` r\nWHERE r.timetable_version = 'HIV-2026';",
     "Do we have enough vehicles for peak service while assets are withdrawn for renewal?", "high"),
    ("Schedule Variance", "is the first thing the weekly project review looks at",
     "Current forecast milestone date minus the approved baseline milestone date, in working days.", "the weekly project review.",
     "An approved re-baseline is shown as such; a supplier's new date in an email is not a schedule change until the project office records it.",
     "SELECT s.project_code, s.task_name, s.baseline_finish, s.current_finish,\n       DATE_DIFF(s.current_finish, s.baseline_finish, DAY) AS variance_days\nFROM `ppm`.`schedule_task` s\nWHERE s.current_finish > s.baseline_finish;",
     "Which milestones have slipped against their approved baseline?", "normal"),
    ("Documented Acceptance Completeness", "decides whether a campaign can be reported as complete to the authority",
     "Verified required acceptance items divided by applicable required items, per project.", "handover and the PPI claim evidence pack.",
     "Completeness is not permission to operate; release for duty is issued separately by operations.",
     "SELECT a.project_code, COUNTIF(a.result = 'Passed') / COUNT(*) AS completeness\nFROM `ppm`.`acceptance_item` a\nGROUP BY a.project_code;",
     "Which campaigns are installed but not yet accepted?", "normal"),
    ("Renewal Backlog", "is presented to the authority at each quarterly PPI review",
     "Validated intervention needs not yet completed, by status: unfunded, option study, deferred, approved.", "the quarterly PPI review and the annual renewal programme.",
     "Overlapping options for the same need are counted once; safety and mandatory needs are flagged and cannot be traded away by a score.",
     "SELECT n.status, COUNT(*) AS needs, SUM(n.estimate_eur) AS estimate_eur\nFROM `ppm`.`intervention_need` n\nWHERE n.status <> 'Approved'\nGROUP BY n.status;",
     "Which assets must be renewed, and which needs are still unfunded?", "normal"),
    ("Approved Funding Gap", "is escalated to the authority when it exceeds €250,000 on a project",
     "Forecast fundable expenditure minus applicable approved funding, per PPI project.", "the quarterly PPI review.",
     "Scope, caps and co-funding rules apply; costs the convention does not cover are labelled separately rather than netted.",
     "SELECT f.project_code, SUM(f.ctc_committed_eur + f.ctc_uncommitted_eur) AS remaining_eur\nFROM `fin`.`forecast_snapshot` f\nWHERE f.scenario = 'Working'\nGROUP BY 1;",
     "Where does the forecast exceed the funding the authority has approved?", "normal"),
    ("Failure Frequency", "is how the maintenance team argues for renewal ahead of the contractual replacement date",
     "Relevant heavy-component failures per 100,000 km, by vehicle series.", "the annual renewal programme.",
     "Months with a meter reset are excluded; the peer group is the same vehicle class.",
     "SELECT a.model, COUNT(f.failure_id) / (SUM(u.distance_km) / 100000) AS failures_per_100k_km\nFROM `eam`.`failure_event` f\nJOIN `eam`.`asset_register` a ON a.asset_id = f.asset_id\nJOIN `eam`.`usage_monthly` u ON u.asset_id = f.asset_id AND u.meter_reset_flag = FALSE\nGROUP BY a.model;",
     "Which vehicle series fail most often, per kilometre run?", "normal"),
    ("Open Commitment", "is reconciled with procurement at every month-end close",
     "Ordered value less received and cancelled value, per PO line, at the line's valuation basis.", "the month-end close.",
     "Unpaid invoices are not future work; a supplier's revised promise does not change the commitment.",
     "SELECT l.project_code, SUM(l.ordered_eur - l.received_eur - l.cancelled_eur) AS open_commitment_eur\nFROM `proc`.`po_line` l\nGROUP BY 1;",
     "How much is committed on each project but not yet received?", "normal"),
]
CONTEXT = {
    "Keolis_Valmont_BRD_Fleet_Infrastructure_Renewal_v1.docx": "Renewal projects are keyed by project code (P-VM-nnn); a need without a project is keyed N-VM-nnn.",
    "Keolis_Valmont_User_Stories_Renewal_Decisions_v1.docx": "Every answer states its perspective — operator or authority — before its figures.",
    "Keolis_Valmont_Metrics_Definitions_v1.docx": "Money is EUR, excluding VAT (HT), at the posting date; forecast rounds are R1 (April), R2 (July), R3 (October).",
}
DOC_METRICS = {
    "Keolis_Valmont_BRD_Fleet_Infrastructure_Renewal_v1.docx": ["Forecast Total Project Cost", "Operator Exposure", "Service Availability Margin"],
    "Keolis_Valmont_User_Stories_Renewal_Decisions_v1.docx": ["Documented Acceptance Completeness", "Schedule Variance", "Renewal Backlog"],
    "Keolis_Valmont_Metrics_Definitions_v1.docx": ["Approved Funding Gap", "Failure Frequency", "Open Commitment"],
}

def document_readings():
    byname = {m[0]: m for m in METRIC_DOC}
    files = {}
    for fname, names in DOC_METRICS.items():
        files[fname] = {"context": CONTEXT[fname], "definitions": [dict(zip(("name", "purpose", "description", "usedFor", "note", "query", "question", "priority"), byname[n])) for n in names]}
    return {"_status": "PROPOSED KEY — not read by the current frontend. src/data/documentReadings.ts builds the wizard's 'What we read from your documents' panel and the step-4 'Found in your documents' metrics from a built-in pool picked by a hash of the filename. To show Keolis content, the team would read this key (by uploaded filename) and fall back to the built-in pool for any other file.",
            "shape": "Mirrors MetricDefinition in documentReadings.ts: name, purpose, description, usedFor, note, query, question, priority; plus one context line per file.",
            "files": files}

def brd_spec():
    return {"title": "Business Requirements — Fleet & Infrastructure Renewal Decisions", "subtitle": "Keolis Valmont · operating contract DSP-VM-2021 · version 1.0 · 18 September 2026 · owner: Claire Moreau (Directrice générale)", "footer": FOOT,
      "blocks": [
        {"h1": "1. Purpose"},
        {"p": "Keolis Valmont needs one place to decide which renewal projects need intervention, what their full financial exposure is, and whether approved work is ready to proceed without undermining service. Today those answers take a week of spreadsheet reconciliation across the EAM, the ERP, the project office's register, the contract folder and correspondence."},
        {"p": "ContextWeave is the evidence-backed decision-support layer over these systems. The source applications keep control of work orders, ledger entries, contracts and approvals; ContextWeave connects their records, keeps their history, runs governed calculations and shows the evidence."},
        {"h1": "2. Decisions in scope"},
        {"table": {"header": ["Decision", "Who decides", "Records needed", "Evidence needed"], "widths": [2200, 1800, 2700, 2660], "rows": [
            ["Which projects need intervention this week", "Directrice générale, weekly review", "Schedule baseline vs current, PO promised dates, approvals", "Supplier correspondence, drawing revisions, meeting decisions"],
            ["What the full financial exposure is", "Investment controller", "Budget versions, ledger, accruals, forecasts, claims", "Contract clauses on who pays, amendments"],
            ["Whether approved work can start", "Project manager + service planning", "Access windows, parts, service requirement, availability", "Access requests, readiness reviews, method statements"],
            ["Who pays for a failure after the replacement date", "Commercial & contract manager", "Failure events, replacement dates, maintenance plan", "Article 34.4 as amended, notices, authority replies"],
            ["Whether a campaign is complete", "Maintenance lead", "Installations, acceptance items, releases for duty", "Commissioning pack, certificates, warranty terms"]]}},
        {"h1": "3. Users"},
        {"bullets": ["Operating company executive — portfolio exceptions and exposure.", "Investment controller — reconciled forecasts, variance and recovery states.", "Rolling stock maintenance lead — condition, failures, acceptance, backlog.",
                     "Infrastructure project manager — readiness, access, dependencies, scope changes.", "Commercial & contract manager — responsibility, amendments, notices, recovery.",
                     "Service planning lead — peak and reserve while assets are withdrawn.", "Authority liaison — what the authority sees; claimable versus potential."]},
        {"h1": "4. Requirements"},
        {"table": {"header": ["ID", "Requirement", "Failure it prevents"], "widths": [900, 4600, 3860], "rows": [
            ["BR-01", "Rank exceptions by the agreed rules (mandatory date, service consequence, cost growth, funding gap, supplier delay, unresolved approval) and keep each factor visible.", "An unexplained score nobody can challenge."],
            ["BR-02", "State the perspective — operator or authority — on every financial answer.", "Presenting authority-funded cost as Keolis exposure, or the reverse."],
            ["BR-03", "Keep potential, submitted, accepted, disputed and paid recovery as five separate states.", "Counting a disputed claim as cash."],
            ["BR-04", "Report installed, accepted and duty-eligible counts separately.", "Reporting a campaign complete before acceptance."],
            ["BR-05", "Treat supplier and authority messages as dated statements until the owning process records them.", "A schedule that silently follows an email."],
            ["BR-06", "Never promote an expectation, a draft or a conditional approval to an unconditional approval.", "Treating 'expected to be funded' as a budget."],
            ["BR-07", "Show the assessed population and what is excluded beside every portfolio figure.", "'The portfolio is within budget' while part of it has no forecast."],
            ["BR-08", "Keep effective time and knowledge time apart for contract versions and forecasts.", "Judging a past decision on information that arrived later."],
            ["BR-09", "Keep unallocated spend visible as its own category.", "A portfolio that looks healthier because unallocated lines were dropped."],
            ["BR-10", "Decline questions the data cannot support — prediction, optimisation, legal liability, cross-network benchmarks — and say what can be answered instead.", "Confident answers the data does not justify."]]}},
        {"h1": "5. Measures"},
        {"p": "The governed measures are defined in the metrics definitions document. Three are headline measures for this brief:"},
        *[{"p": f"**{m[0]}.** {m[2]} Used for {m[3]} {m[4]}"} for m in METRIC_DOC[:3]],
        {"h1": "6. Out of scope for this release"},
        {"bullets": ["Predictive failure models and remaining-useful-life estimates (needs censored history and out-of-time validation).", "Portfolio optimisation (needs resource calendars and an agreed objective).",
                     "Writeback to the EAM, ERP or PPM — any follow-up task is routed through the source workflow.", "Crew and driver availability (workforce planning is not connected).", "Cross-network comparison with other Keolis contracts."]},
        {"h1": "7. Acceptance"},
        {"table": {"header": ["Area", "Acceptance test"], "widths": [2200, 7160], "rows": [
            ["Financial accuracy", "Portfolio control totals reconcile to the M08 close; differences are explained and signed off by finance."],
            ["Traceability", "Every material figure in the agreed question set links to the record or document version it came from."],
            ["Authorisation", "No draft, expectation or conditional approval appears as an unconditional approval in the test set."],
            ["Access", "An infrastructure-scoped reader sees none of the fleet projects' rows, figures or citations."],
            ["Usefulness", "Weekly review preparation time compared with the recorded pre-pilot baseline (2 days)."]]}},
        {"note": "Hypothetical demonstration document. Keolis Valmont, Valmont Métropole, the contract and every figure are fictional."}]}

def stories_spec():
    S = [
        ("US-01", "Operating company executive", "see the renewal projects that need a decision this week, with the reason for each", "I can spend the weekly review on decisions rather than reconciliation",
         ["Each exception shows what changed, the contributing factors, the decision required and the accountable owner.", "No single composite score is shown.", "Statements from correspondence are marked as unconfirmed."]),
        ("US-02", "Investment controller", "see the forecast total of a project broken into actuals, accruals, committed, uncommitted and contingency", "I can defend the forecast line by line",
         ["The five components foot to the forecast total.", "Contingency is shown separately.", "Accruals already reversed by an invoice are not counted."]),
        ("US-03", "Commercial & contract manager", "know who pays for a heavy-component failure on a vehicle past its replacement date", "I can decide whether to raise a recovery review",
         ["The answer separates established facts from unresolved questions.", "Every amendment that could change the replacement date is checked and cited.", "The estimate is never shown as a posted cost or the recovery as cash."]),
        ("US-04", "Infrastructure project manager", "know whether a track renewal can start on its planned date", "I don't mobilise a contractor into a closure that isn't approved",
         ["Access, design, contractor method, replacement buses and funding are each shown as a gate.", "A contractor's readiness statement never counts as approved access."]),
        ("US-05", "Rolling stock maintenance lead", "see installed, accepted and duty-eligible counts for a campaign", "I never report a campaign complete before acceptance",
         ["Three counts, side by side.", "Each exception names the vehicle, the issue and the owner.", "Warranty start is tied to acceptance."]),
        ("US-06", "Service planning lead", "see the vehicle margin by day type while assets are withdrawn", "I can approve or refuse a closure with the numbers",
         ["Margin = eligible available − peak − reserve.", "Vehicles past their replacement date are identified in the count.", "Driver availability is marked as not tested."]),
        ("US-07", "Authority liaison", "see what is claimable this quarter and what is only potential", "the claim we send is one the authority can check line by line",
         ["Five recovery states, never summed.", "GER-funded work is excluded from PPI claims.", "Working copies of the claims tracker never supersede the register."]),
        ("US-08", "Operating company executive", "be told plainly when a question cannot be answered", "I don't act on a prediction the data cannot support",
         ["Declines give the reason and what can be answered instead.", "Legal liability is never assigned."]),
    ]
    blocks = [{"h1": "Scope"}, {"p": "User stories for the first release of ContextWeave on the Keolis Valmont renewal portfolio. Each story names the persona, the need, the value and the acceptance criteria a tester checks."}]
    for sid, who, want, why, ac in S:
        blocks += [{"h2": f"{sid} — {who}"}, {"p": f"As a **{who.lower()}**, I want to {want}, so that {why}."}, {"p": "**Acceptance criteria**"}, {"bullets": ac}]
    blocks += [{"h1": "Measures these stories rely on"}] + [{"p": f"**{m[0]}** — {m[2]} {m[4]}"} for m in METRIC_DOC[3:6]]
    blocks += [{"note": "Hypothetical demonstration document. Keolis Valmont, Valmont Métropole, the contract and every figure are fictional."}]
    return {"title": "User Stories — Renewal Decisions", "subtitle": "Keolis Valmont · ContextWeave pilot · version 1.0 · 19 September 2026 · owner: Amélie Roussel", "footer": FOOT, "blocks": blocks}

def metrics_spec():
    blocks = [{"p": "Every measure has a named owner, a business definition, a grain, inclusion rules, a date basis, a currency and a version. Money is EUR HT at the posting date. Forecast rounds are R1 (April), R2 (July) and R3 (October)."}]
    for i, m in enumerate(METRIC_DOC, 1):
        blocks += [{"h2": f"{i}. {m[0]}"}, {"p": f"{m[0]} {m[1]}."}, {"p": f"**Definition.** {m[2]}"}, {"p": f"**Used for.** {m[3][0].upper() + m[3][1:]}"}, {"p": f"**How it is calculated.** {m[4]}"},
                   {"p": f"**Answers.** “{m[6]}”"}, {"code": m[5]}]
    blocks += [{"note": "Hypothetical demonstration document. Keolis Valmont, Valmont Métropole, the contract and every figure are fictional."}]
    return {"title": "Metrics Definitions — Renewal Portfolio", "subtitle": "Keolis Valmont · governed measures v1.0 · 15 September 2026 · owner: Amélie Roussel (investment controller)", "footer": FOOT, "blocks": blocks}

def wizard_docs():
    d = os.path.join(OUT, "uploads", "02_new_graph_wizard")
    os.makedirs(d, exist_ok=True)
    out = []
    for fname, spec in (("Keolis_Valmont_BRD_Fleet_Infrastructure_Renewal_v1.docx", brd_spec()), ("Keolis_Valmont_User_Stories_Renewal_Decisions_v1.docx", stories_spec()),
                        ("Keolis_Valmont_Metrics_Definitions_v1.docx", metrics_spec())):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
            json.dump(spec, fh, ensure_ascii=False)
        subprocess.run(["node", os.path.join(HERE, "render_docx.js"), fh.name, os.path.join(d, fname)], check=True)
        out.append(fname)
    return out

if __name__ == "__main__":
    print(dictionaries()); print(wizard_docs())
