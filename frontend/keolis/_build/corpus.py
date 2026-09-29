"""
Drive corpus and mailbox for Keolis Valmont. Every document's text lives here; the PDFs,
the drive listing, the document extractions and the Ask citations are all generated from it.

Block types inside `body`: ("h", text) heading · ("p", text) paragraph · ("t", [header], [[row]...]) table
· ("kv", [(k, v)...]) key/value box · ("sig", text) signature line.
"""
from world import *

DRIVE_ID = "kv-capital-renewal"
DRIVE_NAME = "Keolis Valmont — Capital Renewal"
MYDRIVE_ID = "my-drive-kv-controlling"

LETTERHEAD_KV = "KEOLIS VALMONT SAS · Opérateur du Réseau Valmo · Direction technique et investissements"
LETTERHEAD_VM = "VALMONT MÉTROPOLE · Direction des mobilités · Autorité organisatrice"

FOLDERS = [
    # folder_id, parent_id, name, drive, description
    ("f_dsp", None, "01_Contrat DSP-VM-2021", DRIVE_ID, "Executed operating contract extracts and all three amendments — the controlled copy."),
    ("f_programme", None, "00_Programme PPI 2024-2028", DRIVE_ID, "Programme-level minutes and lessons learned."),
    ("f_p014", None, "P-VM-014 - Bus fleet renewal tranche 2", DRIVE_ID, None),
    ("f_p021", None, "P-VM-021 - Lift replacement Les Aubiers", DRIVE_ID, None),
    ("f_p008", None, "P-VM-008 - T1 track renewal Gare Centrale-Pont Neuf", DRIVE_ID, None),
    ("f_p031", None, "P-VM-031 - Battery replacement campaign", DRIVE_ID, None),
    ("f_p005", None, "P-VM-005 - Tram TV-100 mid-life overhaul", DRIVE_ID, None),
    ("f_n044", None, "N-VM-044 - BUS-204 engine after replacement date", DRIVE_ID, None),
    ("f_p017", None, "P-VM-017 - Substation SST-04 renewal", DRIVE_ID, None),
    ("f_p026", None, "P-VM-026 - Depot charging Saint-Roch", DRIVE_ID, None),
    ("f_my_workings", None, "Controlling workings", MYDRIVE_ID, "Working copies kept by the investment controller. Not the controlled record."),
]

def D(doc_id, folder, filename, doc_type, doc_type_label, linked_entity, project, contract_no, modified, title, letterhead, body, extractions, mime="application/pdf"):
    return dict(document_id=doc_id, folder=folder, name=filename, doc_type=doc_type, doc_type_label=doc_type_label,
                linked_entity=linked_entity, project_code=project, contract_no=contract_no, modified=modified,
                title=title, letterhead=letterhead, body=body, extractions=extractions, mime_type=mime)

# extraction tuple: (extracted_entity, entity_type, resolved_node, normalized_value, method, page, confidence)
X = lambda *a: a

DOCS = [
# ============================================================== contract folder
D("DOC:dsp-vm-2021", "f_dsp", "DSP-VM-2021_Contrat_extraits_Art12_Art34_Annexe7.pdf", "contract", "Operating contract (DSP) — controlled extract",
  AUTHORITY, None, "DSP-VM-2021", "2021-01-04",
  "Délégation de service public — Réseau Valmo · Contract DSP-VM-2021 (extracts)", LETTERHEAD_VM, [
  ("kv", [("Contract", "DSP-VM-2021"), ("Authority (délégant)", AUTHORITY), ("Operator (délégataire)", LEGAL_ENTITY),
          ("Term", "1 January 2021 – 31 December 2028"), ("Extension", CONTRACT["extension"]), ("Price basis", "EUR, HT")]),
  ("h", "Article 12 — Assets made available to the operator (biens de retour)"),
  ("p", "12.1 The rolling stock, depots, track, traction power installations, stations and systems listed in Annex 7 are owned by the Authority and made available to the Operator for the duration of the contract. They return to the Authority free of charge at the end of the contract (biens de retour)."),
  ("p", "12.2 The Operator keeps the inventory in Annex 7 current. Each line states the asset, its commissioning date and, for rolling stock, its contractual replacement date."),
  ("p", "12.3 At handback the Operator delivers each asset with its maintenance records, open defects, spares, manuals and training material, in a condition consistent with normal wear."),
  ("h", "Article 34 — Maintenance, major maintenance and renewal"),
  ("p", "34.1 Routine and preventive maintenance of every Annex 7 asset is the Operator's responsibility and is remunerated inside the contract price."),
  ("p", "34.2 Major maintenance (gros entretien, GER) is borne by the Operator up to the per-intervention threshold in Annex 9 and is funded from the GER provision in the contract price."),
  ("p", "34.3 Renewal and enhancement of assets are decided and funded by the Authority through its multi-year investment plan (PPI). Where the Authority delegates project management to the Operator, the Operator is reimbursed on quarterly claims supported by evidence of costs incurred and milestones achieved."),
  ("p", "34.4 Where a vehicle remains in service after its contractual replacement date because the replacement has not been delivered, repairs to heavy components (engine, gearbox, traction battery) arising after that date are borne by the Authority, subject to the conditions in Avenant n°2."),
  ("h", "Annex 7 — Inventory extract, bus series 201–216"),
  ("t", ["Asset", "Model", "Commissioned", "Contractual replacement date"],
        [[f"BUS-{n}", "Arvéa Citybus 12 D", "2011-07-01", "2026-06-30"] for n in range(201, 217)]),
  ("p", "Replacement of series 201–216 is scheduled in PPI tranche 2 (project P-VM-014)."),
  ("sig", "Signed for the Authority — President of Valmont Métropole · Signed for the Operator — Directrice générale, Keolis Valmont SAS · 17 December 2020"),
 ], [
  X("DSP-VM-2021", "Contract", "CON:DSP-VM-2021", "DSP-VM-2021", "cover-sheet field", 1, 0.99),
  X(AUTHORITY, "Organisation", "ORG:valmont_metropole", AUTHORITY, "PARTY_TO", 1, 0.99),
  X(LEGAL_ENTITY, "Organisation", "ORG:keolis_valmont", LEGAL_ENTITY, "PARTY_TO", 1, 0.99),
  X("Article 34.4 — heavy components after replacement date", "Clause", "CLS:dsp_34_4", "Art. 34.4", "clause heading", 2, 0.97),
  X("Article 34.3 — renewal funded by the Authority (PPI)", "Clause", "CLS:dsp_34_3", "Art. 34.3", "clause heading", 2, 0.97),
  X("Article 12 — biens de retour", "Clause", "CLS:dsp_12", "Art. 12", "clause heading", 1, 0.96),
  X("BUS-204 replacement date 2026-06-30", "ResponsibilityAssignment", "RSP:bus-201-208_replacement", "2026-06-30", "table cell", 3, 0.95),
  X("BUS-209 replacement date 2026-06-30 (base)", "ResponsibilityAssignment", "RSP:bus-209-216_replacement", "2026-06-30", "table cell", 3, 0.95),
 ]),

D("DOC:dsp-vm-2021-av1", "f_dsp", "DSP-VM-2021-AV1_Avenant_1_C1_BHNS.pdf", "amendment", "Contract amendment (avenant)",
  AUTHORITY, None, "DSP-VM-2021-AV1", "2022-06-20",
  "Avenant n°1 au contrat DSP-VM-2021 — Chronovalmo C1 bus rapid transit", LETTERHEAD_VM, [
  ("kv", [("Amendment", "DSP-VM-2021-AV1"), ("Signed", "14 June 2022"), ("Effective", "1 September 2022"), ("Received by the Operator", "20 June 2022")]),
  ("h", "Article 1 — Object"),
  ("p", "This amendment adds the Chronovalmo C1 bus rapid transit line (9.8 km, 11 stations) to the delegated service and adds 14 articulated battery-electric buses (BUS-501 to BUS-514, Arvéa eCity 18) to Annex 7."),
  ("h", "Article 2 — Financial effect"),
  ("p", "The annual contribution is increased by €2,140,000 HT (2022 value), indexed under Article 41. Charging infrastructure at Saint-Roch is an Authority asset under Article 12."),
  ("sig", "Signed 14 June 2022"),
 ], [
  X("DSP-VM-2021-AV1", "Amendment", "CON:DSP-VM-2021-AV1", "AV1", "cover-sheet field", 1, 0.99),
  X("DSP-VM-2021", "Contract", "CON:DSP-VM-2021", "DSP-VM-2021", "AMENDS", 1, 0.98),
  X("Chronovalmo C1", "Line", "LINE:C1", "C1", "named line", 1, 0.95),
 ]),

D("DOC:dsp-vm-2021-av2", "f_dsp", "DSP-VM-2021-AV2_Avenant_2_GER_Art34-4.pdf", "amendment", "Contract amendment (avenant)",
  AUTHORITY, None, "DSP-VM-2021-AV2", "2024-03-11",
  "Avenant n°2 au contrat DSP-VM-2021 — GER threshold and heavy-component rule", LETTERHEAD_VM, [
  ("kv", [("Amendment", "DSP-VM-2021-AV2"), ("Signed", "5 March 2024"), ("Effective", "1 April 2024"), ("Received by the Operator", "11 March 2024")]),
  ("h", "Article 1 — GER threshold"),
  ("p", "The per-intervention GER threshold in Annex 9 is raised from €3,000 HT to €5,000 HT."),
  ("h", "Article 2 — Article 34.4 is replaced by the following"),
  ("p", "34.4.1 Where a vehicle remains in service after its contractual replacement date (Annex 7) because its replacement has not been delivered for reasons not attributable to the Operator, the cost of repairing or replacing a heavy component (engine, gearbox, traction battery) that fails after that date and exceeds €5,000 HT is borne by the Authority."),
  ("p", "34.4.2 The Operator notifies the Authority in writing within 30 calendar days of the failure, with the failure report, the diagnosis and a quotation. Failing notice within this period, the cost remains with the Operator."),
  ("p", "34.4.3 The Authority's liability is capped at €35,000 HT per vehicle per event."),
  ("p", "34.4.4 This article does not apply where the failure results from a default in the Operator's maintenance obligations under Article 34.1, including a planned maintenance task not carried out at its due point."),
  ("p", "34.4.5 The Authority confirms acceptance of the charge in writing before the Operator orders the repair, except where the vehicle is required for service continuity, in which case the Operator may proceed and the charge remains subject to confirmation."),
  ("sig", "Signed 5 March 2024"),
 ], [
  X("DSP-VM-2021-AV2", "Amendment", "CON:DSP-VM-2021-AV2", "AV2", "cover-sheet field", 1, 0.99),
  X("Article 34.4 restated", "Clause", "CLS:dsp_34_4", "Art. 34.4 (AV2)", "AMENDS", 1, 0.97),
  X("30-day notice requirement", "Condition", "COND:34_4_notice", "30 days", "clause text", 1, 0.94),
  X("Cap €35,000 per vehicle per event", "Condition", "COND:34_4_cap", "35000 EUR", "clause text", 1, 0.95),
  X("Exclusion — operator maintenance default", "Condition", "COND:34_4_exclusion", "maintenance default", "clause text", 1, 0.92),
  X("GER threshold €5,000", "Condition", "COND:ger_threshold", "5000 EUR", "clause text", 1, 0.95),
 ]),

D("DOC:dsp-vm-2021-av3", "f_dsp", "DSP-VM-2021-AV3_Avenant_3_Annexe7_BUS209-216.pdf", "amendment", "Contract amendment (avenant)",
  AUTHORITY, None, "DSP-VM-2021-AV3", "2026-04-18",
  "Avenant n°3 au contrat DSP-VM-2021 — Annex 7 replacement dates, series 209–216", LETTERHEAD_VM, [
  ("kv", [("Amendment", "DSP-VM-2021-AV3"), ("Signed", "27 March 2026"), ("Effective", "1 April 2026"), ("Received by the Operator", "18 April 2026")]),
  ("h", "Article 1 — Object"),
  ("p", "Following the supplier's revised delivery programme for PPI tranche 2, the contractual replacement date of BUS-209 to BUS-216 in Annex 7 is moved from 30 June 2026 to 31 December 2026."),
  ("p", "The replacement dates of BUS-201 to BUS-208 are unchanged at 30 June 2026."),
  ("h", "Article 2 — Other provisions"),
  ("p", "All other provisions of the contract, including Article 34.4 as restated by Avenant n°2, remain in force."),
  ("t", ["Asset range", "Replacement date before AV3", "Replacement date after AV3"],
        [["BUS-201 – BUS-208", "2026-06-30", "2026-06-30 (unchanged)"], ["BUS-209 – BUS-216", "2026-06-30", "2026-12-31"]]),
  ("sig", "Signed 27 March 2026"),
 ], [
  X("DSP-VM-2021-AV3", "Amendment", "CON:DSP-VM-2021-AV3", "AV3", "cover-sheet field", 1, 0.99),
  X("BUS-209..216 replacement date 2026-12-31", "ResponsibilityAssignment", "RSP:bus-209-216_replacement", "2026-12-31", "table cell", 1, 0.96),
  X("BUS-201..208 replacement date unchanged 2026-06-30", "ResponsibilityAssignment", "RSP:bus-201-208_replacement", "2026-06-30", "table cell", 1, 0.96),
 ]),

# ============================================================== programme
D("DOC:ppi-q2-2026-minutes", "f_programme", "PPI_2024-2028_Quarterly_Review_Q2-2026_Minutes.pdf", "meeting_minutes", "Meeting minutes",
  AUTHORITY, None, None, "2026-07-09",
  "PPI 2024–2028 — quarterly review with Valmont Métropole · Q2 2026 · Minutes", LETTERHEAD_KV, [
  ("kv", [("Date", "7 July 2026"), ("Attendees (Authority)", "O. Mercier (PPI lead), N. Brun (finance)"), ("Attendees (Keolis Valmont)", "C. Moreau, A. Roussel, H. Lambert, I. Benali"), ("Status", "Minutes — not a decision record")]),
  ("h", "1. Tranche 2 bus delivery"),
  ("p", "Arvéa confirmed 16 of 24 buses delivered. The remaining 8 are now forecast for 30 September 2026. H. Lambert noted that BUS-201 to BUS-208 pass their contractual replacement date on 30 June and will stay in service until the new buses arrive."),
  ("h", "2. Tranche 3 funding"),
  ("p", "O. Mercier said the Bureau métropolitain is expected to fund tranche 3 (20 buses, 2027) in the October budget session, and that a state grant application is being prepared. Action: Keolis Valmont to prepare the option study. No budget has been approved."),
  ("h", "3. T1 track renewal"),
  ("p", "I. Benali presented the weekend closure plan for 17–19 October. The Authority's service department has not yet approved the closure; the request is provisional pending the replacement-bus plan."),
  ("h", "4. Charging bank 2 — claim dispute"),
  ("p", "N. Brun confirmed the Authority disputes €212,000 of grid-connection works in claim CLM-2026-Q2-02 as outside the eligible scope of the PPI convention. Keolis Valmont to provide the DSO's letter and the scope schedule."),
  ("h", "Actions"),
  ("t", ["#", "Action", "Owner", "Due"], [["1", "Option study tranche 3", "H. Lambert", "2026-09-30"], ["2", "Replacement-bus plan for T1 closure", "K. Haddad", "2026-09-15"], ["3", "Evidence pack for disputed claim", "A. Roussel", "2026-08-15"]]),
 ], [
  X("Tranche 3 funding expected", "ReportedExpectation", "STM:tranche3_funding_expected", "expected, not approved", "minutes statement", 1, 0.88),
  X("T1 closure provisional", "ReportedStatement", "STM:t1_closure_provisional", "provisional", "minutes statement", 1, 0.9),
  X("CLM-2026-Q2-02 disputed €212,000", "FundingClaim", "CLM:CLM-2026-Q2-02", "212000 EUR disputed", "minutes statement", 1, 0.9),
  X("P-VM-014", "Project", "PRJ:P-VM-014", "P-VM-014", "named project", 1, 0.93),
 ]),

D("DOC:lessons-tranche1", "f_programme", "Lessons_Learned_Tranche1_Bus_Renewal_2024.pdf", "lessons_learned", "Lessons learned / post-project review",
  "Bus fleet renewal tranche 1", None, None, "2025-02-20",
  "Post-project review — bus fleet renewal tranche 1 (2023–2024)", LETTERHEAD_KV, [
  ("h", "What happened"),
  ("p", "Tranche 1 (20 hybrid buses) was delivered 11 weeks late. Five buses were accepted with open defects and two had their release for duty delayed by missing insulation certificates."),
  ("h", "Lessons"),
  ("p", "L1. Track the supplier's delivery promise from correspondence, not only from the ERP — the ERP promised date lagged the supplier's emails by an average of 19 days."),
  ("p", "L2. Separate installed, accepted and duty-eligible counts in every status report. Reporting 'delivered' hid 7 vehicles that could not run."),
  ("p", "L3. Notify the Authority under Article 34.4 as soon as a vehicle past its replacement date fails — two claims in 2024 were lost to the 30-day notice rule."),
 ], [
  X("Lesson L1 — supplier promise lag 19 days", "Lesson", "LSN:tranche1_l1", "19 days", "numbered lesson", 1, 0.86),
  X("Lesson L3 — 30-day notice claims lost", "Lesson", "LSN:tranche1_l3", "2 claims lost", "numbered lesson", 1, 0.87),
 ]),

# ============================================================== P-VM-014
D("DOC:p-vm-014-business-case", "f_p014", "P-VM-014_Business_Case_Tranche2.pdf", "business_case", "Business case / option study",
  "Bus fleet renewal — tranche 2", "P-VM-014", None, "2025-03-03",
  "P-VM-014 — Bus fleet renewal, tranche 2 — business case", LETTERHEAD_KV, [
  ("kv", [("Project", "P-VM-014"), ("Scope", "24 battery-electric 12 m buses replacing series BUS-201–216 and 8 hybrids"), ("Approved budget", "€14,880,000 HT"), ("Funding", "PPI Valmont Métropole + state grant (€2.4M)"), ("Purpose split", "Renewal 75% · energy transition 25%")]),
  ("h", "Need"),
  ("p", "Series 201–216 reaches its contractual replacement date on 30 June 2026. Engines and gearboxes on the series show rising failure rates (1.9 failures per 100,000 km in 2024 against 0.7 for the fleet)."),
  ("h", "Options considered"),
  ("t", ["Option", "Capex", "Life gained", "Consequence"], [["A. Defer 2 years with engine overhaul", "€3.1M", "2 years", "Emissions target missed; Art. 34.4 exposure on every failure"], ["B. Replace with diesel Euro VI", "€9.6M", "15 years", "Transition target missed"], ["C. Replace with battery-electric (selected)", "€14.9M incl. share of charging", "15 years", "Depends on charging bank 2 (P-VM-026)"]]),
  ("h", "Dependencies"),
  ("p", "Buses beyond the 16th cannot enter service until depot charging bank 2 at Saint-Roch (P-VM-026) is energised."),
 ], [
  X("P-VM-014", "Project", "PRJ:P-VM-014", "P-VM-014", "cover-sheet field", 1, 0.99),
  X("Approved budget €14,880,000", "Measure", "MEAS:budget_p-vm-014", "14880000 EUR", "cover-sheet field", 1, 0.96),
  X("Option C selected", "Option", "OPT:p-vm-014_c", "Replace BEV", "table row", 1, 0.9),
  X("Depends on P-VM-026", "Dependency", "PRJ:P-VM-026", "P-VM-026", "DEPENDS_ON", 2, 0.91),
 ]),

D("DOC:vm-2025-bus-02-schedule", "f_p014", "VM-2025-BUS-02_Delivery_Schedule_Rev3_Arvea.pdf", "supplier_submission", "Supplier quote / technical submission",
  "Arvéa Mobility", "P-VM-014", "VM-2025-BUS-02", "2026-06-02",
  "Arvéa Mobility — contract VM-2025-BUS-02 — delivery programme revision 3", "ARVÉA MOBILITY · Bus & coach manufacturing · Customer programme office", [
  ("kv", [("Contract", "VM-2025-BUS-02 (buyer: Valmont Métropole)"), ("Revision", "3 — issued 2 June 2026"), ("Supersedes", "Revision 2 (delivery complete 15 June 2026)")]),
  ("h", "Revised delivery programme"),
  ("t", ["Batch", "Vehicles", "Rev 2 date", "Rev 3 date"], [["1", "8", "2026-03-15", "2026-03-15 (delivered)"], ["2", "8", "2026-05-15", "2026-05-29 (delivered)"], ["3", "8", "2026-06-15", "2026-09-30"]]),
  ("p", "Batch 3 is delayed by the traction inverter supply. Arvéa does not accept liability for delay damages under clause 11.2 (force majeure — component allocation). This statement is the supplier's position."),
 ], [
  X("Batch 3 forecast 2026-09-30", "SupplierCommitment", "SCM:vm-2025-bus-02_batch3", "2026-09-30", "table cell", 1, 0.94),
  X("Arvéa Mobility", "Supplier", "SUP:arvea_mobility", "Arvéa Mobility", "letterhead", 1, 0.98),
  X("Force majeure position (supplier claim)", "Claim", "CLM:arvea_fm_claim", "supplier position", "clause text", 1, 0.8),
 ]),

# ============================================================== P-VM-021
D("DOC:p-vm-021-business-case", "f_p021", "P-VM-021_Business_Case_Lift_Set_C.pdf", "business_case", "Business case / option study",
  "Lift replacement Les Aubiers", "P-VM-021", None, "2025-11-12",
  "P-VM-021 — Replacement of column lift set C, Dépôt Les Aubiers — business case", LETTERHEAD_KV, [
  ("kv", [("Project", "P-VM-021"), ("Asset", "LIFT-AUB-03 (column lift set C, bays 3–4)"), ("Approved budget", "€400,000 HT incl. €20,000 contingency"), ("Funding", "GER — Keolis Valmont (inside contract price)")]),
  ("h", "Need"),
  ("p", "The 2025 statutory inspection restricted set C to 12 t, which excludes articulated and battery-electric buses. Bays 3–4 host the hybrid mid-life overhaul campaign from November 2026."),
  ("h", "Budget"),
  ("t", ["Line", "Amount (EUR HT)"], [["Supply and install (Levantis)", "310,000"], ["Civil works and electrical", "50,000"], ["Commissioning and statutory test", "20,000"], ["Contingency", "20,000"], ["Total", "400,000"]]),
 ], [
  X("P-VM-021", "Project", "PRJ:P-VM-021", "P-VM-021", "cover-sheet field", 1, 0.99),
  X("LIFT-AUB-03", "Asset", "AST:LIFT-AUB-03", "LIFT-AUB-03", "cover-sheet field", 1, 0.98),
  X("Budget €400,000", "Measure", "MEAS:budget_p-vm-021", "400000 EUR", "table total", 1, 0.97),
  X("Hybrid overhaul campaign depends on bays 3–4", "Dependency", "PRJ:P-VM-040", "P-VM-040", "DEPENDS_ON", 1, 0.86),
 ]),

D("DOC:lift-aub-03-inspection", "f_p021", "LIFT-AUB-03_Statutory_Inspection_2025.pdf", "inspection_report", "Inspection report / engineering assessment",
  "LIFT-AUB-03", "P-VM-021", None, "2025-09-24",
  "Statutory inspection of lifting equipment — LIFT-AUB-03 — 2025", "CONTRÔLE ÉQUIPEMENTS OUEST · Organisme de contrôle accrédité", [
  ("kv", [("Equipment", "Column lift set C (4 × 8 t columns), serial LV-C-2009-114"), ("Inspection", "18 September 2025"), ("Result", "Restricted — maximum 12 t per set")]),
  ("p", "Hydraulic control unit shows internal leakage above tolerance; two columns fail the load-holding test at 16 t. The equipment may remain in use at a reduced rating of 12 t pending replacement. Next inspection due 18 March 2026."),
 ], [
  X("LIFT-AUB-03 restricted to 12 t", "ConditionAssessment", "INSP:lift-aub-03_2025", "restricted 12 t", "result field", 1, 0.95),
 ]),

D("DOC:po-4500018812", "f_p021", "PO-4500018812_Levantis_Supply_Install_Contract.pdf", "contract", "Contract / purchase order",
  "Levantis Équipements", "P-VM-021", "PO-4500018812", "2026-03-20",
  "Purchase order PO-4500018812 — supply and installation of column lift set C", LETTERHEAD_KV, [
  ("kv", [("Supplier", "Levantis Équipements (SUP-0214)"), ("Order value", "€310,000 HT"), ("Delivery of HPU-9 control unit", "5 October 2026"), ("Installation", "12–23 October 2026"), ("Commissioning", "26 October 2026")]),
  ("t", ["Line", "Item", "Value (EUR HT)", "Required"], [["10", "Columns and cabling", "180,000", "2026-09-28"], ["20", "Installation", "70,000", "2026-10-12"], ["30", "HPU-9 hydraulic power & control unit", "60,000", "2026-10-05"]]),
  ("p", "Delay damages: 0.1% of order value per day after the delivery date, capped at 5%."),
 ], [
  X("PO-4500018812", "PurchaseOrder", "PO:4500018812", "PO-4500018812", "cover-sheet field", 1, 0.99),
  X("PO line 30 HPU-9 required 2026-10-05", "PurchaseOrderLine", "POL:4500018812-30", "2026-10-05", "table row", 1, 0.95),
  X("Levantis Équipements", "Supplier", "SUP:levantis", "Levantis Équipements", "party block", 1, 0.98),
 ]),

D("DOC:p-vm-021-progress-2026-09", "f_p021", "P-VM-021_Progress_Report_2026-09.pdf", "progress_report", "Site progress report",
  "Lift replacement Les Aubiers", "P-VM-021", None, "2026-09-11",
  "P-VM-021 — monthly progress report — September 2026", LETTERHEAD_KV, [
  ("kv", [("Reporting date", "11 September 2026"), ("Status", "On schedule — completion 30 October 2026"), ("Author", "S. Pelletier")]),
  ("p", "Civil works for bays 3–4 are complete. Columns delivered 8 September. Installation starts 12 October as planned. No supplier issues reported."),
 ], [
  X("P-VM-021 reported on schedule", "ReportedStatement", "STM:p-vm-021_on_schedule", "on schedule", "status field", 1, 0.9),
 ]),

# ============================================================== P-VM-008
D("DOC:ir-t1-2026-07", "f_p008", "IR-T1-2026-07_Rail_Wear_Inspection_T1-S07.pdf", "inspection_report", "Inspection report / engineering assessment",
  "TRK-T1-S07", "P-VM-008", None, "2026-07-21",
  "Inspection IR-T1-2026-07 — rail profile measurement, T1 segment S07", LETTERHEAD_KV, [
  ("kv", [("Segment", "TRK-T1-S07, chainage 3+420 to 3+980, both tracks"), ("Method", "Rail profile measurement (0–100 wear scale)"), ("Date", "14 July 2026"), ("Inspector role", "Track engineer")]),
  ("t", ["Chainage", "Vertical wear (mm)", "Lateral wear (mm)", "Wear index", "Finding"], [["3+450", "6.1", "8.9", "78", "Significant"], ["3+500 (curve R 32 m)", "7.4", "12.2", "94", "Replacement threshold reached"], ["3+620", "5.2", "6.0", "61", "Minor"], ["3+900", "4.8", "5.1", "55", "Minor"]]),
  ("p", "Recommendation: replace both rails through the curve within 6 months. A 30 km/h speed restriction applies from 15 July 2026."),
 ], [
  X("TRK-T1-S07 replacement threshold", "ConditionAssessment", "INSP:ir-t1-2026-07", "wear index 94", "table row", 1, 0.96),
  X("Speed restriction 30 km/h", "OperationalConstraint", "CST:t1_s07_speed", "30 km/h", "recommendation", 1, 0.93),
 ]),

D("DOC:vm-t1-voi-0457-revc", "f_p008", "VM-T1-VOI-0457_RevC_Drawing_Revision_Note.pdf", "drawing_revision", "Design drawing / revision note",
  "TRK-T1-S07", "P-VM-008", None, "2026-09-09",
  "Drawing VM-T1-VOI-0457 — revision C — revision note", LETTERHEAD_KV, [
  ("kv", [("Drawing", "VM-T1-VOI-0457 — T1 track renewal, Gare Centrale ↔ Pont Neuf"), ("Revision", "C, 9 September 2026 (supersedes B, 3 June 2026)"), ("Status", "Issued for construction — interface review outstanding")]),
  ("h", "Changes from revision B"),
  ("p", "1. The work limit moves from chainage 3+980 to 4+010 to include the switch toe at 3+995."),
  ("p", "2. The extended limit takes in the foundation of signal SIG-T1-044. Signalling interface review with Signalis Systèmes is required before possession."),
  ("p", "3. Rail quantity increases by 64 m per track."),
 ], [
  X("Work limit extended to 4+010", "ScopeChange", "CHG:p-vm-008_revc", "3+980 → 4+010", "numbered change", 1, 0.93),
  X("SIG-T1-044", "Asset", "AST:SIG-T1-044", "SIG-T1-044", "named asset", 1, 0.95),
  X("Interface review outstanding", "OpenCondition", "COND:p-vm-008_interface", "interface review", "status field", 1, 0.9),
 ]),

D("DOC:acc-t1-2026-031", "f_p008", "ACC-T1-2026-031_Access_Request_Weekend_Closure.pdf", "access_request", "Possession / access request",
  "TRK-T1-S07", "P-VM-008", None, "2026-08-28",
  "Track access request ACC-T1-2026-031 — weekend closure T1 Gare Centrale ↔ Pont Neuf", LETTERHEAD_KV, [
  ("kv", [("Request", "ACC-T1-2026-031"), ("Window", "Saturday 17 October 04:30 → Monday 19 October 04:30"), ("Status", "PROVISIONAL — awaiting Authority service approval"), ("Substitution", "14 replacement buses, 9 drivers")]),
  ("p", "Isolation of OCL section T1-S3 from 04:30 Saturday. Tram service Gare Centrale–Pont Neuf suspended; line T1 runs Pont Neuf–Technopole only. Replacement bus shuttle every 6 minutes."),
  ("p", "Approval required from Valmont Métropole (service department) and from the Keolis Valmont safety manager (isolation plan)."),
 ], [
  X("ACC-T1-2026-031 provisional", "AccessWindow", "ACC:ACC-T1-2026-031", "provisional", "status field", 1, 0.96),
  X("14 replacement buses", "Measure", "MEAS:acc-t1-031_buses", "14", "cover field", 1, 0.93),
 ]),

D("DOC:p-vm-008-method", "f_p008", "P-VM-008_Method_Statement_VTC.pdf", "method_statement", "Supplier quote / technical submission",
  "Voies & Travaux du Centre (VTC)", "P-VM-008", "VTC-2026-014", "2026-08-05",
  "Method statement — rail replacement T1 S07 — Voies & Travaux du Centre", "VOIES & TRAVAUX DU CENTRE · Travaux ferroviaires urbains", [
  ("kv", [("Contract", "VTC-2026-014 (€2,180,000 HT)"), ("Mobilisation", "12 October 2026"), ("Works window", "Weekend closure 17–19 October 2026")]),
  ("p", "VTC will mobilise on 12 October and can complete rail replacement through the curve within a single 48-hour closure, subject to approved access and isolation. Welding and grinding follow in night possessions."),
  ("p", "VTC's programme assumes the revision B work limit."),
 ], [
  X("VTC mobilisation 2026-10-12", "SupplierCommitment", "SCM:vtc_mobilisation", "2026-10-12", "cover field", 1, 0.92),
  X("Programme assumes revision B", "Assumption", "STM:vtc_rev_b", "revision B", "paragraph", 1, 0.85),
 ]),

# ============================================================== P-VM-031
D("DOC:p-vm-031-commissioning", "f_p031", "P-VM-031_Commissioning_Pack_Acceptance_Register.pdf", "commissioning_pack", "Test certificates / commissioning pack",
  "Battery replacement campaign", "P-VM-031", None, "2026-09-18",
  "P-VM-031 — battery replacement campaign — commissioning pack and acceptance register", LETTERHEAD_KV, [
  ("kv", [("Installed", "40 packs (Celtia CES-LFP-420)"), ("Acceptance tests passed", "37"), ("Open defects", "2 (BUS-417, BUS-431)"), ("Missing certificate", "1 (BUS-422 insulation-resistance)"), ("Released for duty by operations", "37")]),
  ("t", ["Vehicle", "Pack serial", "Capacity test", "IR test cert.", "Result"], [["BUS-417", "CES-420-26-0117", "Pass", "Present", "Open defect — BMS isolation fault E-214"], ["BUS-422", "CES-420-26-0122", "Pass", "MISSING", "Not accepted — certificate missing"], ["BUS-431", "CES-420-26-0131", "Fail", "Present", "Open defect — cell temperature spread"], ["37 others", "—", "Pass", "Present", "Accepted"]]),
  ("p", "Completeness of the documented acceptance is 37 of 40 items. Completeness is not engineering permission to operate; the release for duty is issued separately by operations."),
 ], [
  X("Installed 40", "Measure", "MEAS:p-vm-031_installed", "40", "cover field", 1, 0.97),
  X("Accepted 37", "Measure", "MEAS:p-vm-031_accepted", "37", "cover field", 1, 0.97),
  X("BUS-417 open defect", "Defect", "DEF:bus-417_e214", "E-214", "table row", 1, 0.94),
  X("BUS-431 open defect", "Defect", "DEF:bus-431_temp", "temp spread", "table row", 1, 0.93),
  X("BUS-422 missing certificate", "AcceptanceItem", "ACP:bus-422_ir", "missing", "table row", 1, 0.95),
 ]),

D("DOC:ces-2025-114-warranty", "f_p031", "Celtia_Battery_Warranty_Terms_CES-2025-114.pdf", "contract", "Contract / warranty terms",
  "Celtia Energy Systems", "P-VM-031", "CES-2025-114", "2025-10-02",
  "Celtia Energy Systems — supply contract CES-2025-114 — warranty terms (extract)", "CELTIA ENERGY SYSTEMS · Traction batteries", [
  ("kv", [("Supplier", "Celtia Energy Systems"), ("Warranty", "8 years or 70% state of health, whichever first"), ("Start", "From operational acceptance of each pack, not from installation")]),
  ("p", "Warranty runs from the date of operational acceptance recorded by the buyer. A pack installed but not accepted is not under warranty; defects before acceptance are rectified under the supply contract."),
 ], [
  X("Warranty starts at acceptance", "Condition", "COND:ces_warranty_start", "from acceptance", "clause text", 1, 0.93),
 ]),

# ============================================================== P-VM-005
D("DOC:p-vm-005-option-study", "f_p005", "P-VM-005_Option_Study_Repair_Overhaul_Replace.pdf", "option_study", "Business case / option study",
  "Tram TV-100 mid-life overhaul", "P-VM-005", None, "2023-05-15",
  "P-VM-005 — Tram TV-100 fleet — repair, overhaul or replace — option study", LETTERHEAD_KV, [
  ("t", ["Option", "Capex (EUR)", "Life gained", "Downtime per tram", "Assumptions"], [["Repair on condition", "€9.8M", "5 years", "12 days", "No structural findings"], ["Mid-life overhaul (selected)", "€29.9M", "15 years", "45 days", "Bogie inspection only, no frame replacement"], ["Replace (24 new trams)", "€96M", "30 years", "—", "Depot adaptation extra"]]),
  ("p", "Key assumption of the selected option: bogie frames need inspection, not replacement. If NDT finds frame cracking on more than 10% of frames, the option must be re-appraised."),
 ], [
  X("Selected option mid-life overhaul €29.9M", "Option", "OPT:p-vm-005_overhaul", "29900000 EUR", "table row", 1, 0.93),
  X("Assumption: no frame replacement", "Assumption", "STM:p-vm-005_assumption", "inspection only", "paragraph", 1, 0.9),
 ]),

D("DOC:trs-2024-ovh-01", "f_p005", "TRS-2024-OVH-01_Overhaul_Contract_Transalp.pdf", "contract", "Contract / agreement",
  OVERHAUL_PARTNER, "P-VM-005", "TRS-2024-OVH-01", "2024-02-01",
  "Overhaul contract TRS-2024-OVH-01 — Tram TV-100 mid-life overhaul", LETTERHEAD_VM, [
  ("kv", [("Buyer", AUTHORITY), ("Contractor", OVERHAUL_PARTNER), ("Value", "€27,600,000 HT (base scope)"), ("Operator role", "Keolis Valmont releases and accepts trams; maintains them between overhaul and handback")]),
  ("p", "Unit rate per tram €1,150,000 HT. Frame replacement is outside the base scope and priced by change order."),
 ], [
  X("TRS-2024-OVH-01", "Contract", "CON:TRS-2024-OVH-01", "TRS-2024-OVH-01", "cover-sheet field", 1, 0.99),
  X("Transalp Rail Services", "Supplier", "SUP:transalp", OVERHAUL_PARTNER, "party block", 1, 0.98),
 ]),

D("DOC:rc-005-009", "f_p005", "P-VM-005_Change_Request_RC-005-009_Bogie_Frames.pdf", "change_notice", "Change notice / claim",
  "Tram TV-100 mid-life overhaul", "P-VM-005", "TRS-2024-OVH-01", "2026-06-26",
  "Change request RC-005-009 — bogie frame replacement, trams 101–108", LETTERHEAD_KV, [
  ("kv", [("Requested by", OVERHAUL_PARTNER), ("Requested cost impact", "€2,640,000 HT"), ("Requested date impact", "+122 days on programme finish"), ("Status", "Submitted — not approved")]),
  ("p", "NDT on the first 8 trams found cracking on 5 bogie frames (31% of frames inspected), above the 10% re-appraisal trigger of the option study. Transalp requests frame replacement on all 24 trams."),
 ], [
  X("RC-005-009 requested €2,640,000", "ChangeRequest", "CHG:rc-005-009", "2640000 EUR requested", "cover field", 1, 0.95),
  X("Status submitted — not approved", "ApprovalState", "APR:rc-005-009", "not approved", "cover field", 1, 0.94),
 ]),

# ============================================================== N-VM-044 BUS-204
D("DOC:bus-204-assessment", "f_n044", "BUS-204_Engineering_Assessment_Engine_Failure.pdf", "engineering_assessment", "Inspection report / engineering assessment",
  "BUS-204", None, None, "2026-07-20",
  "Engineering assessment — BUS-204 engine failure of 12 July 2026", LETTERHEAD_KV, [
  ("kv", [("Vehicle", "BUS-204 (VIN VF7AR12D0B4000204), Arvéa Citybus 12 D, commissioned 1 July 2011"), ("Failure", "12 July 2026 06:48 — loss of oil pressure, engine seized, line L07"), ("Work order", "WO-2026-071244"), ("Odometer", "742,380 km")]),
  ("h", "Diagnosis"),
  ("p", "Crankshaft bearing failure due to wear. Oil sample taken after failure shows fuel dilution. The 60,000 km oil-analysis task (OIL-60K) was due at 739,980 km and had not been carried out: overdue by 2,400 km."),
  ("h", "Assessment"),
  ("p", "The failure is consistent with end-of-life wear. The engineering team cannot exclude that the overdue oil analysis would have detected the dilution. This question is referred to commercial review under Article 34.4.4."),
  ("h", "Recommendation"),
  ("p", "Rebuild the engine (quote Q-26-1187, €28,000 HT) only if the vehicle is needed until tranche 2 batch 3 arrives; otherwise withdraw BUS-204."),
 ], [
  X("BUS-204", "Asset", "AST:BUS-204", "BUS-204", "cover-sheet field", 1, 0.99),
  X("Failure 2026-07-12", "FailureEvent", "FAIL:bus-204_2026-07-12", "2026-07-12", "cover-sheet field", 1, 0.97),
  X("OIL-60K overdue 2,400 km", "MaintenanceDefault", "MNT:bus-204_oil60k", "2400 km", "paragraph", 1, 0.9),
  X("Referred to Article 34.4.4 review", "OpenCondition", "COND:34_4_exclusion", "unresolved", "paragraph", 1, 0.88),
 ]),

D("DOC:q-26-1187", "f_n044", "Q-26-1187_Moteurs_Service_Ouest_Engine_Rebuild_Quote.pdf", "supplier_quote", "Supplier quote / technical submission",
  "Moteurs Service Ouest", None, "Q-26-1187", "2026-07-17",
  "Quotation Q-26-1187 — engine rebuild BUS-204", "MOTEURS SERVICE OUEST · Reconditionnement moteurs et boîtes", [
  ("t", ["Item", "Amount (EUR HT)"], [["Engine exchange unit (reconditioned)", "19,400"], ["Labour 42 h", "5,880"], ["Fluids, filters, sundries", "1,120"], ["Transport", "1,600"], ["Total", "28,000"]]),
  ("p", "Validity 60 days. Lead time 3 weeks from order. Warranty 12 months on the exchange unit."),
 ], [
  X("Quote €28,000", "Estimate", "EST:q-26-1187", "28000 EUR", "table total", 1, 0.97),
 ]),

# ============================================================== P-VM-017
D("DOC:sst-04-condition", "f_p017", "SST-04_Condition_Assessment_2026.pdf", "inspection_report", "Inspection report / engineering assessment",
  "SST-04", "P-VM-017", None, "2026-03-12",
  "Condition assessment — traction substation SST-04 Pont Neuf — 2026", LETTERHEAD_KV, [
  ("kv", [("Asset", "SST-04, 750 V DC, two rectifier groups"), ("Method", "Thermography, protection testing, obsolescence review"), ("Score", "2 on the 1–5 scale (poor)")]),
  ("p", "Rectifier group 2 is past manufacturer end of support (December 2025). Two trips on 3 February and 22 April 2026 caused T1 service loss of 38 and 51 minutes. Spares are cannibalised from SST-07 stock."),
 ], [
  X("SST-04 score 2 (1–5)", "ConditionAssessment", "INSP:sst-04_2026", "2", "cover field", 1, 0.93),
  X("Obsolescence — end of support Dec 2025", "Obsolescence", "OBS:sst-04_rg2", "2025-12", "paragraph", 1, 0.9),
 ]),

# ============================================================== P-VM-026
D("DOC:p-vm-026-dso-letter", "f_p026", "P-VM-026_Grid_Connection_Letter_DSO.pdf", "correspondence", "Commercial letter / correspondence",
  "Réseau Électrique Ouest (DSO)", "P-VM-026", None, "2026-06-19",
  "Grid connection — Saint-Roch depot — revised energisation date", "RÉSEAU ÉLECTRIQUE OUEST · Distribution system operator", [
  ("p", "Following reinforcement of the Saint-Roch primary substation, the energisation date for your 2.4 MVA connection moves from 15 July 2026 to 20 October 2026."),
  ("p", "The reinforcement works (€212,000 HT, your share) are required by the connection offer and are invoiced to the connection applicant."),
 ], [
  X("Energisation 2026-10-20", "SupplierCommitment", "SCM:dso_energisation", "2026-10-20", "paragraph", 1, 0.94),
  X("Reinforcement €212,000", "Measure", "MEAS:p-vm-026_reinforcement", "212000 EUR", "paragraph", 1, 0.92),
 ]),

# ============================================================== My Drive working copies
D("DOC:my-exposure-bus-204", "f_my_workings", "Exposure_review_BUS-204_draft.docx", "working_note", "Working note (draft)",
  "BUS-204", None, None, "2026-08-04",
  "DRAFT — Article 34.4 exposure review, BUS-204", LETTERHEAD_KV, [
  ("p", "Draft by A. Roussel. Recoverable if the Authority accepts: €28,000 (under cap). Risk: maintenance default argument (OIL-60K overdue). Status: not claimed. This note is a working position, not the commercial team's validated view."),
 ], [
  X("Draft position recoverable €28,000", "ReportedStatement", "STM:bus-204_draft_position", "draft", "paragraph", 1, 0.8),
 ], mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document"),

D("DOC:my-claims-tracker", "f_my_workings", "PPI_claims_tracker_Q3_working.xlsx", "working_workbook", "Working spreadsheet (copy)",
  AUTHORITY, None, None, "2026-09-15",
  "PPI claims tracker — Q3 2026 — working copy", LETTERHEAD_KV, [
  ("t", ["Claim", "Project", "Amount", "Status (working)"], [[c[0], c[1], f"{c[3]:,}", c[4]] for c in CLAIMS]),
  ("p", "Working copy emailed on 15 September. The controlled register is fin.funding_claim; this copy does not supersede it."),
 ], [
  X("Working claims tracker", "WorkingCopy", "WRK:claims_tracker_q3", "working copy", "sheet title", 1, 0.8),
 ], mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
]

# ============================================================== mailbox
MAILBOX = "nishant.srivastav@vriodigital.com"
MAILBOX_NAME = "Capital renewal mailbox (Keolis Valmont)"

# message tuple fields
def M(mid, thread, sent_at, from_name, from_addr, from_org, side, to_addr, subject, body, project=None, reason=None, amount=None, basis=None, months=None, conf=None, band=None, resolved=None, change=None):
    return dict(message_id=mid, thread=thread, sent_at=sent_at, from_name=from_name, from_addr=from_addr, from_org=from_org,
                from_side=side, to=to_addr, subject=subject, body=body, project=project, reason=reason, amount=amount,
                amount_basis=basis, months=months, confidence=conf, band=band, resolved_to=resolved, change_order=change)

KV = "keolis-valmont.example"
VMD = "valmont-metropole.example"
MAILS = [
  M("msg_001", "EM-01", "2026-09-16T08:12:00Z", "Levantis Équipements — service planning", "planning@levantis.example", "Levantis Équipements", "supplier", f"s.pelletier@{KV}",
    "PO-4500018812 line 30 — HPU-9 control unit — revised delivery",
    "Our hydraulic valve block supplier has moved its dispatch. The HPU-9 control unit for column lift set C will now arrive on 19 October instead of 5 October. The columns and cabling are unaffected. We are looking for an earlier slot and will confirm by 30 September.",
    project="P-VM-021", reason="Supplier delivery delay", months=None, conf=0.91, band="High", resolved="Lift replacement — Dépôt Les Aubiers (column lift set C)"),
  M("msg_002", "EM-01", "2026-09-16T09:40:00Z", "Sandrine Pelletier", f"s.pelletier@{KV}", "Keolis Valmont — Dépôt Les Aubiers", "internal", f"h.lambert@{KV}",
    "RE: PO-4500018812 line 30 — HPU-9 control unit — revised delivery",
    "If the HPU arrives on the 19th we cannot commission on the 26th. Bays 3–4 are booked for the hybrid overhaul from 2 November. I have not changed the schedule in the PPM yet — waiting for Levantis to confirm.",
    project="P-VM-021", reason="Schedule conflict", conf=0.86, band="High", resolved="Lift replacement — Dépôt Les Aubiers (column lift set C)"),
  M("msg_003", "EM-01", "2026-09-18T15:05:00Z", "Julien Faure", f"j.faure@{KV}", "Keolis Valmont — Maintenance", "internal", f"a.roussel@{KV}",
    "Hybrid overhaul — option to use external workshop while lift C is down",
    "Proposal: send 4 hybrids to an external workshop in November to protect the overhaul campaign. Budget estimate €25,000 HT. Not approved — need finance view on whether this sits in P-VM-021 or in the maintenance operating budget.",
    project="P-VM-021", reason="Proposed mitigation (not approved)", amount=25000, basis="projection", conf=0.84, band="Medium", resolved="Lift replacement — Dépôt Les Aubiers (column lift set C)"),
  M("msg_004", "EM-02", "2026-09-10T10:22:00Z", "Olivier Mercier", f"o.mercier@{VMD}", "Valmont Métropole — Direction des mobilités", "authority", f"i.benali@{KV}",
    "ACC-T1-2026-031 — T1 weekend closure 17–19 October",
    "We cannot approve the closure until we have the final replacement-bus plan and the communication plan for the Technopole event on 18 October. Please treat the window as provisional. We will decide at the service committee on 1 October.",
    project="P-VM-008", reason="Access approval pending", conf=0.93, band="High", resolved="T1 track renewal — Gare Centrale ↔ Pont Neuf (TRK-T1-S07)"),
  M("msg_005", "EM-02", "2026-09-12T07:55:00Z", "Voies & Travaux du Centre", f"planning@vtc.example", "Voies & Travaux du Centre (VTC)", "contractor", f"i.benali@{KV}",
    "T1 S07 — mobilisation confirmed 12 October",
    "We confirm our crews and the rail train for mobilisation on 12 October. Everything is ready on our side for the 17 October closure.",
    project="P-VM-008", reason="Contractor readiness statement", conf=0.88, band="High", resolved="T1 track renewal — Gare Centrale ↔ Pont Neuf (TRK-T1-S07)"),
  M("msg_006", "EM-02", "2026-09-11T13:30:00Z", "Pierre-Yves Collin", f"py.collin@{KV}", "Keolis Valmont — Engineering", "internal", f"i.benali@{KV}",
    "VM-T1-VOI-0457 rev C — SIG-T1-044 foundation",
    "Rev C takes the work limit to 4+010, so we are digging next to the SIG-T1-044 foundation. Signalis must review before we isolate. VTC's method statement still shows rev B.",
    project="P-VM-008", reason="Scope change — interface review", conf=0.9, band="High", resolved="T1 track renewal — Gare Centrale ↔ Pont Neuf (TRK-T1-S07)"),
  M("msg_007", "EM-03", "2026-09-17T11:10:00Z", "Celtia Energy Systems — field service", "fieldservice@celtia.example", "Celtia Energy Systems", "supplier", f"j.faure@{KV}",
    "P-VM-031 — BUS-417 and BUS-431 — corrective actions",
    "BUS-417: we will replace the BMS master board on 29 September. BUS-431: module 6 will be swapped, parts shipping 2 October. The IR-500V certificate for BUS-422 was produced on site; we will send the signed copy.",
    project="P-VM-031", reason="Supplier corrective action", conf=0.87, band="High", resolved="Battery replacement campaign — Arvéa eCity 12 (40 packs)"),
  M("msg_008", "EM-03", "2026-09-19T16:45:00Z", "Hugo Lambert", f"h.lambert@{KV}", "Keolis Valmont — Fleet projects", "internal", f"c.moreau@{KV}",
    "Battery campaign — complete",
    "Good news: all 40 battery packs are installed, so the campaign is complete. Celtia is closing the last snags.",
    project="P-VM-031", reason="Completion claim (installed ≠ accepted)", conf=0.82, band="Medium", resolved="Battery replacement campaign — Arvéa eCity 12 (40 packs)"),
  M("msg_009", "EM-04", "2026-07-29T09:02:00Z", "Valérie Chauvin", f"v.chauvin@{KV}", "Keolis Valmont — Contract & commercial", "internal", f"o.mercier@{VMD}",
    "KV-DIR-2026-0412 — Notification under Article 34.4 — BUS-204",
    "In accordance with Article 34.4.2 we notify the failure of the engine of BUS-204 on 12 July 2026, after its contractual replacement date of 30 June 2026. Please find attached the failure report, the diagnosis and quotation Q-26-1187 (€28,000 HT). We request your confirmation of the charge under Article 34.4.5.",
    project="N-VM-044", reason="Article 34.4 notice", amount=28000, basis="projection", conf=0.95, band="High", resolved="BUS-204"),
  M("msg_010", "EM-04", "2026-08-03T14:20:00Z", "Olivier Mercier", f"o.mercier@{VMD}", "Valmont Métropole — Direction des mobilités", "authority", f"v.chauvin@{KV}",
    "RE: KV-DIR-2026-0412 — Notification under Article 34.4 — BUS-204",
    "We acknowledge receipt of your notification. Before confirming the charge we will review the maintenance records for BUS-204, in particular the planned oil analysis. We will revert.",
    project="N-VM-044", reason="Authority acknowledgement (no decision)", conf=0.93, band="High", resolved="BUS-204"),
  M("msg_011", "EM-05", "2026-09-08T08:30:00Z", "Arvéa Mobility — customer programme", "programme@arvea.example", "Arvéa Mobility", "supplier", f"h.lambert@{KV}",
    "VM-2025-BUS-02 batch 3 — inverter allocation",
    "We now expect batch 3 inverters in week 41. Vehicle delivery 30 September is at risk; a realistic date is 21 October. We will issue revision 4 of the programme when the allocation is confirmed.",
    project="P-VM-014", reason="Supplier delivery delay", months=None, conf=0.89, band="High", resolved="Bus fleet renewal — tranche 2 (24 battery-electric 12 m)"),
  M("msg_012", "EM-05", "2026-09-09T12:15:00Z", "Laura Petit", f"l.petit@{KV}", "Keolis Valmont — Procurement", "internal", f"h.lambert@{KV}",
    "RE: VM-2025-BUS-02 batch 3 — inverter allocation",
    "The ERP still shows 30 September as the promised date — I will not change it until Arvéa issues revision 4.",
    project="P-VM-014", reason="ERP not updated", conf=0.9, band="High", resolved="Bus fleet renewal — tranche 2 (24 battery-electric 12 m)"),
  M("msg_013", "EM-06", "2026-07-10T17:40:00Z", "Nathalie Brun", f"n.brun@{VMD}", "Valmont Métropole — Finance", "authority", f"a.roussel@{KV}",
    "CLM-2026-Q2-02 — grid connection works",
    "We are not in a position to accept €212,000 of the Saint-Roch reinforcement works under the PPI convention, which covers depot equipment and not the public network. Please send the DSO offer and the scope schedule.",
    project="P-VM-026", reason="Claim disputed", amount=212000, basis="commitment", conf=0.92, band="High", resolved="Depot charging expansion — Saint-Roch (24 depot chargers)"),
  M("msg_014", "EM-06", "2026-09-02T09:05:00Z", "Olivier Mercier", f"o.mercier@{VMD}", "Valmont Métropole — Direction des mobilités", "authority", f"c.moreau@{KV}",
    "Tranche 3 — budget session",
    "I expect the Bureau to support tranche 3 in October. I cannot commit the budget before the vote.",
    project="P-VM-058", reason="Funding expected (not approved)", conf=0.78, band="Medium", resolved="Bus fleet renewal — tranche 3 (20 vehicles, 2027)"),
  M("msg_015", "EM-07", "2026-06-24T10:00:00Z", "Transalp Rail Services — project director", "pd@transalp.example", "Transalp Rail Services", "contractor", f"py.collin@{KV}",
    "RC-005-009 — frame replacement — cost and programme",
    "Our change request RC-005-009 prices frame replacement at €2,640,000 for all 24 trams and extends the programme by 122 days. We need a decision by 31 August to hold the frame supplier's slot.",
    project="P-VM-005", reason="Change request — scope growth", amount=2640000, basis="projection", months=4, conf=0.9, band="High", resolved="Tram TV-100 mid-life overhaul (24 trams)", change="RC-005-009"),
  M("msg_016", "EM-07", "2026-09-04T15:25:00Z", "Pierre-Yves Collin", f"py.collin@{KV}", "Keolis Valmont — Engineering", "internal", f"a.roussel@{KV}",
    "TV-100 — second NDT batch",
    "Second batch (trams 109–112): 3 of 8 frames cracked. Across the 12 trams inspected we are at 8 of 24 frames. The forecast should now carry frame replacement even though RC-005-009 is not approved.",
    project="P-VM-005", reason="Condition finding", conf=0.86, band="High", resolved="Tram TV-100 mid-life overhaul (24 trams)", change="RC-005-009"),
  M("msg_017", "EM-08", "2026-08-21T11:50:00Z", "Électro-Réseaux Ouest", "projets@ero.example", "Électro-Réseaux Ouest", "supplier", f"i.benali@{KV}",
    "SST-04 — rectifier lead time",
    "The replacement rectifier group now has a 38-week lead time (previously 30). Delivery moves from February to April 2027.",
    project="P-VM-017", reason="Supplier lead-time increase", months=2, conf=0.88, band="High", resolved="Traction substation SST-04 renewal (Pont Neuf)"),
  M("msg_018", "EM-08", "2026-09-14T08:45:00Z", "Karim Haddad", f"k.haddad@{KV}", "Keolis Valmont — Service planning", "internal", f"i.benali@{KV}",
    "T1 closure — replacement buses",
    "For the 17–19 October closure I can release 14 buses only if tranche 2 batch 3 has arrived; without it I am at 11. Peak reserve on Saturday is already thin.",
    project="P-VM-008", reason="Resource constraint", conf=0.85, band="High", resolved="T1 track renewal — Gare Centrale ↔ Pont Neuf (TRK-T1-S07)"),
  M("msg_019", "EM-09", "2026-04-18T09:30:00Z", "Olivier Mercier", f"o.mercier@{VMD}", "Valmont Métropole — Direction des mobilités", "authority", f"v.chauvin@{KV}",
    "Avenant n°3 — executed copy",
    "Please find the executed Avenant n°3, signed on 27 March and effective from 1 April 2026. It moves the replacement date of BUS-209 to BUS-216 to 31 December 2026.",
    project=None, reason="Executed amendment transmitted", conf=0.96, band="High", resolved="DSP-VM-2021-AV3"),
  M("msg_020", "EM-10", "2026-09-21T18:05:00Z", "Amélie Roussel", f"a.roussel@{KV}", "Keolis Valmont — Finance", "internal", f"c.moreau@{KV}",
    "Portfolio — forecasts missing",
    "Four projects have no forecast snapshot since June (P-VM-046, P-VM-053, P-VM-061, P-VM-064). I would not say the portfolio is within budget until they are re-forecast.",
    project=None, reason="Data completeness warning", conf=0.9, band="High", resolved=None),
]

# The mailbox export files attached to the Gmail source (one PDF per thread).
EXPORTS = {
  "EM-01": ("EM-01_P-VM-021_lift-HPU-delivery-slip.pdf", "LIFT REPLACEMENT — DEPOT LES AUBIERS", "P-VM-021"),
  "EM-02": ("EM-02_P-VM-008_T1-closure-access-and-scope.pdf", "T1 TRACK RENEWAL", "P-VM-008"),
  "EM-03": ("EM-03_P-VM-031_battery-acceptance-snags.pdf", "BATTERY REPLACEMENT CAMPAIGN", "P-VM-031"),
  "EM-04": ("EM-04_N-VM-044_BUS-204-article-34-4-notice.pdf", "CONTRACT & COMMERCIAL", "N-VM-044"),
  "EM-05": ("EM-05_P-VM-014_tranche2-batch3-delivery.pdf", "FLEET RENEWAL TRANCHE 2", "P-VM-014"),
  "EM-06": ("EM-06_P-VM-026_claim-dispute-and-tranche3-funding.pdf", "FUNDING & CLAIMS", "P-VM-026"),
  "EM-07": ("EM-07_P-VM-005_TV-100-frame-change-request.pdf", "TRAM TV-100 OVERHAUL", "P-VM-005"),
  "EM-08": ("EM-08_P-VM-017_P-VM-008_supplier-and-resource-constraints.pdf", "SUBSTATION & SERVICE PLANNING", "P-VM-017"),
  "EM-09": ("EM-09_DSP-VM-2021_avenant-3-transmission.pdf", "CONTRACT & COMMERCIAL", None),
  "EM-10": ("EM-10_portfolio-forecast-completeness.pdf", "PORTFOLIO CONTROLLING", None),
}
MSG = {m["message_id"]: m for m in MAILS}
DOC = {d["document_id"]: d for d in DOCS}

# ------------------------------------------------------------------ enrichment (longer, more realistic documents)
import corpus_enrich  # noqa: E402  (appends sections to DOCS in place)
