"""Longer bodies for the key corpus documents: full inventories, registers, measurement tables and
the articles around the clauses the answers rely on. Appended in place to corpus.DOCS."""
import random
from world import *
import corpus as C

R = random.Random(42)
X = lambda *a: a
def doc(did): return C.DOC[did]
def add(did, *blocks, extractions=()):
    d = doc(did)
    d["body"].extend(blocks)
    d["extractions"].extend(extractions)

# ---- DSP contract: definitions, service obligations, PPI mechanics, indexation, penalties, full Annex 7, Annex 9
inv = []
for key, f in FLEET.items():
    lo, hi = f["ids"]
    pre = "TRAM" if key.startswith("tram") else "BUS"
    for n in range(lo, hi + 1):
        if key == "bus_diesel_old": com, rep = "2011-07-01", "2026-06-30"
        elif key == "bus_diesel": com, rep = f"{2014 + (n - 101) // 30}-0{1 + (n % 9)}-01", f"{2029 + (n - 101) // 30}-06-30"
        elif key == "bus_hybrid": com, rep = f"{2018 + (n - 301) // 28}-03-01", f"{2033 + (n - 301) // 28}-03-01"
        elif key == "bus_bev": com, rep = "2020-09-01", "2035-09-01"
        elif key == "bus_bev_art": com, rep = "2022-09-01", "2037-09-01"
        elif key == "bus_cng": com, rep = "2016-05-01", "2031-05-01"
        elif key == "tram_tv100": com, rep = f"200{8 + (n - 101) // 12}-0{1 + (n % 9)}-15", "2039-12-31 (after mid-life overhaul)"
        else: com, rep = "2019-06-01", "2049-06-01"
        inv.append([f"{pre}-{n}", f["model"], com, rep])
add("DOC:dsp-vm-2021",
    ("h", "Article 1 — Definitions"),
    ("p", "“Annex 7 assets” means the assets listed in Annex 7 as updated under Article 12.2. “Contractual replacement date” means the date stated for a vehicle in Annex 7, as amended. “GER” means major maintenance (gros entretien) as defined in Annex 9. “PPI” means the Authority's multi-year investment plan and the convention implementing it."),
    ("h", "Article 10 — Service obligations"),
    ("p", "10.1 The Operator runs the service defined in Annex 3 (timetables, vehicle requirement by class, operating reserve). 10.2 The operating reserve is 10% of the peak requirement for 12 m buses, one vehicle for 18 m buses and two trams. 10.3 A planned withdrawal of service for works requires the Authority's prior approval of the access window and the substitution plan."),
    ("h", "Article 35 — Delegated project management of renewals"),
    ("p", "35.1 Where the Authority delegates the management of a renewal project to the Operator, the delegation letter states the scope, the budget and the milestones. 35.2 The Operator claims reimbursement quarterly, within 15 days of quarter end, with evidence of costs incurred and milestones achieved (acceptance records, invoices). 35.3 Work funded from the GER provision cannot be claimed under the PPI."),
    ("h", "Article 41 — Indexation"),
    ("p", "The contribution and the unit prices of Annex 9 are indexed annually on 1 January by the formula in Annex 10."),
    ("h", "Article 45 — Penalties"),
    ("p", "45.1 A vehicle requirement not met at peak for reasons attributable to the Operator gives rise to a penalty of €1,200 per missing vehicle per day. 45.2 Late submission of the annual report under Article 48 gives rise to a penalty of €500 per day."),
    ("h", "Article 48 — Annual report"),
    ("p", "The Operator submits the annual report of the delegate before 1 June each year, including the accounts of the delegation, the analysis of service quality, the Annex 7 inventory with its changes in the year and the renewal programme."),
    ("h", "Annex 7 — Inventory of rolling stock (extract, all vehicles)"),
    ("t", ["Asset", "Model", "Commissioned", "Contractual replacement date"], inv),
    ("h", "Annex 9 — GER thresholds and heavy components"),
    ("t", ["Item", "Rule"], [["GER threshold per intervention", "€3,000 HT (raised to €5,000 HT by Avenant n°2)"], ["Heavy components", "Engine, gearbox, traction battery, bogie"], ["GER provision 2021", "€1,450,000 HT per year, indexed (Art. 41)"]]),
    extractions=[X("Article 35.3 — GER cannot be claimed under the PPI", "Clause", "CLS:dsp_34_2", "Art. 35.3", "clause heading", 3, 0.95),
                 X("Operating reserve 10% (12 m buses)", "ServiceRequirement", "SRQ:bus_12m", "10%", "clause text", 2, 0.93),
                 X("Annual report before 1 June (Art. 48)", "Obligation", "CON:DSP-VM-2021", "1 June", "clause text", 3, 0.92)])

# ---- Tranche 2 business case: cost breakdown and risks
add("DOC:p-vm-014-business-case",
    ("h", "Cost breakdown"),
    ("t", ["Line", "EUR HT"], [["24 × Arvéa eCity 12 (contract VM-2025-BUS-02)", "12,960,000"], ["Share of depot charging bank 2 (P-VM-026)", "0"], ["Driver and technician training", "180,000"], ["Diagnostic tools and spares starter kit", "620,000"], ["Project management (Keolis Valmont, delegated)", "380,000"], ["Contingency", "740,000"], ["Total", "14,880,000"]]),
    ("h", "Risks"),
    ("t", ["Risk", "Consequence", "Mitigation"], [["Supplier component allocation", "Late delivery keeps series 201–216 in service past the replacement date", "Monthly supplier review; Article 34.4 notices on any heavy failure"], ["Charging bank 2 energisation", "Buses delivered but unable to run", "Dependency tracked with P-VM-026"], ["Winter range", "Duty reallocation on C1 and lines L03, L11", "Duty planning with service planning"]]))

# ---- Lift business case & PO: more detail
add("DOC:p-vm-021-business-case",
    ("h", "Options considered"),
    ("t", ["Option", "Cost", "Consequence"], [["Repair the HPU and keep 12 t rating", "€65,000", "Excludes articulated and battery-electric buses from bays 3–4"], ["Replace set C (selected)", "€400,000", "Restores 32 t rating; bays 3–4 for the hybrid overhaul campaign"], ["Defer", "€0", "Statutory restriction continues; campaign moved to an external workshop (~€90,000/year)"]]),
    ("h", "Schedule"),
    ("t", ["Milestone", "Date"], [["Order", "2026-03-20"], ["Civil works complete", "2026-09-04"], ["Columns delivered", "2026-09-08"], ["HPU-9 delivered", "2026-10-05"], ["Installation", "2026-10-12 → 2026-10-23"], ["Commissioning & statutory test", "2026-10-26"], ["Completion", "2026-10-30"]]))

# ---- Rail wear inspection: full measurement table every 20 m
rows = []
for i, ch in enumerate(range(3420, 3990, 20)):
    peak = 3500
    wear = max(40, 94 - abs(ch - peak) // 6 + R.randint(-3, 3))
    v = round(3.5 + wear / 25, 1); l = round(4.0 + wear / 9, 1)
    sev = "Replacement threshold reached" if wear >= 90 else ("Significant" if wear >= 72 else "Minor")
    rows.append([f"3+{ch - 3000:03d}", "both" if i % 2 == 0 else "outer rail", v, l, wear, sev])
add("DOC:ir-t1-2026-07",
    ("h", "Measurements — every 20 m"),
    ("t", ["Chainage", "Rail", "Vertical wear (mm)", "Lateral wear (mm)", "Wear index", "Finding"], rows),
    ("p", "Replacement threshold: wear index 90. Measurements by profile trolley, calibration certificate CAL-2026-0311. Scale 0–100; not comparable with the 1–5 condition scale used for substations."))

# ---- Commissioning pack: full acceptance register for all 40 vehicles
reg = []
for n in range(401, 441):
    b = f"BUS-{n}"
    if b == "BUS-417": res = ["Pass", "Present", "Open defect — BMS isolation fault E-214", "Not released"]
    elif b == "BUS-422": res = ["Pass", "MISSING", "Not accepted — certificate missing", "Not released"]
    elif b == "BUS-431": res = ["Fail", "Present", "Open defect — cell temperature spread", "Not released"]
    else: res = ["Pass", "Present", "Accepted", "Released"]
    reg.append([b, f"CES-420-26-{n - 300:04d}", f"2026-0{7 + (n - 401) // 20}-{10 + (n - 401) % 18:02d}"] + res)
add("DOC:p-vm-031-commissioning",
    ("h", "Acceptance register — all 40 vehicles"),
    ("t", ["Vehicle", "Pack serial", "Installed", "Capacity test", "IR test cert.", "Result", "Operations release"], reg),
    ("p", "Signed for acceptance: Damien Rocher, safety & commissioning, 18 September 2026. Release for duty: Karim Haddad, service planning."))

# ---- TV-100 option study & change request: NDT table
ndt = []
for n in range(101, 113):
    cracked = {101: 1, 102: 0, 103: 1, 104: 1, 105: 0, 106: 1, 107: 0, 108: 1, 109: 1, 110: 0, 111: 1, 112: 1}[n]
    ndt.append([f"TRAM-{n}", "batch 1" if n <= 108 else "batch 2", "2", str(cracked), "Frame replacement" if cracked else "Inspection only"])
add("DOC:rc-005-009",
    ("h", "NDT results — bogie frames"),
    ("t", ["Tram", "Batch", "Frames inspected", "Frames cracked", "Scope proposed"], ndt),
    ("p", "Batch 1 (trams 101–108): 5 of 16 frames cracked (31%). Batch 2 (trams 109–112): 3 of 8 frames cracked. Re-appraisal trigger in the option study: 10%."),
    extractions=[X("TRAM-101 frame cracked", "ConditionAssessment", "AST:TRAM-101", "cracked", "table row", 2, 0.9)])
add("DOC:p-vm-005-option-study",
    ("h", "Lifecycle cost comparison (15 years, constant 2023 prices)"),
    ("t", ["Option", "Capex", "Maintenance (15 y)", "Availability"], [["Repair on condition", "€9.8M", "€41.0M", "91%"], ["Mid-life overhaul", "€29.9M", "€28.4M", "96%"], ["Replace", "€96.0M", "€18.2M", "98%"]]),
    ("p", "Discount rate 4%, residual value excluded, funding perspective: the Authority (PPI). The operator's perspective differs: maintenance is inside the contract price until 2028."))

# ---- Minutes: fuller agenda
add("DOC:ppi-q2-2026-minutes",
    ("h", "5. Portfolio position"),
    ("t", ["Item", "Position stated at the meeting"], [["PPI 2026 appropriation", "€24.6M"], ["Claimed Q1", "€7.92M (paid)"], ["Claimed Q2", "€5.65M (submitted 15 July)"], ["Projects in delivery", "12"], ["Unfunded needs", "8 (incl. Les Aubiers fuel tank, mandatory)"]]),
    ("h", "6. AOB"),
    ("p", "The Authority asked for acceptance evidence to be attached to every claim line from Q3 onwards. Next review: 8 October 2026."))

# ---- SST-04: protection tests
add("DOC:sst-04-condition",
    ("t", ["Test", "Result", "Limit"], [["Rectifier group 1 — thermography", "58 °C hot spot", "< 70 °C"], ["Rectifier group 2 — thermography", "81 °C hot spot", "< 70 °C"], ["DC breaker trip time", "38 ms", "< 50 ms"], ["Earth fault protection", "Pass", "—"], ["Spares availability (group 2)", "None from manufacturer", "—"]]),
    ("p", "Recommendation: replace rectifier group 2 and the associated protection; keep group 1 under monitoring."))
