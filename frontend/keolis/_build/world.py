"""
Keolis Valmont — the single source of truth for the demo data package.

Every JSON section, upload file, corpus PDF and mailbox export is generated from the
values in this module. Change a figure here and rebuild; never hand-edit the outputs.

The operating contract, the authority, the city, the network, every asset, supplier,
person and amount are HYPOTHETICAL. The tenant is Keolis; nothing here describes a real
Keolis contract, a real authority or a real project result.
"""
from __future__ import annotations
import hashlib, random, datetime as dt

TODAY = "2026-09-24"
AS_OF = "2026-09-22"            # portfolio reporting cutoff used by answers
CLOSE = "2026-08-31"            # last certified month-end close (M08)
CUR = "EUR"
TAX_BASIS = "HT (excl. VAT)"

def md5_8(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()[:8]

def uuid5(s: str) -> str:
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "keolis-valmont/" + s))

def eur(v, dec=0):
    s = f"{abs(v):,.{dec}f}".replace(",", " ")
    return ("−" if v < 0 else "") + "€" + s

def eur_m(v, dec=1):
    return ("−" if v < 0 else "") + f"€{abs(v)/1e6:.{dec}f}M"

def eur_k(v):
    return ("−" if v < 0 else "") + f"€{abs(v)/1e3:,.0f}k".replace(",", " ")

# --------------------------------------------------------------------------- organisation
TENANT = "Keolis"
TENANT_LONG = "Keolis Valmont — operator of the Réseau Valmo"
GROUP = "Keolis (group)"
REGION = "Keolis France — Centre-Ouest region"
LEGAL_ENTITY = "Keolis Valmont SAS"
AUTHORITY = "Valmont Métropole"
AUTHORITY_ROLE = "Autorité organisatrice de la mobilité (AOM) — owns the network assets (biens de retour)"
NETWORK = "Réseau Valmo"
CITY = "Valmont"
OVERHAUL_PARTNER = "Transalp Rail Services"   # tram manufacturer-side overhaul partner

CONTRACT = {
    "id": "DSP-VM-2021",
    "title": "Délégation de service public — Réseau Valmo (urban public transport)",
    "parties": [AUTHORITY, LEGAL_ENTITY],
    "start": "2021-01-01", "end": "2028-12-31",
    "extension": "One optional 2-year extension at the authority's discretion (not exercised)",
    "pricing": "Contribution forfaitaire with revenue-risk sharing; GER (gros entretien) provision inside the contract price",
    "reporting_calendar": "Rapport annuel du délégataire (RAD) by 1 June; quarterly PPI review with the authority; monthly Keolis group capital review",
    "currency": "EUR, HT",
}
AMENDMENTS = [
    {"id": "DSP-VM-2021-AV1", "no": 1, "title": "Avenant n°1 — Chronovalmo C1 BHNS line added", "signed": "2022-06-14", "effective": "2022-09-01", "received": "2022-06-20",
     "summary": "Adds the C1 bus rapid transit line and 14 articulated battery-electric buses to the inventory (Annex 7)."},
    {"id": "DSP-VM-2021-AV2", "no": 2, "title": "Avenant n°2 — GER threshold and heavy-component rule", "signed": "2024-03-05", "effective": "2024-04-01", "received": "2024-03-11",
     "summary": "Raises the per-intervention GER threshold to €5,000 and restates Article 34.4 on heavy-component repairs after a vehicle's contractual replacement date (cap €35,000 per vehicle per event, 30-day notice)."},
    {"id": "DSP-VM-2021-AV3", "no": 3, "title": "Avenant n°3 — Annex 7 replacement dates, series BUS-209 to BUS-216", "signed": "2026-03-27", "effective": "2026-04-01", "received": "2026-04-18",
     "summary": "Moves the contractual replacement date of BUS-209 to BUS-216 from 30 June 2026 to 31 December 2026. BUS-201 to BUS-208 are unchanged at 30 June 2026."},
]

# --------------------------------------------------------------------------- people (demo directory)
# Emails stay on the demo domain: the login resolves against settings.users.
PEOPLE = [
    # id, role_id, name, email, title, persona label
    (1, "business_user_exec", "Nishant Srivastav", "nishant.srivastav@vriodigital.com", "Presenter (demo login)", "Business User · Executive"),
    (2, "business_user_exec", "Claire Moreau", "claire.moreau@vriodigital.com", "Directrice générale, Keolis Valmont", "Business User · Executive"),
    (3, "analyst", "Amélie Roussel", "amelie.roussel@vriodigital.com", "Contrôleuse de gestion investissements (finance)", "Data Analyst"),
    (4, "architect", "Thomas Garnier", "thomas.garnier@vriodigital.com", "Data & AI architect, Keolis France", "Domain Architect"),
    (5, "analyst", "Julien Faure", "julien.faure@vriodigital.com", "Responsable maintenance matériel roulant", "Data Analyst"),
    (6, "business_user_exec", "Inès Benali", "ines.benali@vriodigital.com", "Cheffe de projets investissements — infrastructure", "Business User · Project Level"),
    (7, "admin", "Marc Delorme", "marc.delorme@vriodigital.com", "Platform administrator", "Platform Admin"),
]
def person(name):
    return next(p for p in PEOPLE if p[2] == name)

# Named business owners inside the fictional operation (appear in documents, schedules and mail)
OWNERS = {
    "dg": "Claire Moreau",
    "maint_rs": "Julien Faure",           # rolling stock maintenance
    "infra_pm": "Inès Benali",           # infrastructure projects
    "fleet_pm": "Hugo Lambert",          # fleet renewal project manager
    "depot_mgr": "Sandrine Pelletier",   # Les Aubiers depot manager
    "controller": "Amélie Roussel",
    "ops_planning": "Karim Haddad",      # service planning (méthodes exploitation)
    "commercial": "Valérie Chauvin",     # contract & commercial
    "authority_pm": "Olivier Mercier",   # Valmont Métropole — direction des mobilités, PPI lead
    "authority_fin": "Nathalie Brun",    # Valmont Métropole — finance
    "tram_eng": "Pierre-Yves Collin",    # tram engineering lead
    "procurement": "Laura Petit",
    "safety": "Damien Rocher",           # safety & commissioning
}

# --------------------------------------------------------------------------- network & sites
DEPOTS = [
    {"id": "DEP-AUB", "name": "Dépôt Les Aubiers", "kind": "Bus depot and heavy workshop", "capacity": 140, "bays": 9},
    {"id": "DEP-SRO", "name": "Dépôt Saint-Roch", "kind": "Bus depot with e-bus charging", "capacity": 90, "bays": 4},
    {"id": "DEP-CMT", "name": "Centre de maintenance tram La Varenne", "kind": "Tram depot and workshop", "capacity": 36, "bays": 6},
]
LINES = [
    {"id": "T1", "name": "Tram T1 — Gare Centrale ↔ Technopole", "mode": "Tram", "km": 14.2},
    {"id": "T2", "name": "Tram T2 — Les Rives ↔ Hôpital Nord", "mode": "Tram", "km": 11.6},
    {"id": "C1", "name": "Chronovalmo C1 (BHNS)", "mode": "Bus rapid transit", "km": 9.8},
] + [{"id": f"L{n:02d}", "name": f"Bus line {n}", "mode": "Bus", "km": 0} for n in range(1, 19)]

FLEET = {
    "bus_diesel": {"label": "Diesel Euro VI 12 m", "model": "Arvéa Citybus 12 D", "count": 90, "ids": (101, 190)},
    "bus_diesel_old": {"label": "Diesel Euro V 12 m (series 201–216)", "model": "Arvéa Citybus 12 D (2011)", "count": 16, "ids": (201, 216)},
    "bus_hybrid": {"label": "Hybrid 12 m", "model": "Norvane HX12", "count": 56, "ids": (301, 356)},
    "bus_bev": {"label": "Battery-electric 12 m", "model": "Arvéa eCity 12", "count": 40, "ids": (401, 440)},
    "bus_bev_art": {"label": "Battery-electric articulated 18 m (C1)", "model": "Arvéa eCity 18", "count": 14, "ids": (501, 514)},
    "bus_cng": {"label": "CNG 12 m", "model": "Norvane GX12", "count": 12, "ids": (601, 612)},
    "tram_tv100": {"label": "Tram TV-100 (2008–09)", "model": "Transalp TV-100", "count": 24, "ids": (101, 124)},
    "tram_tv200": {"label": "Tram TV-200 (2019)", "model": "Transalp TV-200", "count": 8, "ids": (201, 208)},
}
BUS_TOTAL = sum(v["count"] for k, v in FLEET.items() if k.startswith("bus"))
TRAM_TOTAL = sum(v["count"] for k, v in FLEET.items() if k.startswith("tram"))
PEAK = {"bus_12m": 168, "bus_18m": 12, "tram": 26}
RESERVE_POLICY = {"bus_12m": 0.10, "bus_18m": 1, "tram": 2}

# --------------------------------------------------------------------------- worked example A — BUS-204
EX_A = {
    "asset": "BUS-204", "vin": "VF7AR12D0B4000204", "commissioned": "2011-07-01",
    "replacement_date": "2026-06-30", "replacement_basis": "DSP-VM-2021 Annex 7, line 204 (unchanged by Avenant n°3)",
    "tranche_delivery_planned": "2026-06-15", "tranche_delivery_forecast": "2026-09-30",
    "failure_at": "2026-07-12T06:48:00", "failure": "Engine seizure — loss of oil pressure on line L07, vehicle towed to Les Aubiers",
    "wo": "WO-2026-071244", "estimate": 28000, "estimate_supplier": "Moteurs Service Ouest (engine rebuild quote Q-26-1187)",
    "clause": "Article 34.4 (as restated by Avenant n°2)", "cap": 35000, "threshold": 5000, "notice_days": 30,
    "notice_sent": "2026-07-29", "notice_ref": "KV-DIR-2026-0412",
    "authority_ack": "2026-08-03", "authority_decision": None,
    "causation_question": "The EAM record shows the 60,000 km oil-analysis task overdue by 2,400 km at failure. Article 34.4 excludes failures caused by the operator's maintenance default — unresolved until engineering and commercial review.",
    "posted_cost": 0, "po": None,
}

# --------------------------------------------------------------------------- worked example B — depot lift
EX_B = {
    "project": "P-VM-021", "asset": "LIFT-AUB-03",
    "budget": 400000, "actuals": 160000, "accruals": 20000, "committed_remaining": 150000,
    "uncommitted_remaining": 40000, "contingency": 20000,
    "supplier": "Levantis Équipements", "po": "PO-4500018812", "po_line": "PO-4500018812/30",
    "part": "Hydraulic power & control unit HPU-9 (column lift set C)",
    "promised": "2026-10-05", "new_promise": "2026-10-19", "message_date": "2026-09-16",
    "schedule_install": "2026-10-12", "schedule_commission": "2026-10-26", "schedule_complete": "2026-10-30",
    "dependent_campaign": "Hybrid mid-life overhaul campaign (12 × Norvane HX12), bays 3–4, starts 2026-11-02",
    "temp_external_maint": 25000,
}
EX_B["forecast_total"] = EX_B["actuals"] + EX_B["accruals"] + EX_B["committed_remaining"] + EX_B["uncommitted_remaining"] + EX_B["contingency"]
assert EX_B["forecast_total"] == 390000

# --------------------------------------------------------------------------- worked example C — T1 track segment
EX_C = {
    "project": "P-VM-008", "segment": "TRK-T1-S07", "from_ch": "3+420", "to_ch": "3+980", "to_ch_revC": "4+010",
    "section": "Gare Centrale ↔ Pont Neuf", "closure": "2026-10-17 04:30 → 2026-10-19 04:30",
    "closure_status": "provisional", "access_ref": "ACC-T1-2026-031",
    "drawing": "VM-T1-VOI-0457", "rev_prev": "B", "rev": "C", "rev_date": "2026-09-09",
    "adjacent_signal": "SIG-T1-044", "affected_trams": 118, "replacement_buses": 14, "drivers": 9,
    "contractor": "Voies & Travaux du Centre (VTC)", "mobilisation": "2026-10-12",
}

# --------------------------------------------------------------------------- worked example D — battery campaign
EX_D = {
    "project": "P-VM-031", "installed": 40, "accepted": 37, "duty_eligible": 37,
    "open_defects": [("BUS-417", "BMS isolation fault code E-214 on second charge cycle"), ("BUS-431", "Cell-module temperature spread > 8 °C at 80% SoC")],
    "missing_cert": ("BUS-422", "Insulation-resistance test certificate (IR-500V) not in the commissioning pack"),
    "supplier": "Celtia Energy Systems", "warranty_years": 8,
}

# --------------------------------------------------------------------------- the portfolio
# Hand-authored anchor projects. Amounts in EUR, HT.
# stage: Need · Option study · Approved · In delivery · Commissioning · Accepted
# funding: PPI (authority capital programme, reimbursed on claim) · GER (inside contract price, Keolis bears)
#          · GRANT (state/ADEME grant, via authority) · MIXED
ANCHORS = [
    dict(code="P-VM-014", name="Bus fleet renewal — tranche 2 (24 battery-electric 12 m)", cat="Fleet — bus", asset_class="Bus",
         stage="In delivery", funding="PPI + GRANT", payer="Valmont Métropole", mo="Valmont Métropole (Keolis delegated project management)",
         budget=14_880_000, actuals=9_420_000, accruals=310_000, committed=4_760_000, uncommitted=180_000, contingency=240_000,
         baseline_finish="2026-06-15", forecast_finish="2026-09-30", sgr=0.75, expansion=0.0, transition=0.25,
         owner="Hugo Lambert", depot="DEP-SRO", flags=["supplier delay", "mandatory date"],
         why="Replaces series BUS-201–216, whose contractual replacement dates fall on 30 June 2026 (BUS-201–208) and 31 December 2026 (BUS-209–216, Avenant n°3)."),
    dict(code="P-VM-021", name="Lift replacement — Dépôt Les Aubiers (column lift set C)", cat="Depot & workshop", asset_class="Depot equipment",
         stage="In delivery", funding="GER", payer="Keolis Valmont", mo="Keolis Valmont",
         budget=400_000, actuals=160_000, accruals=20_000, committed=150_000, uncommitted=40_000, contingency=20_000,
         baseline_finish="2026-10-30", forecast_finish="2026-10-30", sgr=1.0, expansion=0.0, transition=0.0,
         owner="Sandrine Pelletier", depot="DEP-AUB", flags=["supplier delay", "schedule conflict"],
         why="Column lift set C failed its 2025 statutory inspection with a restriction to 12 t; bays 3–4 carry the hybrid overhaul campaign."),
    dict(code="P-VM-008", name="T1 track renewal — Gare Centrale ↔ Pont Neuf (TRK-T1-S07)", cat="Track & civil", asset_class="Track",
         stage="Approved", funding="PPI", payer="Valmont Métropole", mo="Keolis Valmont (delegated)",
         budget=3_260_000, actuals=410_000, accruals=0, committed=2_180_000, uncommitted=520_000, contingency=150_000,
         baseline_finish="2026-11-20", forecast_finish="2026-11-20", sgr=1.0, expansion=0.0, transition=0.0,
         owner="Inès Benali", depot="DEP-CMT", flags=["unresolved approval", "scope change", "service consequence"],
         why="Rail head wear on the curve at chainage 3+500 reached the replacement threshold (inspection IR-T1-2026-07); speed restriction 30 km/h in force."),
    dict(code="P-VM-031", name="Battery replacement campaign — Arvéa eCity 12 (40 packs)", cat="Fleet — bus", asset_class="Bus component",
         stage="Commissioning", funding="MIXED", payer="Keolis Valmont 60% / Valmont Métropole 40%", mo="Keolis Valmont",
         budget=5_120_000, actuals=4_610_000, accruals=180_000, committed=210_000, uncommitted=40_000, contingency=60_000,
         baseline_finish="2026-08-31", forecast_finish="2026-10-15", sgr=1.0, expansion=0.0, transition=0.0,
         owner="Julien Faure", depot="DEP-SRO", flags=["acceptance incomplete"],
         why="State-of-health below 78% on the first-generation packs; the fleet cannot hold C1/L-line duty range in winter."),
    dict(code="P-VM-005", name="Tram TV-100 mid-life overhaul (24 trams)", cat="Fleet — tram", asset_class="Tram",
         stage="In delivery", funding="PPI", payer="Valmont Métropole", mo="Valmont Métropole (Transalp Rail Services overhaul contract)",
         budget=31_200_000, actuals=12_640_000, accruals=690_000, committed=14_900_000, uncommitted=3_450_000, contingency=1_300_000,
         baseline_finish="2028-03-31", forecast_finish="2028-07-31", sgr=1.0, expansion=0.0, transition=0.0,
         owner="Pierre-Yves Collin", depot="DEP-CMT", flags=["cost growth", "schedule slip"],
         why="Bogie frame cracking found on 5 of the first 8 trams (NDT campaign 2025) — scope grew from inspection to frame replacement."),
    dict(code="P-VM-017", name="Traction substation SST-04 renewal (Pont Neuf)", cat="Power & charging", asset_class="Traction power",
         stage="Approved", funding="PPI", payer="Valmont Métropole", mo="Keolis Valmont (delegated)",
         budget=2_450_000, actuals=180_000, accruals=0, committed=1_320_000, uncommitted=820_000, contingency=130_000,
         baseline_finish="2027-04-30", forecast_finish="2027-06-30", sgr=1.0, expansion=0.0, transition=0.0,
         owner="Inès Benali", depot="DEP-CMT", flags=["supplier delay"],
         why="Rectifier group 2 obsolete (manufacturer end of support 2025); two trips in 2026 H1 with T1 service loss."),
    dict(code="P-VM-026", name="Depot charging expansion — Saint-Roch (24 depot chargers)", cat="Power & charging", asset_class="Charging",
         stage="In delivery", funding="GRANT + PPI", payer="Valmont Métropole", mo="Keolis Valmont (delegated)",
         budget=4_300_000, actuals=2_950_000, accruals=140_000, committed=1_160_000, uncommitted=210_000, contingency=90_000,
         baseline_finish="2026-07-31", forecast_finish="2026-10-31", sgr=0.0, expansion=0.2, transition=0.8,
         owner="Hugo Lambert", depot="DEP-SRO", flags=["dependency", "funding gap"],
         why="Tranche 2 buses cannot enter service without the second charging bank; grid connection energisation date moved by the DSO."),
    dict(code="P-VM-012", name="Operations support system (SAEIV) renewal", cat="Signalling & systems", asset_class="Systems",
         stage="Option study", funding="PPI", payer="Valmont Métropole", mo="Valmont Métropole",
         budget=0, actuals=65_000, accruals=0, committed=0, uncommitted=6_800_000, contingency=0,
         baseline_finish="2028-12-31", forecast_finish="2028-12-31", sgr=0.8, expansion=0.0, transition=0.2,
         owner="Karim Haddad", depot="DEP-AUB", flags=["unfunded", "obsolescence"],
         why="Vendor end of support for the on-board units in December 2027; no approved budget yet — option study only."),
]

# Additional projects generated deterministically so the portfolio has realistic breadth.
_FILL = [
    ("Bus mid-life overhaul — hybrids HX12 (12 vehicles)", "Fleet — bus", "Bus", "Approved", "GER", "Keolis Valmont", "Julien Faure", "DEP-AUB"),
    ("Tram TV-200 wheel-lathe renewal", "Depot & workshop", "Depot equipment", "In delivery", "PPI", "Valmont Métropole", "Pierre-Yves Collin", "DEP-CMT"),
    ("T2 track renewal — Les Rives curve (TRK-T2-S03)", "Track & civil", "Track", "Need", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Tram stop accessibility — 6 platforms (PMR)", "Stations & passenger info", "Stations", "In delivery", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Passenger information displays — 120 stops", "Stations & passenger info", "Systems", "In delivery", "PPI", "Valmont Métropole", "Karim Haddad", "DEP-AUB"),
    ("Ticket validators replacement (contactless EMV)", "Signalling & systems", "Systems", "Accepted", "PPI", "Valmont Métropole", "Karim Haddad", "DEP-AUB"),
    ("Bus washing plant — Les Aubiers", "Depot & workshop", "Depot equipment", "Commissioning", "GER", "Keolis Valmont", "Sandrine Pelletier", "DEP-AUB"),
    ("Depot fire-detection upgrade — Saint-Roch (battery hall)", "Depot & workshop", "Depot facility", "In delivery", "PPI", "Valmont Métropole", "Hugo Lambert", "DEP-SRO"),
    ("Traction substation SST-07 protection relays", "Power & charging", "Traction power", "Accepted", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Overhead contact line renewal — T2 depot fan", "Power & charging", "Traction power", "Approved", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Tram signalling interlocking — La Varenne junction", "Signalling & systems", "Signalling", "Option study", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("CNG compressor station overhaul", "Power & charging", "Depot equipment", "Accepted", "GER", "Keolis Valmont", "Sandrine Pelletier", "DEP-AUB"),
    ("Tram door-drive retrofit — TV-100", "Fleet — tram", "Tram component", "In delivery", "GER", "Keolis Valmont", "Pierre-Yves Collin", "DEP-CMT"),
    ("Bus CCTV renewal — 90 diesel vehicles", "Fleet — bus", "Bus component", "In delivery", "PPI", "Valmont Métropole", "Julien Faure", "DEP-AUB"),
    ("Depot roof and drainage — CMT La Varenne", "Depot & workshop", "Depot facility", "Approved", "PPI", "Valmont Métropole", "Pierre-Yves Collin", "DEP-CMT"),
    ("C1 BHNS platform resurfacing (11 stations)", "Stations & passenger info", "Stations", "Need", "PPI", "Valmont Métropole", "Inès Benali", "DEP-SRO"),
    ("Tram track drainage — T1 Technopole", "Track & civil", "Track", "Accepted", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Workshop crane 10 t — CMT La Varenne", "Depot & workshop", "Depot equipment", "Accepted", "GER", "Keolis Valmont", "Pierre-Yves Collin", "DEP-CMT"),
    ("Bus fleet renewal — tranche 3 (20 vehicles, 2027)", "Fleet — bus", "Bus", "Option study", "PPI + GRANT", "Valmont Métropole", "Hugo Lambert", "DEP-AUB"),
    ("Radio (TETRA) terminals renewal", "Signalling & systems", "Systems", "Approved", "PPI", "Valmont Métropole", "Karim Haddad", "DEP-AUB"),
    ("Tram pantograph overhaul — TV-200", "Fleet — tram", "Tram component", "Accepted", "GER", "Keolis Valmont", "Pierre-Yves Collin", "DEP-CMT"),
    ("Rail grinding programme 2026", "Track & civil", "Track", "In delivery", "GER", "Keolis Valmont", "Inès Benali", "DEP-CMT"),
    ("Depot access control — all sites", "Depot & workshop", "Depot facility", "Commissioning", "PPI", "Valmont Métropole", "Sandrine Pelletier", "DEP-AUB"),
    ("Hybrid battery module replacement (HX12, 20 packs)", "Fleet — bus", "Bus component", "Need", "GER", "Keolis Valmont", "Julien Faure", "DEP-AUB"),
    ("Tram stop shelters and lighting — T2", "Stations & passenger info", "Stations", "Approved", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Traction substation SST-02 transformer", "Power & charging", "Traction power", "Need", "PPI", "Valmont Métropole", "Inès Benali", "DEP-CMT"),
    ("Workshop diagnostic benches (e-bus)", "Depot & workshop", "Depot equipment", "Accepted", "GER", "Keolis Valmont", "Julien Faure", "DEP-SRO"),
    ("Tram TV-100 air-conditioning retrofit", "Fleet — tram", "Tram component", "Option study", "PPI", "Valmont Métropole", "Pierre-Yves Collin", "DEP-CMT"),
    ("Bus stop accessibility — 40 stops", "Stations & passenger info", "Stations", "In delivery", "PPI", "Valmont Métropole", "Inès Benali", "DEP-AUB"),
    ("Depot fuel tank replacement — Les Aubiers", "Depot & workshop", "Depot facility", "Need", "PPI", "Valmont Métropole", "Sandrine Pelletier", "DEP-AUB"),
]

def _build_portfolio():
    rnd = random.Random(20260924)
    out = [dict(p) for p in ANCHORS]
    n = 40
    for i, (name, cat, ac, stage, funding, payer, owner, depot) in enumerate(_FILL):
        code = f"P-VM-{n + i:03d}"
        base = rnd.choice([180_000, 260_000, 340_000, 420_000, 610_000, 780_000, 950_000, 1_240_000, 1_680_000, 2_100_000, 2_900_000])
        if stage == "Need":
            budget, act, acc, com, unc, cont = 0, 0, 0, 0, base, 0
        elif stage == "Option study":
            budget, act, acc, com, unc, cont = 0, rnd.choice([12_000, 24_000, 38_000]), 0, 0, base, 0
        else:
            budget = base
            prog = {"Approved": 0.08, "In delivery": rnd.uniform(0.3, 0.7), "Commissioning": 0.88, "Accepted": 0.97}[stage]
            growth = rnd.choice([0.94, 0.97, 0.99, 1.0, 1.0, 1.02, 1.04, 1.07, 1.12])
            fc = round(base * growth / 1000) * 1000
            act = round(fc * prog / 1000) * 1000
            acc = round(fc * rnd.uniform(0, 0.03) / 1000) * 1000 if stage in ("In delivery", "Commissioning") else 0
            cont = round(base * (0.04 if stage in ("Approved", "In delivery") else 0.0) / 1000) * 1000
            rem = max(fc - act - acc - cont, 0)
            com = round(rem * (0.7 if stage != "Accepted" else 1.0) / 1000) * 1000
            unc = rem - com
        y = rnd.choice([2026, 2026, 2027, 2027, 2028])
        bf = f"{y}-{rnd.choice(['03-31', '06-30', '09-30', '12-15'])}"
        slip = rnd.choice([0, 0, 0, 0, 30, 61, 92]) if stage in ("Approved", "In delivery", "Commissioning") else 0
        ff = (dt.date.fromisoformat(bf) + dt.timedelta(days=slip)).isoformat()
        tr = 0.6 if "charging" in name.lower() or "battery" in name.lower() else 0.0
        out.append(dict(code=code, name=name, cat=cat, asset_class=ac, stage=stage, funding=funding, payer=payer,
                        mo=payer if payer != "Keolis Valmont" else "Keolis Valmont", budget=budget, actuals=act, accruals=acc,
                        committed=com, uncommitted=unc, contingency=cont, baseline_finish=bf, forecast_finish=ff,
                        sgr=round(1 - tr, 2), expansion=0.0, transition=tr, owner=owner, depot=depot, flags=[], why=""))
    # Estimates for projects not yet funded, aligned with the needs register
    EST = {"P-VM-058": 9_600_000, "P-VM-042": 1_950_000, "P-VM-065": 1_240_000, "P-VM-067": 2_900_000,
           "P-VM-069": 420_000, "P-VM-063": 780_000, "P-VM-055": 610_000, "P-VM-050": 1_850_000}
    for p in out:
        if p["code"] in EST:
            p["uncommitted"] = EST[p["code"]]
    DATES = {"P-VM-040": ("2027-03-31", "2027-03-31"), "P-VM-068": ("2026-10-30", "2026-12-15"),
             "P-VM-044": ("2027-06-30", "2027-09-30"), "P-VM-047": ("2027-12-15", "2028-01-14"), "P-VM-043": ("2027-03-31", "2027-06-30")}
    for p in out:
        if p["code"] in DATES:
            p["baseline_finish"], p["forecast_finish"] = DATES[p["code"]]
    # Projects that deliberately have NO current forecast (completeness caveat for "are we within budget?")
    for p in out:
        p["forecast_available"] = True
    for code in ("P-VM-046", "P-VM-053", "P-VM-061", "P-VM-064"):
        for p in out:
            if p["code"] == code:
                p["forecast_available"] = False
    for p in out:
        p["forecast"] = p["actuals"] + p["accruals"] + p["committed"] + p["uncommitted"] + p["contingency"]
        p["ctc"] = p["committed"] + p["uncommitted"] + p["contingency"]
        p["variance"] = p["forecast"] - p["budget"] if p["budget"] else None
        bf, ff = dt.date.fromisoformat(p["baseline_finish"]), dt.date.fromisoformat(p["forecast_finish"])
        p["schedule_var_days"] = (ff - bf).days
        p["open_commitment"] = p["committed"]
    return out

PORTFOLIO = _build_portfolio()

# Variance drivers for the two projects whose forecast moved most (evidenced, EUR)
DRIVERS = {
    "P-VM-005": [("Frame replacement allowance, trams 101–112 (RC-005-009 not approved — carried as uncommitted scope)", 1_320_000, "scope"),
                 ("Contract price indexation 2026 (Transalp TRS-2024-OVH-01, clause 9)", 340_000, "rate"),
                 ("Extended depot support for 4 extra months", 120_000, "timing")],
    "P-VM-026": [("DSO grid reinforcement share (disputed as outside PPI scope)", 212_000, "scope"),
                 ("Cable route change at Saint-Roch entrance", 38_000, "quantity")],
}
PBY = {p["code"]: p for p in PORTFOLIO}

def portfolio_totals():
    funded = [p for p in PORTFOLIO if p["budget"] > 0]
    unfunded = [p for p in PORTFOLIO if p["budget"] == 0]
    return dict(
        projects=len(PORTFOLIO), funded=len(funded), unfunded=len(unfunded),
        budget=sum(p["budget"] for p in funded),
        forecast=sum(p["forecast"] for p in funded),
        actuals=sum(p["actuals"] for p in PORTFOLIO),
        accruals=sum(p["accruals"] for p in PORTFOLIO),
        committed=sum(p["committed"] for p in funded),
        backlog_estimate=sum(p["uncommitted"] for p in unfunded),
        no_forecast=[p["code"] for p in PORTFOLIO if not p["forecast_available"]],
    )

# FY2026 capital plan (calendar-year fiscal) — monthly phasing for the funded portfolio (EUR)
FY26_PLAN_MONTHLY = [2.9e6, 3.1e6, 3.6e6, 3.4e6, 3.8e6, 4.2e6, 3.3e6, 2.6e6, 4.4e6, 4.6e6, 4.1e6, 4.5e6]
FY26_ACT_MONTHLY = [2.6e6, 2.8e6, 3.2e6, 3.5e6, 3.1e6, 3.6e6, 2.9e6, 2.1e6]  # Jan–Aug certified
FY26_FC_MONTHLY_REMAINING = [4.0e6, 4.3e6, 3.9e6, 4.8e6]                   # Sep–Dec working forecast

# Funding and recovery (claims to the authority under the PPI)
CLAIMS = [
    # id, project, submitted, amount, status, note
    ("CLM-2026-Q1-01", "P-VM-005", "2026-04-15", 3_820_000, "paid", "Q1 PPI claim — overhaul milestones M3–M5"),
    ("CLM-2026-Q1-02", "P-VM-014", "2026-04-15", 4_100_000, "paid", "Q1 PPI claim — tranche 2 deposit and first 6 buses"),
    ("CLM-2026-Q2-01", "P-VM-005", "2026-07-15", 2_960_000, "accepted", "Q2 PPI claim — overhaul milestones M6–M7; payment due 2026-09-30"),
    ("CLM-2026-Q2-02", "P-VM-026", "2026-07-15", 1_480_000, "disputed", "Q2 claim — charging bank 1; authority disputes €212,000 of grid-connection works as outside eligible scope"),
    ("CLM-2026-Q2-03", "P-VM-031", "2026-07-15", 1_210_000, "submitted", "Q2 claim — authority's 40% share of battery campaign; acceptance evidence requested"),
    ("CLM-2026-Q3-01", "P-VM-008", None, 380_000, "potential", "Q3 — T1 track works, not yet claimable (works not started)"),
    ("CLM-2026-Q3-02", "N-VM-044", None, 28_000, "potential", "Potential Article 34.4 recovery — BUS-204 engine (under review, not claimed)"),
]

# Candidate needs / backlog (validated needs not yet completed)
NEEDS = [
    ("N-VM-044", "BUS-204 engine replacement after contractual replacement date", "BUS-204", "Failure after replacement date", 28_000, "Under review", "Julien Faure"),
    ("N-VM-039", "SAEIV on-board unit obsolescence (end of support Dec 2027)", "SYS-SAE-01", "Obsolescence notice", 6_800_000, "Option study", "Karim Haddad"),
    ("N-VM-041", "T2 Les Rives curve — rail wear approaching threshold", "TRK-T2-S03", "Inspection finding", 1_950_000, "Unfunded", "Inès Benali"),
    ("N-VM-042", "SST-02 transformer insulation degradation", "SST-02", "Condition assessment", 1_240_000, "Unfunded", "Inès Benali"),
    ("N-VM-043", "Hybrid HX12 battery modules — SoH trend", "BUS-3xx", "Telemetry trend", 780_000, "Deferred to 2027", "Julien Faure"),
    ("N-VM-045", "C1 platform surface defects (11 stations)", "STN-C1-*", "Inspection finding", 610_000, "Unfunded", "Inès Benali"),
    ("N-VM-046", "Les Aubiers fuel tank — leak test failed 2026-05", "DEP-AUB-TNK", "Regulatory inspection", 420_000, "Mandatory — unfunded", "Sandrine Pelletier"),
    ("N-VM-047", "TV-100 air-conditioning — passenger complaints summer 2026", "TRAM-1xx", "Service complaint", 2_900_000, "Option study", "Pierre-Yves Collin"),
]

# Suppliers
SUPPLIERS = [
    ("SUP-0107", "Arvéa Mobility", "Bus manufacturer — tranche 2 supply (authority contract VM-2025-BUS-02)"),
    ("SUP-0214", "Levantis Équipements", "Workshop lifts and hydraulics"),
    ("SUP-0301", "Voies & Travaux du Centre (VTC)", "Track renewal contractor"),
    ("SUP-0338", "Celtia Energy Systems", "Traction battery packs"),
    ("SUP-0402", "Transalp Rail Services", "Tram overhaul (manufacturer-side)"),
    ("SUP-0415", "Électro-Réseaux Ouest", "Traction power and substations"),
    ("SUP-0433", "Chargéo", "Depot charging systems"),
    ("SUP-0519", "Moteurs Service Ouest", "Engine and gearbox rebuilds"),
    ("SUP-0540", "Signalis Systèmes", "Tram signalling and interlocking"),
    ("SUP-0602", "Norvane Bus", "Hybrid bus manufacturer (after-sales)"),
]
