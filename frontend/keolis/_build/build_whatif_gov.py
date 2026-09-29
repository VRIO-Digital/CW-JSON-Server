"""What-if lens, Audit & Governance (audit, traces, evals, reports.governance), reports and reports_prototype."""
import math
from world import *
import answers as AN

USERS = [(p[2], p[3], p[5]) for p in PEOPLE if p[1] != "admin"]

# ------------------------------------------------------------------ what-if
BASE = {"mat": 14.4, "lab": 4.2, "sub": 11.1, "cont": 1.3, "res": 2.0}
ENVELOPE, APPROVED, RESERVE = 34.5, 31.2, 2.0
FC0 = round(sum(BASE.values()), 1)

def case(mat, lab, cont):
    b = dict(BASE); b["mat"] = round(BASE["mat"] * (1 + mat / 100), 2); b["lab"] = round(BASE["lab"] * (1 + lab / 100), 2); b["cont"] = cont
    fc = round(sum(b.values()), 1)
    return fc, b

def whatif():
    ex = []
    for name, v in (("Base case", (0, 0, 1.3)), ("Index +8%", (8, 0, 1.3)), ("Full reserve drawn", (0, 0, 2.0)), ("Index +15% and labour +20% — the authored ceiling", (15, 20, 1.3))):
        fc, b = case(*v)
        ex.append({"case": name, "vals": {"mat": v[0], "lab": v[1], "cont": v[2]}, "forecast_usd_m": fc, "vs_envelope_usd_m": round(fc - ENVELOPE, 1), "crosses_envelope": fc > ENVELOPE,
                   "slice_breakdown": {k: round(x, 1) for k, x in b.items()}})
    room = ENVELOPE - FC0
    hr = {"mat": {"room": math.floor(room / BASE["mat"] * 100), "avg": BASE["mat"], "carrying": 3, "appetite": ENVELOPE, "unit": "%"},
          "lab": {"room": math.floor(room / BASE["lab"] * 100), "avg": BASE["lab"], "carrying": 3, "appetite": ENVELOPE, "unit": "%"},
          "cont": {"room": round(min(room, RESERVE - BASE["cont"]), 1), "avg": BASE["cont"], "carrying": 3, "appetite": ENVELOPE, "unit": "€M"}}
    hr["mat"]["sentence"] = f"The overhaul price index can rise {hr['mat']['room']}% before the base case crosses the €{ENVELOPE}M envelope"
    hr["lab"]["sentence"] = f"Keolis labour rate can rise {hr['lab']['room']}% before the base case crosses the €{ENVELOPE}M envelope"
    hr["cont"]["sentence"] = f"Contingency can be drawn to its €{RESERVE}M reserve (+€{hr['cont']['room']}M) without the base case crossing the €{ENVELOPE}M envelope"
    banner = f"Tram TV-100 mid-life overhaul · Keolis Valmont / Valmont Métropole · 24 trams · base forecast €{FC0}M against a €{ENVELOPE}M PPI envelope"
    slices = [
        {"id": "mat", "label": "Index-linked overhaul price", "base_usd_m": BASE["mat"], "lever": True, "driver": "Overhaul price index", "unit": "%", "range": {"min": -5, "max": 15, "default": 0},
         "source_code": "IDX", "source_name": "Transalp clause 9 price index (steel and labour sub-indices)", "trace": f"{BASE['mat']} of the {FC0} is priced per tram against the clause 9 index; moving the index moves this slice by exact proportion."},
        {"id": "lab", "label": "Keolis release, acceptance and depot support labour", "base_usd_m": BASE["lab"], "lever": True, "driver": "Labour rate", "unit": "%", "range": {"min": -5, "max": 20, "default": 0},
         "source_code": "ERP", "source_name": "Keolis timesheets + internal rate card", "trace": f"{BASE['lab']} of the {FC0} is hours × rate from timesheets and the planned release programme."},
        {"id": "sub", "label": "Fixed-price overhaul lots", "base_usd_m": BASE["sub"], "lever": False, "driver": None, "unit": None, "range": None,
         "source_code": "CTR", "source_name": "Fixed-price lots, TRS-2024-OVH-01", "trace": f"{BASE['sub']} is under fixed-price lots already ordered or delivered — it cannot move, so no lever is exposed."},
        {"id": "cont", "label": "Contingency drawn", "base_usd_m": BASE["cont"], "lever": True, "driver": "Contingency draw", "unit": "€M", "range": {"min": 0, "max": RESERVE, "default": BASE["cont"]},
         "source_code": "DEF", "source_name": f"Contingency register — €{RESERVE}M authorized", "trace": f"{BASE['cont']} of the €{RESERVE}M authorized contingency is drawn; a case can draw up to the reserve."},
        {"id": "res", "label": "Residual — unattributed", "base_usd_m": BASE["res"], "lever": False, "driver": None, "unit": None, "range": None,
         "source_code": "DEF", "source_name": "Not decomposable from the current graph", "trace": f"{BASE['res']} of the {FC0} cannot be tied to a single driver — including the frame allowance whose change request is not approved."},
    ]
    dir_ = []
    for name, email, role in USERS:
        if role == "Domain Architect" or "Executive" in role:
            acc = {"kind": "full", "masked_measures": [], "row_scope": "portfolio-wide", "label": "Unrestricted — all 38 project rows, no field masks"}
            pv = {"pill": "full", "headline": "Sees the full scenario", "detail": acc["label"]}
        elif role == "Data Analyst":
            acc = {"kind": "rules", "masked_measures": [], "row_scope": "portfolio-wide", "label": "Portfolio-wide; supplier contacts and technician notes masked — neither is a watched measure"}
            pv = {"pill": "full", "headline": "Sees all 4 measures", "detail": acc["label"]}
        else:
            acc = {"kind": "rules", "masked_measures": ["committed", "variance"], "row_scope": "infrastructure projects only — 11 of the 38 rows", "label": "Scoped to infrastructure; supplier commitments and variance masked"}
            pv = {"pill": "zero", "headline": "Does not see this scenario's rows", "detail": "The TV-100 overhaul is a fleet project, outside the infrastructure scope — the scenario opens empty for this reader."}
        dir_.append({"email": email, "name": name, "role": role, "access": acc, "preview_against_seed_scenario": pv})
    return {
        "copy": {"page_title": "What-if", "banner": banner, "subtitle": "Move only what the graph can attribute. The locked and residual slices never move.",
                 "overlay_pill": "◈ read-only overlay · never writes back", "tabs": [{"key": "author", "label": "Authoring"}, {"key": "runtime", "label": "Runtime"}],
                 "data_note": "Generated from the Keolis Valmont demo package (_build/build_whatif_gov.py). Figures are hypothetical and decompose P-VM-005's forecast total."},
        "state_defaults": {"tab": "author", "step": 1, "count": 2, "watch": {"forecast": True, "contingency": True, "variance": False, "committed": False}, "pool": "all"},
        "facility": {"id": "PRJ:P-VM-005", "name": "Tram TV-100 mid-life overhaul", "role": "Valmont Métropole PPI · Transalp Rail Services overhaul · Keolis Valmont release & acceptance",
                     "baseline": {"forecast": FC0, "contingency": BASE["cont"], "months": 50}, "appetite": {"forecast": ENVELOPE, "approved": APPROVED}},
        "transporters": [], "generators": [], "candidate_pools": [],
        "_not_applicable": {"transporters": "The renewal lens has no carrier dimension; the lever axis is the cost decomposition.",
                            "generators": "The overhaul exposes continuous levers, not a pool of swappable candidates.", "candidate_pools": "Same reason. The equivalents are `slices` and `levers` below."},
        "watched_measures": [
            {"key": "forecast", "label": "Forecast total project cost", "source": "ERP", "field": "forecast", "format": "currency_m", "unit": "€M", "inherited": True, "baseline_field": "at_base",
             "appetite_field": "limit_usd_m", "breach": ENVELOPE, "grounds": "Σ attributable slices, judged vs the PPI envelope", "at_base": FC0, "judgement_at_base": f"€{round(ENVELOPE - FC0, 1)}M under the €{ENVELOPE}M envelope", "watched_by_default": True},
            {"key": "contingency", "label": "Contingency drawn", "source": "CTR", "field": "contingency", "format": "currency_m", "unit": "€M", "inherited": True, "baseline_field": "at_base",
             "appetite_field": "limit_usd_m", "breach": RESERVE, "grounds": f"Contingency register — €{RESERVE}M authorized", "at_base": BASE["cont"], "judgement_at_base": f"€{round(RESERVE - BASE['cont'], 1)}M of the €{RESERVE}M reserve still undrawn", "watched_by_default": True},
            {"key": "variance", "label": "Variance to approved budget", "source": "ERP", "field": "variance", "format": "currency_m", "unit": "€M", "inherited": True, "baseline_field": "at_base",
             "appetite_field": "limit_usd_m", "breach": None, "grounds": f"Forecast − approved €{APPROVED}M", "at_base": round(FC0 - APPROVED, 1), "judgement_at_base": f"€{round(FC0 - APPROVED, 1)}M over the €{APPROVED}M approved budget", "watched_by_default": False},
            {"key": "committed", "label": "Committed cost (signed)", "source": "CTR", "field": "committed", "format": "currency_m", "unit": "€M", "inherited": True, "baseline_field": "at_base",
             "appetite_field": "limit_usd_m", "breach": None, "grounds": "Open PO value on TRS-2024-OVH-01 and committed labour", "at_base": 14.9, "judgement_at_base": f"€14.9M contractually committed of the €{ENVELOPE}M envelope", "watched_by_default": False}],
        "formats": {"integer": {"template": "{v}", "desc": "whole number, printed as-is"}, "currency_k": {"template": "€{v/1000}k", "desc": "EUR divided by 1000, suffixed k"},
                    "currency_m": {"template": "€{v}M", "desc": "EUR millions, one decimal"}, "percent": {"template": "{v}%", "desc": "percent change against the base case"},
                    "boolean_yesno": {"template": "{v?yes:no}", "desc": "1/true -> 'yes', 0/false -> 'no'"}},
        "resolvable": [
            {"keywords": ["forecast", "outturn", "total", "cost", "etc", "eac"], "resolves_to": "forecast", "note": "grounds to the summed slice decomposition", "verdict": "resolved"},
            {"keywords": ["contingency", "reserve", "drawdown"], "resolves_to": "contingency", "note": "grounds to the contingency register (CTR)", "verdict": "resolved"},
            {"keywords": ["variance", "over budget", "approved"], "resolves_to": "variance", "note": "grounds to forecast − approved budget", "verdict": "resolved"},
            {"keywords": ["committed", "signed", "po"], "resolves_to": "committed", "note": "grounds to signed lots + committed labour", "verdict": "resolved"},
            {"keywords": ["return to service", "in-service date", "handback date", "completion date"], "resolves_to": None, "note": "a predicted date needs a schedule model this graph does not have", "verdict": "refused"},
            {"keywords": ["failure", "reliability", "mdbf"], "resolves_to": None, "note": "no validated failure model for trams", "verdict": "refused"}],
        "resolve_copy": {"resolved": {"tone": "ok", "title": "Resolved — \"{label}\" added.", "body": "It grounds in a measure the graph already holds."},
                         "grounds_not_inherited": {"tone": "warn", "title": "Grounds, but not as an inherited-risk measure.", "body": "It resolves, and the answer says so on its face."},
                         "refused": {"tone": "bad", "title": "Doesn't ground.", "body": "A predicted return-to-service date or failure rate is refused, not guessed. See resolvable_measures."}},
        "authoring": {
            "steps": [{"n": 1, "key": "setup", "title": "Set up", "heading": "Set up", "help": "Choose the measures this frame watches and how many cases you want side by side.", "note": None,
                       "add_measure": {"label": "Add a measure the graph can support", "placeholder": "e.g. index exposure, contingency drawdown…", "button": "Resolve against graph", "help": "A predicted return-to-service date or failure rate is refused, not guessed. See resolvable_measures."}},
                      {"n": 2, "key": "levers", "title": "Set your levers", "heading": "Set your levers", "help": "Only the slices the graph can attribute expose a lever. The rest are shown and locked, with the reason.", "note": None, "preview_rows": 5, "graph_link": "◈ Show the graph this frame references"},
                      {"n": 3, "key": "review", "title": "Review", "heading": "Review", "help": "The frame and each case's lever positions are what gets saved — never the computed figures.", "note": None}],
            "scenario_count": {"heading": "How many cases do you want side by side?", "help": "Each case is one set of lever positions against the same frame.", "options": [1, 2, 3, 4], "default": 2},
            "lever_config": {"mat": {"exposed": True, "min": -5, "max": 15}, "lab": {"exposed": True, "min": -5, "max": 20}, "cont": {"exposed": True, "min": 0, "max": RESERVE}},
            "cases": [{"name": "Base case", "vals": {"mat": 0, "lab": 0, "cont": BASE["cont"]}}, {"name": "Index +8%", "vals": {"mat": 8, "lab": 0, "cont": BASE["cont"]}}],
            "cta_step1": "Continue — set your levers →", "cta_step2": "Continue — review →", "cta_step3": "Save frame & run →"},
        "runtime": {
            "compare": {"min": 1, "max": 4, "default": 2, "help": "“Add to compare” opens a saved case as a new column beside this one."},
            "scenario_card": {"load_label": "Lever positions — the levers", "name_placeholder": "Name this case (e.g. Index +8%)", "trace_link": "▸ Trace every figure to its source slice",
                              "trace_header": "These figures come from the attributed cost decomposition: three source systems, one slice each.",
                              "residual_note": "Cost the graph cannot attribute to a slice does not move with any lever and is stated separately.",
                              "clean_note": "No lever on this case crosses the PPI envelope.", "graph_link": "◈ Show the graph this references"},
            "headroom": {"label": "Headroom — the inverse question", "formula": "floor((envelope - base_forecast) / slice_base) as a percent of the slice", "measure": "forecast", "against": "appetite.forecast",
                         "sentence": "{room}{unit} more on {driver} before the base case crosses the envelope.", "help": "Goal-Seek-style and exact — the inverse of the decomposition, not a forecast.",
                         "worked_example": {"question": "How far can the overhaul price index rise before the base case crosses the PPI envelope?", "answer_pct": hr["mat"]["room"],
                                            "solved_from": f"envelope {ENVELOPE}M − base forecast {FC0}M = {round(ENVELOPE - FC0, 1)}M of headroom ÷ the {BASE['mat']}M index-linked slice",
                                            "note": "Goal-Seek-style and exact — the inverse of the decomposition, not a forecast."}},
            "saved_library": {"title": "Saved scenario library", "stores": "Lever positions and the frame, never the computed figures. Re-opening recomputes.", "empty": "None yet. Save a case above to keep it here.",
                              "full_help": "Compare strip is full (4). Remove a column to add another.", "save_btn": "＋ Save this scenario", "update_btn": "↻ Update saved scenario",
                              "saved_flag": "✓ Saved to library", "add_btn": "Add to compare", "default_name_template": "{driver} {sign}{value}{unit}"},
            "closing_note": "A lever moves only the slice the graph can attribute to that driver. Locked slices and the unattributed residual never move — smearing an unattributed amount across drivers would invent a sensitivity the data does not have.",
            "sources": [{"key": "CTR", "label": "Fixed-price overhaul lots", "color": "#047857", "line": "solid"}, {"key": "DEF", "label": "Not decomposable from the current graph", "color": "#475569", "line": "solid"},
                        {"key": "ERP", "label": "Keolis timesheets + internal rate card", "color": "#1d4ed8", "line": "solid"}, {"key": "IDX", "label": "Transalp clause 9 price index", "color": "#b45309", "line": "solid"}],
            "worked_examples": ex},
        "graph_reference": {
            "node_types": [{"key": k, "label": k, "color": "#475569", **({"risk_colors": {"high": "red", "med": "amber", "low": "green"}} if k == "Project" else {})}
                           for k in ("Asset", "Component", "Contract", "Amendment", "Clause", "ResponsibilityAssignment", "Organisation", "Supplier", "Project", "Need", "PurchaseOrderLine",
                                     "FundingClaim", "ScheduleTask", "AccessWindow", "AcceptanceItem", "Measure", "Statement")],
            "relationships": ["AFFECTS_ASSET", "AMENDS", "ASSIGNS", "ASSIGNED_TO", "ATTRIBUTED_TO", "CLAIMS_FOR", "COMMITS", "CONTAINS_CLAUSE", "CONTRADICTS", "DEPENDS_ON", "GOVERNED_BY",
                              "HAS_CONDITION", "HAS_MEASURE", "HAS_REPLACEMENT_DATE", "HAS_TASK", "HOSTS_COMPONENT", "LEADS_TO_NEED", "LOCATED_AT", "RENEWS", "REPLACES", "REQUIRES_ACCEPTANCE",
                              "REQUIRES_ACCESS", "SUPPLIED_BY"],
            "frame": {"description": "The frame — the project node, its attributed cost slices and the source feed behind each one.", "center_node": "facility", "edge": "ATTRIBUTED_TO", "max_drawn": 5},
            "scenario_subgraph": {"description": "What one case traverses: each moved slice back to the feed that prices it, and forward to the watched measure.", "nodes": ["mat", "lab", "sub", "cont", "res"]}},
        "headroom": hr,
        "scenario_library_seeds": [
            {"id": 1, "name": "Index exposure — TV-100 overhaul", "watch": {"forecast": True, "contingency": True, "variance": True, "committed": True},
             "cfg": {"mat": {"exposed": True, "min": -5, "max": 15}, "lab": {"exposed": True, "min": -5, "max": 20}, "cont": {"exposed": True, "min": 0, "max": RESERVE}}, "count": 2,
             "cases": [{"name": "Base case", "vals": {"mat": 0, "lab": 0, "cont": BASE["cont"]}}, {"name": "Index +8%", "vals": {"mat": 8, "lab": 0, "cont": BASE["cont"]}}],
             "pub": {"readers": ["claire.moreau@vriodigital.com", "amelie.roussel@vriodigital.com"], "graph": "v1", "fresh": {"preset": "monday", "every": 1, "unit": "week", "days": ["Mon"], "time": "6:00 AM"}}},
            {"id": 2, "name": "Contingency draw-down", "watch": {"forecast": True, "contingency": True, "variance": False, "committed": False},
             "cfg": {"mat": {"exposed": False, "min": -5, "max": 15}, "lab": {"exposed": True, "min": -5, "max": 20}, "cont": {"exposed": True, "min": 0, "max": RESERVE}}, "count": 1,
             "cases": [{"name": "Full reserve drawn", "vals": {"mat": 0, "lab": 0, "cont": RESERVE}}], "pub": None}],
        "slices": slices, "levers": ["mat", "lab", "cont"],
        "locked_slices": [{"id": "sub", "label": "Fixed-price overhaul lots", "base_usd_m": BASE["sub"], "why_locked": slices[2]["trace"]},
                          {"id": "res", "label": "Residual — unattributed", "base_usd_m": BASE["res"], "why_locked": slices[4]["trace"]}],
        "program": {"name": "Tram TV-100 mid-life overhaul", "site": "Centre de maintenance tram La Varenne · 24 trams", "envelope": ENVELOPE, "approvedBudget": APPROVED, "baselineMonths": 50},
        "publishing": {
            "publish_title": "Publish scenario", "manage_title": "Manage publishing",
            "call": "The scenario — the frame (watched measures, exposed drivers and their ranges) plus its cases. A case is never published on its own.",
            "readers": {"label": "Readers", "placeholder": "Name or email…", "empty_error": "Add at least one reader.", "caveat": "This narrows who is told the scenario exists. It is not access control.",
                        "scope_note": "Publishing never widens access. Each reader opens the scenario under their own data-access rules; a masked measure stays masked."},
            "graph": {"label": "Bind to a graph", "note": "A published scenario points to one published graph version and re-traverses it on every open. When a newer graph is published the author can re-bind.",
                      "empty": "Nothing is published, so there is no graph to bind a scenario to.",
                      "options": [{"id": "v1", "label": "Keolis Valmont SGR graph · v1 — current, published Sep 23, 2026"}], "default": "v1"},
            "freshness": {"label": "Numbers freshness", "presets": [{"id": "open", "label": "Only when it’s opened", "sentence": "Only when it’s opened"},
                                                                    {"id": "daily", "label": "Every weekday (Mon–Fri) at 6:00 AM", "sentence": "Every weekday (Mon–Fri) at 6:00 AM"},
                                                                    {"id": "monday", "label": "Weekly on Monday at 6:00 AM", "sentence": "Weekly on Monday at 6:00 AM"},
                                                                    {"id": "monthly", "label": "Monthly on the 1st at 6:00 AM", "sentence": "Monthly on the 1st at 6:00 AM"},
                                                                    {"id": "custom", "label": "Custom…", "sentence": "Custom schedule"}],
                          "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "times": ["6:00 AM", "7:00 AM", "8:00 AM", "12:00 PM", "6:00 PM"], "units": ["day", "week", "month"],
                          "every": {"min": 1, "max": 99}, "default": {"preset": "open", "every": 1, "unit": "week", "days": ["Mon"], "time": "6:00 AM"},
                          "no_day_error": "A custom weekly schedule with no day selected blocks publishing."},
            "done": {"title": "Scenario published", "body": "“{name}” is live for {n}. Each opens it under their own access — same scenario, their scope. It stays in your library — come back any time to change it.",
                     "stored": "Lever positions and the frame, never the computed figures. Re-opening recomputes.", "link": {"label": "Copy link", "copied": "Link copied."},
                     "labels": {"cases": "Cases", "readers": "Readers", "graph": "Graph", "numbers": "Numbers", "access": "Access rules"}, "graph_note": "current, published {when}",
                     "access_note": "per-reader scope is managed in Audit & Governance.", "audit_link": "Open Audit & Governance →", "buttons": {"again": "+ Start a new scenario", "close": "Done"}},
            "buttons": {"publish": "Publish scenario", "update": "Update publication", "unpublish": "Unpublish", "manage": "Manage publishing…", "open": "Publish scenario…"},
            "unpublished_note": "Unpublished — the scenario stays in your library.", "directory": dir_,
            "link_pattern": "contextweave.keolis-valmont.example/w/<scenario-name-slugified>", "governance_link": "../08_audit_governance/governance_audit_keolis.html"},
        "document": {"document_id": "W1", "file": "W1_what_if_lens.html", "title": "What-if — Keolis Valmont renewal", "version": "v1", "stage": "draft", "heading": "What-if",
                     "subtitle": "Stress the TV-100 overhaul forecast without pretending to predict it. A what-if moves one attributable driver at a time — the index-linked overhaul price, Keolis labour, contingency — and holds the fixed-price lots and the residual.",
                     "tabs": [{"key": "author", "label": "Authoring"}, {"key": "runtime", "label": "Runtime"}]},
    }

# ------------------------------------------------------------------ audit & governance
ROSTER = len(PORTFOLIO)
INFRA = [p for p in PORTFOLIO if p["cat"] in ("Track & civil", "Power & charging", "Signalling & systems", "Stations & passenger info")]

def audit():
    return {
        "stats": [{"label": "Access rules in force", "value": "6", "note": "1 of 6 readers carries a restriction"},
                  {"label": "PII columns", "value": str(sum(1 for _ in [1])) if False else "6", "note": "across 34 catalogued tables", "tone": "good"},
                  {"label": "Columns to review", "value": "27", "note": "profiler confidence below the accept floor", "tone": "warn"},
                  {"label": "Cost-cap headroom", "value": "21%", "note": "tightest: Ask (tenant) at 79.0%", "tone": "warn"}],
        "events": [
            {"actor": "Inès Benali", "action": "Opened Portfolio Intervention Review", "resource": "Portfolio Intervention Review", "severity": "Info", "tone": "neutral", "at": "Today 09:12", "detail": f"Her access resolved: category = infrastructure — {len(INFRA)} of {ROSTER} projects today.", "category": "open"},
            {"actor": "Claire Moreau", "action": "Opened Portfolio Intervention Review", "resource": "Portfolio Intervention Review", "severity": "Info", "tone": "neutral", "at": "Today 08:47", "detail": f"Her access resolved: all {ROSTER} projects, no masks.", "category": "open"},
            {"actor": "system", "action": "Scheduled refresh ran on Portfolio Intervention Review", "resource": "Portfolio Intervention Review", "severity": "Info", "tone": "neutral", "at": "Today 07:00", "detail": "Finance and PPM blocks refreshed. Correspondence blocks are read at open time and are not part of the schedule.", "category": "ref"},
            {"actor": "Amélie Roussel", "action": "Published what-if scenario Index exposure — TV-100 overhaul", "resource": "what-if scenario Index exposure — TV-100 overhaul", "severity": "Info", "tone": "neutral", "at": "Sep 23 16:40", "detail": "2 readers · 2 cases (Base case, Index +8%) · points to graph v1", "category": "pub"},
            {"actor": "Thomas Garnier", "action": "Published graph Keolis Valmont SGR v1", "resource": "graph v1", "severity": "Medium", "tone": "warn", "at": "Sep 23 15:58", "detail": "Published with 8 review items open (1 pivot). Answers that touch rq1 carry the caveat.", "category": "pub"},
            {"actor": "Thomas Garnier", "action": "Changed rule for Inès Benali", "resource": "data access rule", "severity": "Medium", "tone": "warn", "at": "Sep 23 11:05", "detail": "Restriction basis = category (infrastructure). Supplier commitments masked.", "category": "rule"},
            {"actor": "Julien Faure", "action": "Opened Project 360 — P-VM-031", "resource": "Project 360", "severity": "Info", "tone": "neutral", "at": "Sep 22 17:20", "detail": "His access resolved: all projects; technician narratives masked.", "category": "open"},
            {"actor": "Amélie Roussel", "action": "Exported PPI Claim Pack (XLSX)", "resource": "PPI Claim Pack", "severity": "Medium", "tone": "warn", "at": "Sep 22 14:02", "detail": "Export carries the watermark and the as-of line; potential lines are exported on a separate sheet.", "category": "export"},
            {"actor": "system", "action": "Sealed trace for 'Who pays for the BUS-204 engine repair?'", "resource": "trace_kv03", "severity": "Info", "tone": "neutral", "at": "Sep 22 10:31", "detail": "4 spans · €0.12 · confidence 0.84", "category": "ref"},
            {"actor": "Marc Delorme", "action": "Changed persona access for Business User — Project Level", "resource": "settings", "severity": "Medium", "tone": "warn", "at": "Sep 21 09:15", "detail": "Reports hidden from the sidebar for all personas (beta).", "category": "rule"}],
        "policies": [
            {"name": "Two gates", "desc": "Gate 1 decides whether an artifact EXISTS for a viewer (audience). Gate 2 decides which ROWS a viewer sees inside it (data scope). They are administered separately.", "status": "Enforced", "tone": "good"},
            {"name": "Counts are computed", "desc": f"Every count on this screen — \"sees {len(INFRA)} of {ROSTER}\" — is derived from the project roster at paint time, never typed.", "status": "Enforced", "tone": "good"},
            {"name": "Rule shape", "desc": "A person is full-scope, or restricted by exactly one basis field plus optional masks.", "status": "Enforced", "tone": "good"},
            {"name": "Legal basis", "desc": "A field qualifies as a restriction basis only if every one of its values is known on every row (project, category, depot, contract, funding source).", "status": "Enforced", "tone": "good"},
            {"name": "Authority view", "desc": "An authority reader sees project costs, approved scope and delivery evidence; operator margin and GER provision stay restricted.", "status": "Enforced", "tone": "good"},
            {"name": "Correspondence is runtime", "desc": "Mailbox content is read at question time under the reader's permissions and never becomes a graph fact or a cached figure.", "status": "Enforced", "tone": "good"},
            {"name": "Contract exit", "desc": "Deletion and handback at contract end apply to originals, extracts, indexes, cached answers and derived datasets.", "status": "Enforced", "tone": "good"}],
        "event_window": "Last 7 days · 10 events", "policy_total": 7,
        "categories": [{"id": "all", "label": "All"}, {"id": "pub", "label": "Publishing"}, {"id": "open", "label": "Opens"}, {"id": "rule", "label": "Rule changes"}, {"id": "ref", "label": "Refreshes"}, {"id": "export", "label": "Exports"}],
    }

def traces():
    picks = ["Q06", "Q01", "Q05", "Q02", "Q04", "Q07", "Q10", "Q14", "Q19", "Q43", "Q32"]
    dur = {"Q06": 7900, "Q01": 6200, "Q05": 4100, "Q02": 3300, "Q04": 3900, "Q07": 1800, "Q10": 2600, "Q14": 2900, "Q19": 5200, "Q43": 700, "Q32": 2100}
    actors = ["Inès Benali", "Claire Moreau", "Valérie Chauvin" if False else "Claire Moreau", "Amélie Roussel", "Amélie Roussel", "Julien Faure", "Nishant Srivastav", "Claire Moreau", "Amélie Roussel", "Julien Faure", "Claire Moreau"]
    items = []
    for i, aid in enumerate(picks):
        a = next(x for x in AN.ANS if x["answer_id"] == aid)
        d = dur[aid]
        items.append({"id": f"trace_kv{i + 1:02d}", "operation": a["question"], "service": "Keolis Valmont SGR graph v1", "duration": d, "spans": 2 if a["kind"] == "decline" else (5 if d > 5000 else 4),
                      "status": "Slow" if d > 5000 else "OK", "tone": "warn" if d > 5000 else "good", "at": f"2026-09-2{3 - i // 6}T{15 - i:02d}:{(i * 13) % 60:02d}:{(i * 29) % 60:02d}Z",
                      "actor": actors[i], "confidence": a["confidence"] if a["kind"] != "decline" else None, "cost_usd": round(0.02 + d / 50000, 2) if a["kind"] != "decline" else 0.01, "sealed": True})
    ds = sorted(x["duration"] for x in items)
    p50 = ds[len(ds) // 2] / 1000; p95 = ds[-1] / 1000
    cost = round(sum(x["cost_usd"] for x in items), 2)
    return {"stats": [{"label": "p50 duration", "value": f"{p50:.1f} s", "note": f"across {len(items)} sealed traces"},
                      {"label": "p95 duration", "value": f"{p95:.1f} s", "note": "longest: " + items[0]["operation"][:44], "tone": "warn"},
                      {"label": "Unaccounted time", "value": "790 ms", "note": "shown as a gap, never folded into a step"},
                      {"label": "Cost this window", "value": f"${cost:.2f}", "note": "against the $2.00 per-question budget"}],
            "items": items, "sampling": "Every question is sealed — no sampling. A trace a viewer cannot find is a trace that does not exist.",
            "waterfall": {"trace_id": "trace_kv01", "operation": items[0]["operation"], "total_ms": 7900, "unaccounted_ms": 790,
                          "unaccounted_why": "Orchestration and transport the trace does not itemise. Shown as a gap at the end of the timeline rather than folded into the last step.",
                          "spans": [{"name": "Understand & plan", "start": 0, "duration": 320, "agent": "supervisor", "detail": "classified: readiness · runtime source required"},
                                    {"name": "Resolve the subject", "start": 320, "duration": 540, "agent": "graph agent", "detail": "P-VM-008 → TRK-T1-S07 → ACC-T1-2026-031 → drawing rev C"},
                                    {"name": "Read governed facts", "start": 860, "duration": 1450, "agent": "graph agent", "detail": "ppm.schedule_task · ops.access_window · approval_decision (as of 2026-09-19)"},
                                    {"name": "Pull correspondence", "start": 2310, "duration": 3100, "agent": "runtime agent", "detail": "src_gmail · 30-day window · 1 mailbox in scope · permissions follow the reader"},
                                    {"name": "Extract & resolve observations", "start": 5410, "duration": 1700, "agent": "runtime agent", "detail": "4 extractions → 4 above the 0.70 floor → resolved against P-VM-008"}]}}

def evals():
    n = len(AN.ANS); hi = sum(1 for a in AN.ANS if a["confidence_level"] == "High"); med = sum(1 for a in AN.ANS if a["confidence_level"] == "Medium"); lo = n - hi - med
    decl = sum(1 for a in AN.ANS if a["kind"] == "decline")
    return {"stats": [{"label": "Suites", "value": "6", "note": "all derived from package artifacts"},
                      {"label": "Hero questions answerable", "value": "4 of 5", "note": "graph sanity checks", "tone": "warn"},
                      {"label": "High-confidence answers", "value": f"{hi} of {n}", "note": f"{med} medium, {lo} low"},
                      {"label": "Must-review graph items", "value": "8", "note": "0 resolved · 1 pivot", "tone": "crit"}],
            "runs": [{"suite": "hero-question-answerability", "target": "g_keolis_valmont_sgr · 5 checks", "checks": 5, "pass_rate": 80, "status": "Degraded", "tone": "warn", "ran_at": "2026-09-23"},
                     {"suite": "answer-confidence", "target": f"query set · {n} questions", "checks": n, "pass_rate": round(hi / n * 100, 1), "status": "Degraded", "tone": "warn", "ran_at": "2026-09-23"},
                     {"suite": "refusal-correctness", "target": f"{decl} declines", "checks": decl, "pass_rate": 100, "status": "Passed", "tone": "good", "ran_at": "2026-09-23"},
                     {"suite": "authorisation-not-promoted", "target": "expectations, drafts, conditional approvals", "checks": 6, "pass_rate": 100, "status": "Passed", "tone": "good", "ran_at": "2026-09-23"},
                     {"suite": "citation-validity", "target": f"{sum(len(a['citations']) for a in AN.ANS)} citations", "checks": sum(len(a['citations']) for a in AN.ANS), "pass_rate": 100, "status": "Passed", "tone": "good", "ran_at": "2026-09-23"},
                     {"suite": "financial-reconciliation", "target": "portfolio control totals vs fin close M08", "checks": 12, "pass_rate": 91.7, "status": "Degraded", "tone": "warn", "ran_at": "2026-09-23"}],
            "checks": [{"name": "sc1 · Which renewal projects need intervention this week, and why?", "dataset": "g_keolis_valmont_sgr", "result": "Passed", "tone": "good", "detail": "Answerable - factors kept visible"},
                       {"name": "sc2 · Who pays for the BUS-204 engine repair?", "dataset": "g_keolis_valmont_sgr", "result": "Passed", "tone": "good", "detail": "Answerable - established vs unresolved"},
                       {"name": "sc3 · Is the battery replacement campaign complete?", "dataset": "g_keolis_valmont_sgr", "result": "Warning", "tone": "warn", "detail": "Depends on pivot rq1 staying 'keep distinct'"},
                       {"name": "sc4 · Enough buses for peak while tranche 2 is late?", "dataset": "g_keolis_valmont_sgr", "result": "Warning", "tone": "warn", "detail": "Vehicles only — crews not connected"},
                       {"name": "sc5 · Predict which trams will fail next quarter", "dataset": "g_keolis_valmont_sgr", "result": "Refused", "tone": "crit", "detail": "Declined - required inputs have no instances"},
                       {"name": "No expectation promoted to approval (tranche 3)", "dataset": "review queue", "result": "Passed", "tone": "good", "detail": "rq5 held as reported expectation"},
                       {"name": "Reused fleet number not merged (BUS-104)", "dataset": "review queue", "result": "Passed", "tone": "good", "detail": "rq4 kept distinct pending review"},
                       {"name": "Unallocated spend kept visible", "dataset": "g_keolis_valmont_sgr", "result": "Passed", "tone": "good", "detail": "€1,312,480 · 412 lines · not spread"}],
            "run_trigger": "On graph build and on query-set regeneration",
            "failure_summary": f"{lo} low-confidence answers · 8 graph items awaiting review · 1 reconciliation difference (accrual timing, €18,400) open with finance"}

# ------------------------------------------------------------------ reports (governance is what Audit reads)
def _fig(key, label, measure, raw, unit="EUR", basis="record", frame="single", note=None, prov=None):
    disp = eur_m(raw) if unit == "EUR" and abs(raw) >= 1e6 else (eur(raw) if unit == "EUR" else (f"{raw:.1f}%" if unit == "PCT" else str(raw)))
    return {"key": key, "label": label, "measure": measure, "measureLabel": label, "unit": unit, "signed": raw < 0, "coord": {"basis": basis, "period_frame": frame},
            "coordStated": f"{basis} basis · {'this period' if frame == 'single' else 'full span'}", "coordProblems": [], "expr": None, "exprError": None, "exprReads": None,
            "raw": raw, "display": disp, "exact": eur(raw) if unit == "EUR" else None, "note": note, "prov": prov or f"pv_kv{md5_8(key + label)[:5]}"}

def reports():
    A = AN
    roster = [{"n": f"{p['code']} · {p['name']}", "reg": next(d["name"] for d in DEPOTS if d["id"] == p["depot"]), "cat": p["cat"], "bu": p["funding"], "phase": p["stage"],
               "comp": "Mandatory" if p["code"] in ("P-VM-014", "P-VM-069") else "No mandatory constraint"} for p in PORTFOLIO]
    pop = {"kind": "declared", "n": ROSTER, "label": f"the declared portfolio ({ROSTER} projects)", "note": "Projects without a current forecast are listed and excluded from forecast figures."}
    anchors = [PBY[c] for c in ("P-VM-008", "P-VM-014", "P-VM-021", "P-VM-005", "P-VM-031", "P-VM-017", "P-VM-026")]
    def rep(rid, tag, title, badge, q, blocks, tiles, persona="Domain Architect"):
        return {"report_id": rid, "report_tag": tag, "subject": "project × category", "title": title, "question": q, "spine": "projects", "scope": "sc_author_all", "scope_label": "Author -- all data",
                "measure": "m_forecast_total", "measure_label": "Forecast total", "reading": {"template": q + " Read over {scope}, by {measure}.", "slots": ["scope", "measure"]},
                "blocks": blocks, "heading": title, "subtitle": q, "badge": badge, "note": q, "tiles": tiles,
                "footer": [{"label": "As of", "text": "As of 2026-09-19, the age of its stalest input (PPM weekly publication, 5 days behind). Fresher datasets contributed but cannot lift the floor."},
                           {"label": "Bound to", "text": "g_keolis_valmont_sgr v1 · use case Fleet & Infrastructure Renewal"},
                           {"label": "Caveat", "text": "4 projects carry no current forecast and are excluded from forecast figures."},
                           {"label": "Served", "text": f"{title} · 1 · Thomas Garnier (Domain Architect) under Author -- full · {ROSTER} of {ROSTER} rows · as of 2026-09-19"}],
                "source_file": f"src/report/report_resolved.json#{rid}", "summary_keys": [],
                "resolved": {"version": 1, "status": "published", "persona": persona, "rows_served": ROSTER, "rows_total": ROSTER, "rows_note": None, "blocks_served": len(blocks), "blocks_total": len(blocks),
                             "as_of": "2026-09-19", "as_of_line": "As of 2026-09-19 — the age of the stalest of 3 contributing datasets (PPM, 5 days old). Fresher datasets contributed and cannot lift the floor.",
                             "watermark": f"{title} · 1 · Thomas Garnier (Domain Architect) under Author -- full · {ROSTER} of {ROSTER} rows · as of 2026-09-19", "export_formats": ["PDF", "XLSX", "CSV"], "empty": False, "empty_cause": None},
                "rendered_href": f"/report/keolis-report.html?report={rid}"}
    b1 = [{"id": "b1", "type": "figRow", "label": "Portfolio — assessed projects", "grain": "portfolio", "source": "portfolio",
           "figures": [_fig("budget", "Approved budget", "m_budget", A.A_BUD, basis="commitment", frame="full_span"), _fig("forecast", "Forecast total", "m_forecast_total", A.A_FC, basis="projection", frame="full_span"),
                       _fig("variance", "Variance", "m_variance", A.A_FC - A.A_BUD, basis="projection", frame="full_span"), _fig("exposure", "Operator exposure", "m_operator_exposure", A.OPX, basis="projection", frame="full_span")],
           "basesPresent": ["commitment", "projection"], "basisNote": "Budget is commitment basis; forecast and exposure are projection basis.", "combines": False,
           "combinesNote": "These 4 figures sit at 2 bases and are not summed.", "coverage": None, "population": pop},
          {"id": "b2", "type": "bar", "label": "Variance by anchor project", "grain": "project", "source": "projects", "chartType": "bar", "axis": [p["code"] for p in anchors], "axisLabel": "EUR · full span",
           "coord": {"basis": "projection", "period_frame": "full_span"}, "coordStated": "projection basis · full span",
           "series": [{"key": "variance", "label": "Forecast − budget", "measure": "m_variance", "unit": "EUR", "coord": {"basis": "projection", "period_frame": "full_span"}, "coordStated": "projection basis · full span",
                       "values": [{"raw": p["variance"] or 0, "display": eur_k(p["variance"] or 0), "unit": "EUR", "exact": eur(p["variance"] or 0)} for p in anchors],
                       "total": {"raw": sum(p["variance"] or 0 for p in anchors), "display": eur_m(sum(p["variance"] or 0 for p in anchors)), "unit": "EUR", "exact": eur(sum(p["variance"] or 0 for p in anchors))}, "noTotal": None}],
           "baseline": None, "stackTotalCombines": True, "failure": None, "note": "P-VM-012 has no budget yet and shows zero variance by construction.", "coverage": None, "population": pop},
          {"id": "b3", "type": "narrative", "label": "Reading", "grain": "portfolio", "source": "portfolio", "role": "exclusion",
           "body": "Four projects without a current forecast are excluded. Unallocated spend (€1,312,480) is outside every project. Recovery states are never summed as cash.",
           "parts": [{"text": "Four projects without a current forecast are excluded. Unallocated spend (€1,312,480) is outside every project. Recovery states are never summed as cash."}],
           "figures": [], "unbound": None, "unboundNote": None, "cites": None, "population": pop},
          {"id": "b4", "type": "ask", "label": "Ask about this report", "grain": "portfolio", "source": "portfolio", "suggestions": ["Which renewal projects need intervention this week, and why?", "Why has the TV-100 overhaul forecast grown?", "Which costs may fall outside the currently authorised scope?"],
           "unresolved": None, "unresolvedWhy": None, "enabled": True, "disabledWhy": None, "binding": {"graph": "g_keolis_valmont_sgr", "scope": "sc_author_all", "asOf": "2026-09-19T18:00:00Z", "reportId": "rep_kv_intervention"}, "population": pop}]
    tiles1 = [{"label": "Approved (assessed)", "value": eur_m(A.A_BUD), "unit": "commitment basis · full span", "tone": None, "exact": eur(A.A_BUD), "measure": "m_budget"},
              {"label": "Forecast (assessed)", "value": eur_m(A.A_FC), "unit": "projection basis · full span", "tone": "warn", "exact": eur(A.A_FC), "measure": "m_forecast_total"},
              {"label": "Variance", "value": eur_m(A.A_FC - A.A_BUD), "unit": "projection basis · full span", "tone": "crit", "exact": eur(A.A_FC - A.A_BUD), "measure": "m_variance"},
              {"label": "Projects needing a decision", "value": "5", "unit": "this week", "tone": "crit", "exact": None, "measure": "m_exceptions"}]
    p21 = PBY["P-VM-021"]
    b2s = [{"id": "b1", "type": "header", "label": "Project 360", "grain": "project", "source": "project", "sub": p21["name"], "dynamic": True,
            "subParts": [{"text": "Project 360 — "}, {"token": "$PROJECTNAME", "figure": {"key": "name", "label": "$PROJECTNAME", "measure": None, "measureLabel": None, "unit": None, "signed": False, "coord": None, "coordStated": "", "coordProblems": [], "expr": None, "exprError": None, "exprReads": None, "raw": p21["name"], "display": p21["name"], "exact": None, "note": None, "prov": "pv_kv360a"}},
                         {"token": "$CODE", "figure": {"key": "code", "label": "$CODE", "measure": None, "measureLabel": None, "unit": None, "signed": False, "coord": None, "coordStated": "", "coordProblems": [], "expr": None, "exprError": None, "exprReads": None, "raw": "P-VM-021", "display": "P-VM-021", "exact": None, "note": None, "prov": "pv_kv360b"}}],
            "population": {"kind": "row", "n": 1, "label": "one project"}},
           {"id": "b2", "type": "figRow", "label": "Forecast total — components", "grain": "project", "source": "project",
            "figures": [_fig("actuals", "Posted actuals", "m_actual", EX_B["actuals"]), _fig("accruals", "Valid accruals", "m_accrual", EX_B["accruals"]), _fig("committed", "Remaining committed", "m_ctc_committed", EX_B["committed_remaining"], basis="commitment"),
                        _fig("uncommitted", "Uncommitted", "m_ctc_uncommitted", EX_B["uncommitted_remaining"], basis="projection"), _fig("contingency", "Contingency", "m_contingency", EX_B["contingency"], basis="projection"),
                        _fig("forecast", "Forecast total", "m_forecast_total", EX_B["forecast_total"], basis="projection", frame="full_span")],
            "basesPresent": ["record", "commitment", "projection"], "basisNote": "Components at three bases foot to the forecast total by the governed rule.", "combines": True, "combinesNote": "Forecast total = actuals + accruals + cost to complete.", "coverage": None, "population": {"kind": "row", "n": 1, "label": "one project"}},
           {"id": "b3", "type": "narrative", "label": "Schedule conflict", "grain": "project", "source": "project", "role": "caveat",
            "body": "The supplier's revised date for the HPU-9 control unit (19 October) is in correspondence, not in the ERP or the schedule. Commissioning on 26 October is not achievable; bays 3–4 are needed on 2 November.",
            "parts": [{"text": "The supplier's revised date for the HPU-9 control unit (19 October) is in correspondence, not in the ERP or the schedule. Commissioning on 26 October is not achievable; bays 3–4 are needed on 2 November."}],
            "figures": [], "unbound": None, "unboundNote": None, "cites": None, "population": {"kind": "row", "n": 1, "label": "one project"}},
           {"id": "b4", "type": "ask", "label": "Ask about this project", "grain": "project", "source": "project", "suggestions": ["Is the depot lift replacement at Les Aubiers still on budget, and is it on time?", "Break down the lift project forecast.", "If operations spends €25,000 on external maintenance, what does the lift project cost?"],
            "unresolved": None, "unresolvedWhy": None, "enabled": True, "disabledWhy": None, "binding": {"graph": "g_keolis_valmont_sgr", "scope": "sc_author_all", "asOf": "2026-09-22T18:00:00Z", "reportId": "rep_kv_proj_360"}, "population": {"kind": "row", "n": 1, "label": "one project"}}]
    tiles2 = [{"label": "Approved", "value": eur_k(EX_B["budget"]), "unit": "commitment basis", "tone": None, "exact": eur(EX_B["budget"]), "measure": "m_budget"},
              {"label": "Forecast", "value": eur_k(EX_B["forecast_total"]), "unit": "projection basis", "tone": "good", "exact": eur(EX_B["forecast_total"]), "measure": "m_forecast_total"},
              {"label": "Commissioning", "value": "at risk", "unit": "26 Oct", "tone": "crit", "exact": None, "measure": "m_schedule"}]
    b3s = [{"id": "b1", "type": "figRow", "label": "Q3 claim by state", "grain": "portfolio", "source": "claims",
            "figures": [_fig("ready", "Ready to claim", "m_claim_ready", 4_860_000), _fig("submitted", "Submitted, open", "m_claim_submitted", 1_210_000), _fig("accepted", "Accepted, unpaid", "m_claim_accepted", 2_960_000),
                        _fig("disputed", "Disputed", "m_claim_disputed", 212_000), _fig("potential", "Potential only", "m_claim_potential", 408_000)],
            "basesPresent": ["record"], "basisNote": "Claim states are separate and never summed as cash.", "combines": False, "combinesNote": "Five states, five figures — no total.", "coverage": None, "population": pop},
           {"id": "b2", "type": "narrative", "label": "What the authority sees", "grain": "portfolio", "source": "claims", "role": "scope",
            "body": "Approved scope, funding, delivery evidence and the claim lines. Operator margin and the GER provision are restricted.", "parts": [{"text": "Approved scope, funding, delivery evidence and the claim lines. Operator margin and the GER provision are restricted."}],
            "figures": [], "unbound": None, "unboundNote": None, "cites": None, "population": pop}]
    tiles3 = [{"label": "Ready to claim", "value": "€4.9M", "unit": "record basis", "tone": "good", "exact": eur(4_860_000), "measure": "m_claim_ready"},
              {"label": "Disputed", "value": "€212k", "unit": "record basis", "tone": "crit", "exact": eur(212_000), "measure": "m_claim_disputed"},
              {"label": "Potential only", "value": "€408k", "unit": "not claimable", "tone": "warn", "exact": eur(408_000), "measure": "m_claim_potential"}]
    reps = [rep("rep_kv_intervention", "intervention-review", "Portfolio Intervention Review", "Portfolio", "Show which renewal projects need a decision this week, with each contributing factor visible.", b1, tiles1),
            rep("rep_kv_proj_360", "project-360", "Project 360", "Project", "Give one project's full financial and schedule position with the provenance attached.", b2s, tiles2),
            rep("rep_kv_ppi_claim", "ppi-claim-pack", "PPI Claim Pack", "Authority", "Show what can be claimed from the authority this quarter, and what is only potential.", b3s, tiles3, persona="Data Analyst")]
    people = [(p[2], p[3]) for p in PEOPLE if p[1] != "admin"]
    def readers(scope):
        out = []
        for name, email in people[:3] if scope == "all" else people[1:4]:
            restricted = name == "Inès Benali"
            out.append({"email": email, "name": name, "gate1_entitled": True,
                        "gate2": {"kind": "rules" if restricted else "full", "projects_admitted": len(INFRA) if restricted else ROSTER, "detail": "Category = infrastructure" if restricted else "Full scope"}})
        return out
    gov = {"statuses": [{"key": "published", "label": "Published", "tone": "good"}, {"key": "draft", "label": "Draft", "tone": "neutral"}, {"key": "scheduled", "label": "Scheduled", "tone": "neutral"}, {"key": "unpublished", "label": "Unpublished", "tone": "warn"}],
           "reports": [{"report_id": "rep_kv_intervention", "status": "published", "version": "v1", "author": "Thomas Garnier", "category": "Portfolio", "as_of": "2026-09-24T07:00:00Z", "schedule": "Refreshes daily · 07:00 UTC", "approval": "none",
                        "audience": ["business_user_exec", "analyst", "architect"], "note": "The schedule covers finance and PPM blocks; correspondence is read at open time.", "link": "contextweave.keolis-valmont.example/r/intervention-review",
                        "readers": [{"email": "claire.moreau@vriodigital.com", "name": "Claire Moreau", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope"}},
                                    {"email": "amelie.roussel@vriodigital.com", "name": "Amélie Roussel", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope, supplier contacts masked"}},
                                    {"email": "ines.benali@vriodigital.com", "name": "Inès Benali", "gate1_entitled": True, "gate2": {"kind": "rules", "projects_admitted": len(INFRA), "detail": "Category = infrastructure"}}]},
                       {"report_id": "rep_kv_proj_360", "status": "published", "version": "v1", "author": "Amélie Roussel", "category": "Project", "as_of": "2026-09-23T07:00:00Z", "schedule": "Only when it’s opened", "approval": "none",
                        "audience": ["business_user_exec", "analyst", "architect"], "note": None, "link": "contextweave.keolis-valmont.example/r/project-360",
                        "readers": [{"email": "julien.faure@vriodigital.com", "name": "Julien Faure", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope, technician notes masked"}},
                                    {"email": "claire.moreau@vriodigital.com", "name": "Claire Moreau", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope"}},
                                    {"email": "ines.benali@vriodigital.com", "name": "Inès Benali", "gate1_entitled": True, "gate2": {"kind": "rules", "projects_admitted": len(INFRA), "detail": "Category = infrastructure — P-VM-021 is outside her scope"}}]},
                       {"report_id": "rep_kv_ppi_claim", "status": "published", "version": "v1", "author": "Amélie Roussel", "category": "Authority", "as_of": "2026-09-22T07:00:00Z", "schedule": "Monthly on the 1st at 6:00 AM", "approval": "controller sign-off",
                        "audience": ["business_user_exec", "analyst", "architect"], "note": "Potential lines export on a separate sheet.", "link": "contextweave.keolis-valmont.example/r/ppi-claim-pack",
                        "readers": [{"email": "claire.moreau@vriodigital.com", "name": "Claire Moreau", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope"}},
                                    {"email": "amelie.roussel@vriodigital.com", "name": "Amélie Roussel", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope"}},
                                    {"email": "thomas.garnier@vriodigital.com", "name": "Thomas Garnier", "gate1_entitled": True, "gate2": {"kind": "full", "projects_admitted": ROSTER, "detail": "Full scope"}}]}],
           "data_scope": [{"role_id": slug_(n), "scope": s, "predicate": pr, "grain": "project", "masked": mk, "may_author": au, "full": fu, "mask": bool(mk), "rule": ru, "email": e, "name": n, "projects_admitted": pa, "of_total": ROSTER, "computed_from": "projects[] at paint time"}
                          for n, e, s, pr, mk, au, fu, ru, pa in (
                              ("Claire Moreau", "claire.moreau@vriodigital.com", f"All {ROSTER}", "Full scope", "", False, True, None, ROSTER),
                              ("Amélie Roussel", "amelie.roussel@vriodigital.com", f"All {ROSTER}, masked", "Supplier contacts masked", "supplier contacts", True, True, None, ROSTER),
                              ("Thomas Garnier", "thomas.garnier@vriodigital.com", f"All {ROSTER}", "Full scope", "", True, True, None, ROSTER),
                              ("Julien Faure", "julien.faure@vriodigital.com", f"All {ROSTER}, masked", "Technician narratives masked", "technician notes", False, True, None, ROSTER),
                              ("Inès Benali", "ines.benali@vriodigital.com", f"{len(INFRA)} of {ROSTER}", "Category = infrastructure", "supplier commitments", False, False, {"basis": "cat", "values": ["Track & civil", "Power & charging", "Signalling & systems", "Stations & passenger info"]}, len(INFRA)))],
           "gate_notes": {"both": "The two are administered in two separate places: audience at publish time, data scope on the reader's row.",
                          "entitlement": "May this viewer see that this report EXISTS? Set by the author at publish time, by email address.",
                          "data_scope": "Which rows does this viewer's predicate admit? Managed on the reader's row; follows the person everywhere.",
                          "author": "Writing a report definition is a separate permission from reading one.",
                          "cannot_be_front_end": f"If the browser receives {ROSTER} rows and shows {len(INFRA)}, the other rows have leaked. The server filters before it serves."},
           "publishing": {"title": "Publish this report", "republish_title": "Publish your changes", "lead": "It goes live to the people you pick — nobody else is told it exists.",
                          "name": {"label": "Report name", "help": "Give it a name your audience will recognise.", "placeholder": "e.g. Portfolio Intervention Review — week 39"},
                          "readers": {"label": "Who can open it", "placeholder": "Type a name or email address…", "empty": "Nobody yet — this report stays private until you add a reader.",
                                      "note": "Each person sees only what their data access allows.", "caveat": "This narrows who is shown the report. It is not access control.",
                                      "local_caveat": "Readers are recorded on the artifact; their data scope is managed in Audit & Governance.", "presets": [p[3] for p in PEOPLE[1:6]], "default": []},
                          "freshness": {"label": "Keep it fresh", "presets": [{"id": "open", "label": "Only when it’s opened", "sentence": "Only when it’s opened"}, {"id": "daily", "label": "Every weekday (Mon–Fri) at 7:00 AM", "sentence": "Every weekday at 7:00 AM"},
                                                                              {"id": "monday", "label": "Weekly on Monday at 6:00 AM", "sentence": "Weekly on Monday at 6:00 AM"}, {"id": "monthly", "label": "Monthly on the 1st at 6:00 AM", "sentence": "Monthly on the 1st at 6:00 AM"},
                                                                              {"id": "custom", "label": "Custom…", "sentence": "Custom schedule"}],
                                        "days": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "times": ["6:00 AM", "7:00 AM", "8:00 AM", "12:00 PM", "6:00 PM"], "units": ["day", "week", "month"], "default": "open",
                                        "default_detail": {"preset": "open", "every": 1, "unit": "week", "days": ["Mon"], "time": "6:00 AM"}, "no_day_error": "A custom weekly schedule with no day selected blocks publishing."},
                          "foot": "Live immediately after you publish.", "buttons": {"publish": "Publish report", "republish": "Publish changes", "cancel": "Cancel", "unpublish": "Unpublish", "manage": "Manage publishing…"}},
           "audit": {"copy": {"title": "Audit & Governance", "lead": "One place for who sees what. Authors decide who can open a report or scenario when they publish it; you decide which projects each person can see — and every open is logged.",
                              "not_enforced": "A rule is recorded, not enforced, until the server filters on it. No report on this demo serves a row a reader's rule excludes.",
                              "gates": [{"key": "open", "title": "Who can open", "detail": "May this viewer see that this report EXISTS? Set by the author at publish time, by email address."},
                                        {"key": "inside", "title": "What they see inside", "detail": "Data access per person, managed on the reader's row — project, category, depot, contract or funding source."},
                                        {"key": "log", "title": "Every open is logged", "detail": "Who opened what, what their access resolved to, and every access change — in the audit trail."}],
                              "empty_log": "Nothing recorded yet. Change a rule or open a report and it appears here.", "log_note": "Nothing in the log is editable; the trail is append-only.",
                              "basis_note": "A field qualifies as a restriction basis only if every one of its values is known on every row."},
                     "categories": [{"key": c["id"], "label": c["label"], "id": c["id"]} for c in audit()["categories"]], "events": audit()["events"],
                     "restriction_bases": [{"id": "proj", "label": "Project", "values": ROSTER}, {"id": "cat", "label": "Category", "values": 7}, {"id": "depot", "label": "Depot", "values": 3},
                                           {"id": "funding", "label": "Funding source", "values": 6}, {"id": "stage", "label": "Stage", "values": 6}],
                     "excluded_bases": {"fields": ["forecast", "variance", "budget", "actuals"], "reason": "Continuous. A rule written on them re-resolves every time a figure moves, so a reader's scope would change without anyone changing the rule."}},
           "document": {"document_id": "GOVERNANCE_AUDIT_KEOLIS", "file": "governance_audit_keolis.html", "title": "Context Weave — Audit & Governance · Keolis Valmont", "heading": "⛨ Audit & Governance",
                        "subtitle": "One place for who sees what. Authors decide who can open a report or scenario when they publish it; you decide which rows each reader may see.",
                        "tabs": [{"key": "0", "label": "Reports"}, {"key": "1", "label": "What-ifs"}, {"key": "2", "label": "Audit log"}],
                        "package": "keolis_demo_data_package_2026-09-24", "screen": "08 — Audit & Governance", "generated": TODAY, "roster_total": ROSTER}}
    contracts = [{"id": f"pkg_{slug_(no)}", "no": no, "project": f"p_{pc.lower().replace('-', '_')}", "projectCode": pc, "projectName": PBY[pc]["name"][:40], "title": t, "form": f, "role": r, "contractor": s,
                  "contractorId": f"org_{slug_(s)}", "value": v, "effective": eff, "doc": f"drive://{pc}/{doc}", "documentSource": "src_drive", "resolvedTo": "e_contract", "buildTime": True, "method": "extracted",
                  "methodNote": "Supplier, form, value and effective date read from the cover sheet."}
                 for no, pc, t, f, r, s, v, eff, doc in (
                     ("PO-4500018812", "P-VM-021", "Supply and installation of column lift set C", "Purchase order", "Supplier", "Levantis Équipements", 310_000, "2026-03-20", "PO-4500018812_Levantis_Supply_Install_Contract.pdf"),
                     ("VTC-2026-014", "P-VM-008", "Rail replacement T1 S07", "Works contract", "Contractor", "Voies & Travaux du Centre (VTC)", 2_180_000, "2026-07-01", "P-VM-008_Method_Statement_VTC.pdf"),
                     ("TRS-2024-OVH-01", "P-VM-005", "TV-100 mid-life overhaul", "Authority contract", "Overhaul contractor", OVERHAUL_PARTNER, 27_600_000, "2024-02-01", "TRS-2024-OVH-01_Overhaul_Contract_Transalp.pdf"),
                     ("VM-2025-BUS-02", "P-VM-014", "24 battery-electric buses", "Authority contract", "Manufacturer", "Arvéa Mobility", 12_960_000, "2025-04-15", "VM-2025-BUS-02_Delivery_Schedule_Rev3_Arvea.pdf"),
                     ("CES-2025-114", "P-VM-031", "40 traction battery packs", "Supply contract", "Supplier", "Celtia Energy Systems", 4_400_000, "2025-10-02", "Celtia_Battery_Warranty_Terms_CES-2025-114.pdf"))]
    changes = [{"id": "co_p_vm_005_rc_005_009", "ref": "RC-005-009", "project": "p_p_vm_005", "projectCode": "P-VM-005", "projectName": PBY["P-VM-005"]["name"][:40], "package": "TRS-2024-OVH-01", "packageId": "pkg_trs_2024_ovh_01",
                "value": 2_640_000, "days": 122, "kind": "Scope", "status": "submitted", "reason": "Bogie frame replacement after NDT findings", "contractor": OVERHAUL_PARTNER, "contractorId": "org_transalp_rail_services",
                "doc": "drive://P-VM-005/P-VM-005_Change_Request_RC-005-009_Bogie_Frames.pdf", "documentSource": "src_drive", "extractedConf": 0.95, "raised": "2026-06-24", "resolvedTo": "e_change_order", "buildTime": True,
                "note": "Resolved at BUILD time from the change request. Not approved — the forecast carries a €1.32M allowance, not the request.", "inForecast": False},
               {"id": "co_p_vm_008_revc", "ref": "REV-C", "project": "p_p_vm_008", "projectCode": "P-VM-008", "projectName": PBY["P-VM-008"]["name"][:40], "package": "VTC-2026-014", "packageId": "pkg_vtc_2026_014",
                "value": 0, "days": 0, "kind": "Scope", "status": "open", "reason": "Work limit extended to 4+010 (SIG-T1-044)", "contractor": "Voies & Travaux du Centre (VTC)", "contractorId": "org_voies_travaux_du_centre_vtc",
                "doc": "drive://P-VM-008/VM-T1-VOI-0457_RevC_Drawing_Revision_Note.pdf", "documentSource": "src_drive", "extractedConf": 0.93, "raised": "2026-09-09", "resolvedTo": "e_change_order", "buildTime": True,
                "note": "Scope change without a priced change order yet.", "inForecast": False}]
    fields = [{"key": k, "label": l, "kind": kd, "filterable": fl, "avail": True, "note": None} for k, l, kd, fl in (
        ("name", "Project", "text", False), ("cat", "Category", "cat", True), ("depot", "Depot", "cat", True), ("stage", "Stage", "cat", True), ("funding", "Funding", "cat", True),
        ("owner", "Owner", "cat", True), ("budget", "Approved budget", "num", False), ("forecast", "Forecast total", "num", False), ("variance", "Variance", "num", False),
        ("committed", "Open commitment", "num", False), ("sched", "Schedule variance (days)", "num", False), ("status", "Status", "cat", True))]
    summary = [{"key": k, "label": l, "tone": t, "agg": a, "field": f, "format": fm, "def": d, "scope_class": "sum" if a == "sum" else "count"} for k, l, t, a, f, fm, d in (
        ("count", "renewal projects in view", None, "rows", None, "int", "Projects the scope admits"), ("budget", "approved budget", None, "sum", "budget", "money_m", "Current approved version"),
        ("forecast", "forecast total", "warn", "sum", "forecast", "money_m", "Actuals + accruals + cost to complete"), ("variance", "variance", "crit", "sum", "variance", "money_m", "Forecast − approved"),
        ("committed", "open commitment", None, "sum", "committed", "money_m", "Ordered − received − cancelled"), ("late", "projects late vs baseline", "warn", "count_eq", "status", "int", "Schedule variance > 0"))]
    return {"meta": {"persona_name": "Amélie Roussel", "persona_role": "Contrôleuse de gestion investissements · Keolis Valmont", "persona_initials": "AR", "entity_plural": "renewal projects",
                     "scope_line": "the Keolis Valmont renewal portfolio (DSP-VM-2021)", "source_trace": "Traces to: keolis_valmont_erp.fin, keolis_valmont_erp.proc, keolis_valmont_ppm.ppm, keolis_valmont_eam.eam, as of 2026-09-19."},
            "fields": fields, "assumptions": {"scope": {"value": "active", "label": f"all {ROSTER} renewal projects"}, "measure": {"value": "envelope", "label": "approved budget"}, "horizon": {"value": "full", "label": "full project life"}},
            "opts": {"scope": {"q": "Which projects to include?", "options": [{"value": "active", "label": f"all {ROSTER} renewal projects", "d": "Everything in the portfolio"}, {"value": "major", "label": "major projects over €2M", "d": "The largest by budget"}]},
                     "measure": {"q": "\"Over budget\" measured against?", "options": [{"value": "envelope", "label": "approved budget", "d": "The current approved version"}, {"value": "baseline", "label": "original baseline", "d": "The first approved version"}, {"value": "ppi", "label": "PPI envelope", "d": "The authority's allocation"}]},
                     "horizon": {"q": "Over what period?", "options": [{"value": "thisyear", "label": "this financial year", "d": "To 31 December"}, {"value": "full", "label": "full project life", "d": "Whole project"}, {"value": "contract", "label": "to contract end", "d": "To 31 December 2028"}]}},
            "slice_default": ["cat", "depot", "stage", "status"], "summary_catalog": summary, "summary_default": [],
            "data": {"projects": roster, "contracts": contracts, "changeOrders": changes, "business_units": sorted({p["funding"] for p in PORTFOLIO}), "regions": [d["name"] for d in DEPOTS], "categories": sorted({p["cat"] for p in PORTFOLIO})},
            "reports": reps, "saved": [], "governance": gov,
            "authoring_fixture": prototype()["_fixture"],
            "register": {"roster": "projects", "identity": "n", "fields": [{"key": k, "label": l, "kind": kd, "filterable": fl, "avail": True, "note": None} for k, l, kd, fl in (("n", "Project", "text", False), ("reg", "Depot", "cat", True), ("cat", "Category", "cat", True), ("bu", "Funding", "cat", True), ("phase", "Stage", "cat", True), ("comp", "Mandatory", "cat", True))]},
            "documents": [{"document_id": f"R{i + 1}", "report_id": r["report_id"], "file": f"R{i + 1}_{r['report_tag'].replace('-', '_')}.html", "title": r["title"], "subtitle": r["subtitle"], "category": r["badge"],
                           "status": "published", "version": "v1", "slug": r["report_tag"], "author": "pp_garnier" if i == 0 else "pp_roussel", "refresh": ["Daily 07:00 UTC", "On open", "Monthly 1st 06:00"][i],
                           "updated_at": f"2026-09-2{2 + i % 2}T16:{10 + i:02d}:00Z", "spec_file": f"{r['title'].replace(' ', '_')}_Specification.html"} for i, r in enumerate(reps)],
            "authoring_document": "report_authoring_simplified_v3.html"}

def slug_(s):
    import re, unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

def prototype():
    rows = []
    for code, partner, contract, reason in (("P-VM-005", "Transalp", "Authority contract", "Frame cracking + indexation"), ("P-VM-014", "Arvéa", "Authority contract", "Inverter allocation delay"),
                                            ("P-VM-026", "Chargéo", "Design & build", "DSO reinforcement share"), ("P-VM-031", "Celtia", "Supply contract", "Acceptance snags"),
                                            ("P-VM-008", "VTC", "Works contract", "Access and rev C scope"), ("P-VM-017", "Électro-Réseaux Ouest", "Design & build", "Rectifier lead time"),
                                            ("P-VM-021", "Levantis", "Purchase order", "Control-unit delay")):
        p = PBY[code]
        auth, comm, proj = round(p["budget"] / 1e6, 2), round((p["actuals"] + p["accruals"] + p["committed"]) / 1e6, 2), round(p["forecast"] / 1e6, 2)
        varD = round(proj - auth, 2); varP = round(varD / auth * 100, 1) if auth else 0; pct = round(comm / auth * 100, 1) if auth else 0
        rows.append({"name": p["name"][:44], "auth": auth, "comm": comm, "proj": proj, "portfolio": p["cat"], "region": next(d["name"] for d in DEPOTS if d["id"] == p["depot"]), "phase": p["stage"],
                     "owner": p["owner"], "funding": p["funding"], "partner": partner, "contract": contract, "reason": reason, "varD": varD, "varP": varP, "pct": pct,
                     "status": "Delayed" if varP > 3 or p["schedule_var_days"] > 60 else ("At risk" if varP > 0 or p["schedule_var_days"] > 0 else "On track")})
    fixture = {"_note": "The seven-project fixture the authoring screen previews against. Figures in EUR millions, derived from world.py.",
               "projects": [{k: r[k] for k in ("name", "auth", "comm", "proj", "portfolio", "region", "phase", "owner", "funding", "partner", "contract", "reason")} for r in rows],
               "derived": {r["name"]: {"status": r["status"], "varianceDollarsM": r["varD"], "variancePct": r["varP"], "pctOfEnvelopeSpent": r["pct"]} for r in rows},
               "unit": "EUR millions", "derivationRules": {"varianceDollarsM": "projected - authorized", "variancePct": "(projected - authorized) / authorized * 100", "pctOfEnvelopeSpent": "committed / authorized * 100",
                                                           "status": "variancePct > 3 or schedule slip > 60 days -> Delayed; > 0 -> At risk; else On track", "forecastAtCompletion": "equals projected in this fixture"}}
    audiences = [{"key": r["role_id"], "label": r["label"], "d": r["access_note"]} for r in __import__("build_sources_catalog").AUTH_ROLES]
    return {"meta": {"persona_name": "Amélie Roussel", "persona_role": "Contrôleuse de gestion investissements · Keolis Valmont", "persona_initials": "AR", "entity_plural": "renewal projects",
                     "scope_line": "the Keolis Valmont renewal portfolio", "source_trace": "Traces to: keolis_valmont_erp.fin, keolis_valmont_ppm.ppm, keolis_valmont_ppm.contract, as of 2026-09-19.",
                     "entity_singular": "renewal project", "ask_placeholder": "e.g. Which renewal projects are furthest over their approved budget?"},
            "fields": [{"key": k, "label": l, "kind": kd, "filterable": fl} for k, l, kd, fl in (("name", "Project", "text", False), ("portfolio", "Category", "cat", True), ("region", "Depot", "cat", True), ("phase", "Stage", "cat", True),
                       ("owner", "Owner", "cat", True), ("funding", "Funding", "cat", True), ("partner", "Supplier", "cat", True), ("contract", "Contract form", "cat", True), ("reason", "Variance reason", "text", False),
                       ("auth", "Approved (€M)", "num", False), ("comm", "Committed + spent (€M)", "num", False), ("proj", "Forecast (€M)", "num", False), ("varD", "Variance (€M)", "num", False),
                       ("varP", "Variance %", "num", False), ("pct", "% of budget committed", "num", False), ("status", "Status", "cat", True))],
            "assumptions": {"scope": {"value": "active", "label": "the 7 anchor renewal projects"}, "measure": {"value": "varD", "label": "approved budget"}, "horizon": {"value": "full", "label": "full project life"}, "graph": {"value": "kv_sgr", "label": "the Keolis Valmont SGR graph"}},
            "opts": {"scope": {"q": "Which projects to include?", "options": [{"value": "active", "label": "the 7 anchor renewal projects", "d": "Everything with a decision pending"}, {"value": "major", "label": "major projects over €5M", "d": "The largest by budget"}]},
                     "measure": {"q": "\"Over budget\" measured against?", "options": [{"value": "varD", "label": "approved budget", "d": "The current approved version"}]},
                     "horizon": {"q": "Over what period?", "options": [{"value": "thisyear", "label": "this financial year", "d": "To 31 December"}, {"value": "full", "label": "full project life", "d": "Whole project"}, {"value": "contract", "label": "to contract end", "d": "To 31 December 2028"}]},
                     "graph": {"q": "Which published graph should this run against?", "options": [{"value": "kv_sgr", "label": "the Keolis Valmont SGR graph", "short": "Keolis Valmont SGR", "d": "Published · EAM + ERP + PPM + contract corpus · refreshed today"}]}},
            "generators": rows, "facilities": [], "quarters": [], "traces": [],
            "starters": [{"id": "rep_q_intervention", "report_tag": "intervention-review", "label": "Intervention Review", "title": "Intervention Review", "q": "Show which renewal projects need a decision, and refuse to rank them by one hidden score.", "spine": "generators",
                          "reading": {"template": "Using {graph}, over {scope}, by {measure}, {horizon}.", "slots": ["graph", "scope", "measure", "horizon"]},
                          "blocks": [{"type": "kpis", "title": "Summary", "kpis": ["count", "auth", "proj", "varD"]}, {"type": "chart", "title": "Ranked by measure", "chartType": "bar", "measure": "varD"}, {"type": "table", "title": "Detail", "cols": ["name", "status", "auth", "comm", "proj", "varD"]}]},
                         {"id": "rep_proj_360", "report_tag": "project-360", "label": "Project 360", "title": "Project 360", "q": "Give one project's full financial position with the provenance attached.", "spine": "generators",
                          "reading": {"template": "Using {graph}, over {scope}, by {measure}, {horizon}.", "slots": ["graph", "scope", "measure", "horizon"]},
                          "blocks": [{"type": "kpis", "title": "Summary", "kpis": ["count", "auth", "proj", "varD"]}, {"type": "chart", "title": "Ranked by measure", "chartType": "bar", "measure": "proj"}, {"type": "table", "title": "Detail", "cols": ["name", "status", "auth", "comm", "proj", "varD"]}]},
                         {"id": "rep_ppi_claim", "report_tag": "ppi-claim-pack", "label": "PPI Claim Pack", "title": "PPI Claim Pack", "q": "Show what can be claimed from the authority this quarter, and keep potential apart from claimed.", "spine": "generators",
                          "reading": {"template": "Using {graph}, over {scope}, by {measure}, {horizon}.", "slots": ["graph", "scope", "measure", "horizon"]},
                          "blocks": [{"type": "kpis", "title": "Summary", "kpis": ["count", "auth", "proj", "varD"]}, {"type": "chart", "title": "Ranked by measure", "chartType": "bar", "measure": "varD"}, {"type": "table", "title": "Detail", "cols": ["name", "status", "auth", "comm", "proj", "varD"]}]}],
            "presets": [{"label": "Summary tiles", "d": "Projects, budget, forecast, variance", "block": {"type": "kpis", "title": "Summary", "kpis": ["count", "auth", "proj", "varD"]}},
                        {"label": "Variance chart", "d": "Projects ranked by variance to approved budget", "block": {"type": "chart", "title": "Variance to budget by project", "chartType": "bar", "measure": "varD"}},
                        {"label": "Forecast chart", "d": "Forecast total per project", "block": {"type": "chart", "title": "Forecast by project", "chartType": "column", "measure": "proj"}},
                        {"label": "Project detail", "d": "One row per project, with status and the figures behind it", "block": {"type": "table", "title": "Detail", "cols": ["name", "status", "auth", "comm", "proj", "varD"]}}],
            "slice_default": ["portfolio", "region", "phase", "status"], "audiences": audiences, "library": [],
            "row_model": {"label": "name", "sublabel": "{portfolio} · {phase} · {owner}", "status": "status", "tones": {"Delayed": "over", "At risk": "warn", "On track": "ok"},
                          "scopes": {"active": {}, "major": {"field": "auth", "op": "gt", "value": 5}}, "measures": ["varD", "varP", "pct", "proj", "auth", "comm"],
                          "kpis": [{"key": "count", "label": "Projects in scope", "agg": "rows"}, {"key": "auth", "label": "Approved budget", "agg": "sum", "field": "auth", "format": "money_m"},
                                   {"key": "proj", "label": "Forecast total", "agg": "sum", "field": "proj", "format": "money_m"}, {"key": "varD", "label": "Variance to budget", "agg": "sum", "field": "varD", "format": "money_m"},
                                   {"key": "delayed", "label": "Delayed", "agg": "count_eq", "field": "status", "value": "Delayed", "tone": "bad"}, {"key": "atrisk", "label": "At risk", "agg": "count_eq", "field": "status", "value": "At risk", "tone": "warn"}],
                          "formats": {"auth": "money_m", "comm": "money_m", "proj": "money_m", "varD": "money_m", "varP": "pct", "pct": "pct", "status": "text"}, "labels": {}, "pills": {}, "blocks": ["kpis", "chart", "table"], "footer": []},
            "_fixture": fixture}

def build():
    rp = prototype(); rp.pop("_fixture")
    return {"whatif": whatif(), "audit": audit(), "traces": traces(), "evals": evals(), "reports": reports(), "reports_prototype": rp}

if __name__ == "__main__":
    b = build()
    print({k: len(v) for k, v in b.items()}, b["whatif"]["runtime"]["worked_examples"], b["whatif"]["headroom"])
