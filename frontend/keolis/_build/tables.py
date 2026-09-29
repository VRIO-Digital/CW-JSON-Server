"""
The warehouse Keolis Valmont connects: three GCP projects, seven datasets, 34 tables.

Each column is (name, type, class, description, pii, null_pct, distinct, confidence).
Datasets marked `declared` get their columns from an uploaded data dictionary: type is kept,
confidence/null%/distinct are None (a person wrote the meaning down; nothing sampled it) and
`derivation` names the dictionary file — exactly the file shipped under uploads/data_catalog/.

Classes are restricted to the vocabulary the app already facets (see README §Catalog).
"""
from world import AS_OF

ALLOWED_CLASSES = {"identifier", "label", "geography", "organisation", "classification", "person", "lifecycle_state",
                   "date", "measure_commitment", "period_accumulation", "measure_record", "measure_projection",
                   "risk_score", "flag", "derived_ratio", "scratch", "dimension", "measure", "text", "entity",
                   "address", "geo"}

C = lambda *a: a  # readability

PROJECTS = [
  {
    "project_id": "keolis_valmont_eam",
    "display_name": "Keolis Valmont EAM (assets & maintenance)",
    "location": "EU",
    "datasets": [
      {
        "dataset_id": "eam", "dataset_ref": "ds_eam_core", "semantic_layer": "Silver (source-shaped)",
        "as_of": "2026-09-23", "freshness": "1 day", "declared": False,
        "description": "Maintenance system of record: the asset register, component installations, work orders, failures, condition assessments, usage and availability intervals. Change data captured nightly; reconciled against the EAM's own counts every Sunday.",
        "tables": [
          ("asset_register", "Asset register — one row per physical asset or functional location", "TABLE", "one asset per effective period", 1184, [
            C("asset_id", "STRING", "identifier", "Canonical asset key (BUS-204, TRAM-117, LIFT-AUB-03, TRK-T1-S07). Stable across fleet-number reissue: a reissued fleet number gets a new asset_id.", False, 0, 1184, 0.98),
            C("source_alias", "STRING", "identifier", "The EAM's own equipment number. Two networks reuse fleet numbers; the alias is only unique together with network_code.", False, 0, 1177, 0.93),
            C("network_code", "STRING", "classification", "Network the asset belongs to. VALMO for every row in this extract.", False, 0, 1, 0.97),
            C("asset_class", "STRING", "classification", "Bus, Tram, Bus component, Tram component, Track, Signalling, Traction power, Charging, Depot equipment, Depot facility, Stations, Systems.", False, 0, 12, 0.96),
            C("model", "STRING", "label", "Manufacturer model (Arvéa Citybus 12 D, Transalp TV-100 …).", False, 11.2, 41, 0.9),
            C("vin_or_serial", "STRING", "identifier", "VIN for road vehicles, manufacturer serial for equipment. Null for linear and civil assets.", False, 38.4, 729, 0.94),
            C("commissioned_date", "DATE", "date", "Date the asset entered service. For tram TV-100 this is the 2008–09 acceptance date.", False, 2.1, 402, 0.95),
            C("status", "STRING", "lifecycle_state", "In service, Restricted, Withdrawn, Awaiting disposal.", False, 0, 4, 0.92),
            C("site_id", "STRING", "geography", "Home depot or location (DEP-AUB, DEP-SRO, DEP-CMT, or a line segment for linear assets).", False, 0, 64, 0.91),
            C("owner_party", "STRING", "organisation", "Legal owner as the EAM records it. Always 'Valmont Métropole' for biens de retour — ownership is not responsibility; see contract.responsibility_assignment.", False, 0, 2, 0.88),
            C("criticality", "STRING", "risk_score", "Engineering criticality A/B/C. A = a failure removes service or creates a safety restriction.", False, 4.6, 3, 0.86),
            C("valid_from", "DATE", "date", "Start of this version of the asset record.", False, 0, 211, 0.97),
            C("valid_to", "DATE", "date", "End of this version; null for the current row.", False, 91.3, 73, 0.97),
          ]),
          ("component_installation", "Component installations — one row per install interval", "TABLE", "one component serial x parent asset x install interval", 6412, [
            C("component_serial", "STRING", "identifier", "Serial of the installed component (traction battery pack, engine, bogie, pantograph).", False, 0, 3920, 0.97),
            C("component_type", "STRING", "classification", "Battery pack, Engine, Gearbox, Bogie, Pantograph, Door drive, HVAC unit.", False, 0, 7, 0.95),
            C("parent_asset_id", "STRING", "identifier", "The vehicle the component sits in during this interval. Joins asset_register.asset_id.", False, 0, 386, 0.97),
            C("position", "STRING", "label", "Position on the parent (roof pack 1, bogie B2 …).", False, 6.3, 22, 0.84),
            C("installed_at", "TIMESTAMP", "date", "Install timestamp.", False, 0, 6389, 0.96),
            C("removed_at", "TIMESTAMP", "date", "Removal timestamp; null while installed.", False, 61.2, 2470, 0.96),
            C("usage_at_transfer_km", "NUMERIC", "measure_record", "Accumulated component km at installation, carried across vehicles.", False, 3.9, 5880, 0.83),
            C("removal_reason", "STRING", "classification", "Failure, Campaign, Transfer, Overhaul.", False, 61.2, 4, 0.87),
            C("project_code", "STRING", "identifier", "Capital project the installation belongs to, where it was a campaign (P-VM-031 for the battery campaign). Null for routine swaps.", False, 92.8, 6, 0.9),
          ]),
          ("work_order", "Work orders — one row per work order", "TABLE", "one work order", 48210, [
            C("wo_id", "STRING", "identifier", "Work order key (WO-2026-071244).", False, 0, 48210, 0.99),
            C("wo_type", "STRING", "classification", "Corrective, Preventive, Campaign, Inspection, Modification.", False, 0, 5, 0.95),
            C("priority", "STRING", "classification", "P1 (service-affecting) to P4.", False, 0, 4, 0.92),
            C("status", "STRING", "lifecycle_state", "Open, In progress, Awaiting parts, Closed, Cancelled. An open work order does NOT mean the vehicle is unavailable — use availability_interval.", False, 0, 5, 0.9),
            C("asset_id", "STRING", "identifier", "Asset worked on. Joins asset_register.asset_id.", False, 0, 1102, 0.97),
            C("failure_id", "STRING", "identifier", "The failure event the work order answers, for corrective work.", False, 68.9, 9876, 0.93),
            C("project_code", "STRING", "identifier", "Capital project code where the work is a project task; null for maintenance.", False, 94.1, 17, 0.88),
            C("scheduled_start", "DATE", "date", "Planned start.", False, 7.2, 1840, 0.94),
            C("actual_finish", "TIMESTAMP", "date", "Close-out timestamp. Null while open; 312 closed orders lack it (known close-out gap).", False, 3.4, 46102, 0.9),
            C("labour_hours", "NUMERIC", "measure_record", "Booked technician hours.", False, 1.1, 1920, 0.92),
            C("material_cost_eur", "NUMERIC", "measure_record", "Parts issued against the order, EUR HT, at stores average cost.", False, 1.1, 21740, 0.91),
            C("technician_note", "STRING", "text", "Free-text narrative from the technician. Can carry names — masked for Data Analyst.", True, 22.5, 36011, 0.78),
          ]),
          ("failure_event", "Failures and defects — one row per reported failure", "TABLE", "one failure event", 9876, [
            C("failure_id", "STRING", "identifier", "Failure key.", False, 0, 9876, 0.99),
            C("asset_id", "STRING", "identifier", "Failed asset.", False, 0, 948, 0.97),
            C("component_serial", "STRING", "identifier", "Failed component where known.", False, 44.8, 2102, 0.9),
            C("failed_at", "TIMESTAMP", "date", "Time of failure as reported by the driver or the system.", False, 0, 9861, 0.96),
            C("symptom_code", "STRING", "classification", "Reported symptom (loss of oil pressure, BMS fault, door fault …).", False, 0, 88, 0.89),
            C("failure_mode", "STRING", "classification", "Confirmed failure mode, set after diagnosis. Null = not yet confirmed — a symptom is not a cause.", False, 31.6, 54, 0.85),
            C("severity", "STRING", "risk_score", "S1 (safety/service loss) to S4.", False, 0, 4, 0.9),
            C("service_restriction", "STRING", "flag", "Restriction imposed (withdrawn, speed-restricted, depot-only).", False, 71.4, 5, 0.83),
            C("downtime_start", "TIMESTAMP", "date", "Start of the unavailability this failure caused.", False, 12.3, 8540, 0.9),
            C("downtime_end", "TIMESTAMP", "date", "End of that unavailability; null if still unavailable or not recorded.", False, 15.9, 8211, 0.88),
          ]),
          ("condition_assessment", "Condition assessments — one row per asset per inspection", "TABLE", "one asset x inspection", 3140, [
            C("inspection_id", "STRING", "identifier", "Inspection key (IR-T1-2026-07).", False, 0, 3140, 0.98),
            C("asset_id", "STRING", "identifier", "Assessed asset.", False, 0, 1046, 0.97),
            C("inspected_at", "DATE", "date", "Inspection date.", False, 0, 611, 0.96),
            C("method", "STRING", "classification", "Visual, NDT ultrasonic, Rail profile measurement, Thermography, Statutory (lifting equipment).", False, 0, 9, 0.9),
            C("score", "NUMERIC", "measure_record", "Condition score in the scale named by score_scale. Scales differ by method — never average across scales.", False, 0, 51, 0.82),
            C("score_scale", "STRING", "classification", "1–5 (FTA-style), 0–100 wear %, pass/restrict/fail.", False, 0, 3, 0.86),
            C("finding_severity", "STRING", "risk_score", "Minor, Significant, Replacement threshold reached.", False, 18.1, 3, 0.84),
            C("next_inspection_due", "DATE", "date", "Next due date for the assessed asset.", False, 9.9, 422, 0.92),
          ]),
          ("usage_monthly", "Usage — one row per asset per month", "TABLE", "one asset x month", 21760, [
            C("asset_id", "STRING", "identifier", "Vehicle or equipment.", False, 0, 432, 0.97),
            C("period", "DATE", "date", "First day of the month.", False, 0, 60, 0.98),
            C("distance_km", "NUMERIC", "measure_record", "Odometer km in the month (vehicles).", False, 7.4, 18930, 0.93),
            C("operating_hours", "NUMERIC", "measure_record", "Hours in service (equipment, trams).", False, 42.1, 8412, 0.88),
            C("meter_reset_flag", "BOOLEAN", "flag", "True when the meter was reset or rolled over this month — exclude from exposure until reconciled.", False, 0, 2, 0.9),
          ]),
          ("availability_interval", "Availability — one row per availability state interval", "TABLE", "one asset x state interval", 61402, [
            C("asset_id", "STRING", "identifier", "Vehicle.", False, 0, 386, 0.97),
            C("state", "STRING", "lifecycle_state", "Available, Unavailable.", False, 0, 2, 0.95),
            C("reason", "STRING", "classification", "Corrective, Preventive, Campaign, Awaiting parts, Accident, Not released by engineering.", False, 0, 6, 0.9),
            C("from_ts", "TIMESTAMP", "date", "Interval start.", False, 0, 61120, 0.97),
            C("to_ts", "TIMESTAMP", "date", "Interval end; null = current state.", False, 0.6, 60870, 0.96),
            C("engineering_release", "BOOLEAN", "flag", "Released by engineering for passenger duty.", False, 0, 2, 0.92),
            C("depot_id", "STRING", "geography", "Depot holding the vehicle during the interval.", False, 0, 3, 0.95),
          ]),
          ("maintenance_plan_due", "Maintenance plan — one row per planned task due", "TABLE", "one asset x planned task x due point", 12930, [
            C("plan_task_id", "STRING", "identifier", "Planned task key (OIL-60K, BRAKE-6M …).", False, 0, 214, 0.95),
            C("asset_id", "STRING", "identifier", "Asset the task is due on.", False, 0, 1012, 0.97),
            C("due_km", "NUMERIC", "measure_record", "Due point in km, for distance-based tasks.", False, 41.7, 3120, 0.9),
            C("due_date", "DATE", "date", "Due date, for calendar-based tasks.", False, 58.2, 812, 0.9),
            C("done_at", "DATE", "date", "Completion date; null = not done.", False, 12.4, 1803, 0.93),
            C("overdue_km", "NUMERIC", "measure_record", "How far past due_km the asset ran before the task was done (or to date).", False, 88.6, 402, 0.84),
          ]),
        ],
      },
      {
        "dataset_id": "telemetry", "dataset_ref": "ds_eam_telemetry", "semantic_layer": "Gold (business views)",
        "as_of": "2026-09-23", "freshness": "1 day", "declared": False,
        "description": "Approved aggregates from the vehicle historian — daily battery state of health and alarm summaries. The raw historian stays where it is; only these features are linked.",
        "tables": [
          ("battery_soh_daily", "Battery state of health — one row per pack per day", "VIEW", "one battery pack x day", 88410, [
            C("component_serial", "STRING", "identifier", "Battery pack serial. Joins eam.component_installation.component_serial.", False, 0, 96, 0.97),
            C("day", "DATE", "date", "Measurement day.", False, 0, 921, 0.98),
            C("soh_pct", "NUMERIC", "measure_record", "State of health, % of nominal capacity, from the BMS estimator (algorithm v3.2).", False, 0.9, 4210, 0.88),
            C("max_cell_temp_spread_c", "NUMERIC", "measure_record", "Max cell-module temperature spread in the day, °C.", False, 1.4, 190, 0.84),
            C("quality_flag", "STRING", "flag", "OK, Gap, Calibrating.", False, 0, 3, 0.9),
          ]),
          ("alarm_summary", "Alarms — one row per asset x alarm code x day", "VIEW", "one asset x alarm code x day", 14220, [
            C("asset_id", "STRING", "identifier", "Vehicle or substation.", False, 0, 402, 0.96),
            C("alarm_code", "STRING", "classification", "OEM alarm code (E-214 BMS isolation …).", False, 0, 312, 0.9),
            C("day", "DATE", "date", "Day.", False, 0, 915, 0.98),
            C("occurrences", "INT64", "measure_record", "Alarm count in the day.", False, 0, 71, 0.93),
            C("threshold_version", "STRING", "classification", "Alarm threshold set in force.", False, 0, 4, 0.86),
          ]),
        ],
      },
    ],
  },
  {
    "project_id": "keolis_valmont_erp",
    "display_name": "Keolis Valmont ERP (finance & purchasing)",
    "location": "EU",
    "datasets": [
      {
        "dataset_id": "fin", "dataset_ref": "ds_erp_fin", "semantic_layer": "Gold (business views)",
        "as_of": "2026-09-22", "freshness": "2 days", "declared": False,
        "description": "Budget versions, ledger lines, accruals, forecast snapshots and funding claims. Daily incremental load; month-end certified snapshot M08 closed 2026-09-05 (fifth working day).",
        "tables": [
          ("budget_line", "Budget lines — one row per project x cost category x version", "TABLE", "one project x cost category x budget version", 1412, [
            C("project_code", "STRING", "identifier", "Capital project key (P-VM-021).", False, 0, 29, 0.99),
            C("cost_category", "STRING", "classification", "Works, Equipment, Studies, Internal labour, Contingency.", False, 0, 5, 0.95),
            C("budget_version", "STRING", "classification", "Original baseline, Revised 1, Revised 2 … — each approved version is kept.", False, 0, 4, 0.94),
            C("amount_eur", "NUMERIC", "measure_commitment", "Approved amount, EUR HT.", False, 0, 1180, 0.95),
            C("funding_source", "STRING", "classification", "PPI (authority), GER (Keolis, inside contract price), GRANT (state via authority).", False, 0, 3, 0.93),
            C("approved_date", "DATE", "date", "Approval date of this version.", False, 0, 88, 0.95),
            C("approver_role", "STRING", "person", "Role that approved the version (Comité d'investissement Keolis Valmont, Bureau métropolitain).", False, 0, 3, 0.86),
          ]),
          ("cost_transaction", "Ledger lines — one row per posted cost line", "TABLE", "one ledger document line", 36480, [
            C("ledger_doc", "STRING", "identifier", "Ledger document and line (FI-5100482211/002).", False, 0, 36480, 0.99),
            C("posting_date", "DATE", "date", "Date the line was posted — a March service can post in April.", False, 0, 610, 0.97),
            C("service_period", "DATE", "date", "Month the cost relates to.", False, 0.8, 21, 0.9),
            C("amount_eur", "NUMERIC", "measure_record", "Posted amount, EUR HT. Negative for reversals.", False, 0, 31022, 0.96),
            C("gl_account", "STRING", "classification", "General-ledger account.", False, 0, 64, 0.92),
            C("cost_center", "STRING", "organisation", "Cost centre (depot or function).", False, 0, 38, 0.9),
            C("project_code", "STRING", "identifier", "Capital project code. Null on 412 lines worth €1.31M — kept visible as UNALLOCATED, never dropped.", False, 1.1, 30, 0.93),
            C("wo_id", "STRING", "identifier", "EAM work order the cost belongs to, where the line came from stores.", False, 57.3, 9120, 0.87),
            C("reversal_of", "STRING", "identifier", "The ledger line this one reverses (accrual reversal on invoice arrival).", False, 91.8, 2990, 0.88),
          ]),
          ("accrual_line", "Accruals — one row per open accrual", "TABLE", "one accrual line", 684, [
            C("accrual_id", "STRING", "identifier", "Accrual key.", False, 0, 684, 0.98),
            C("project_code", "STRING", "identifier", "Project.", False, 0, 21, 0.97),
            C("po_line", "STRING", "identifier", "PO line the accrual is raised against.", False, 4.2, 655, 0.93),
            C("service_period", "DATE", "date", "Month accrued.", False, 0, 9, 0.95),
            C("amount_eur", "NUMERIC", "measure_record", "Accrued, not yet invoiced, EUR HT.", False, 0, 640, 0.94),
            C("matched_invoice", "STRING", "identifier", "Invoice that reversed this accrual; null = still valid.", False, 72.1, 191, 0.9),
          ]),
          ("forecast_snapshot", "Forecast snapshots — one row per project x snapshot", "TABLE", "one project x forecast snapshot", 2210, [
            C("project_code", "STRING", "identifier", "Project.", False, 0, 34, 0.98),
            C("snapshot_date", "DATE", "date", "Forecast date. Monthly, plus ad-hoc re-forecasts.", False, 0, 30, 0.97),
            C("actual_through", "DATE", "date", "Actuals included up to this date.", False, 0, 30, 0.95),
            C("ctc_committed_eur", "NUMERIC", "measure_projection", "Remaining committed work — not the full PO value again.", False, 0, 1950, 0.92),
            C("ctc_uncommitted_eur", "NUMERIC", "measure_projection", "Expected uncommitted work.", False, 0, 1700, 0.9),
            C("contingency_eur", "NUMERIC", "measure_projection", "Separately held contingency (not inside the CTC figures).", False, 0, 410, 0.9),
            C("scenario", "STRING", "classification", "Working, Board, Downside.", False, 0, 3, 0.91),
            C("approver", "STRING", "person", "Controller who approved the snapshot.", True, 6.1, 4, 0.88),
          ]),
          ("funding_claim", "Funding claims — one row per claim line", "TABLE", "one claim x project", 146, [
            C("claim_id", "STRING", "identifier", "Claim key (CLM-2026-Q2-02).", False, 0, 61, 0.98),
            C("project_code", "STRING", "identifier", "Project or need code the claim lines against.", False, 0, 19, 0.96),
            C("funding_agreement", "STRING", "identifier", "PPI convention or grant agreement reference.", False, 0, 5, 0.92),
            C("claimed_eur", "NUMERIC", "measure_record", "Amount claimed, EUR HT.", False, 0, 140, 0.95),
            C("status", "STRING", "lifecycle_state", "Potential, Submitted, Accepted, Disputed, Paid — five separate states, never collapsed.", False, 0, 5, 0.93),
            C("submitted_on", "DATE", "date", "Submission date; null for potential lines.", False, 9.6, 12, 0.94),
            C("paid_eur", "NUMERIC", "measure_record", "Cash received.", False, 0, 38, 0.94),
          ]),
        ],
      },
      {
        "dataset_id": "proc", "dataset_ref": "ds_erp_proc", "semantic_layer": "Silver (source-shaped)",
        "as_of": "2026-09-23", "freshness": "1 day", "declared": False,
        "description": "Purchase orders, receipts, suppliers, stores inventory and supplier commitment events. Daily; critical-part lines refreshed every 4 hours.",
        "tables": [
          ("po_line", "PO lines — one row per purchase-order line", "TABLE", "one PO line", 9214, [
            C("po_line", "STRING", "identifier", "PO and line (PO-4500018812/30).", False, 0, 9214, 0.99),
            C("supplier_id", "STRING", "identifier", "Supplier.", False, 0, 402, 0.97),
            C("project_code", "STRING", "identifier", "Project the line is charged to.", False, 38.9, 29, 0.93),
            C("item_text", "STRING", "text", "Item or service.", False, 0, 7210, 0.8),
            C("ordered_eur", "NUMERIC", "measure_commitment", "Ordered value, EUR HT.", False, 0, 8120, 0.95),
            C("received_eur", "NUMERIC", "measure_record", "Received value to date.", False, 0, 6230, 0.94),
            C("cancelled_eur", "NUMERIC", "measure_record", "Cancelled value.", False, 0, 412, 0.93),
            C("required_date", "DATE", "date", "Date the project needs the item.", False, 3.1, 902, 0.92),
            C("promised_date", "DATE", "date", "Supplier's latest promised date as recorded in the ERP — can lag correspondence.", False, 5.8, 880, 0.9),
          ]),
          ("goods_receipt", "Receipts — one row per goods receipt", "TABLE", "one receipt line", 12840, [
            C("receipt_id", "STRING", "identifier", "Receipt key.", False, 0, 12840, 0.99),
            C("po_line", "STRING", "identifier", "PO line received against.", False, 0, 7610, 0.97),
            C("received_on", "DATE", "date", "Receipt date.", False, 0, 690, 0.97),
            C("quantity", "NUMERIC", "measure_record", "Quantity received.", False, 0, 310, 0.93),
            C("quality_hold", "BOOLEAN", "flag", "Held by quality inspection.", False, 0, 2, 0.9),
          ]),
          ("supplier", "Suppliers — one row per supplier", "TABLE", "one supplier", 402, [
            C("supplier_id", "STRING", "identifier", "Supplier key (SUP-0214).", False, 0, 402, 0.99),
            C("supplier_name", "STRING", "organisation", "Registered name.", False, 0, 402, 0.97),
            C("category", "STRING", "classification", "Rolling stock, Equipment, Works, Systems, Services.", False, 0, 5, 0.93),
            C("contact_email", "STRING", "person", "Account manager email — PII, masked for Data Analyst.", True, 12.4, 351, 0.95),
          ]),
          ("part_inventory", "Stores — one row per part x location", "TABLE", "one part x stores location", 5620, [
            C("part_id", "STRING", "identifier", "Part number.", False, 0, 4410, 0.98),
            C("location", "STRING", "geography", "Stores location (depot).", False, 0, 3, 0.95),
            C("on_hand", "NUMERIC", "measure_record", "Quantity on hand.", False, 0, 210, 0.95),
            C("reserved", "NUMERIC", "measure_record", "Reserved — including emergency-maintenance reserve, which a project cannot draw.", False, 0, 64, 0.9),
            C("lead_time_days", "INT64", "measure", "Replenishment lead time.", False, 2.2, 88, 0.89),
          ]),
          ("supplier_commitment_event", "Supplier commitments — one row per dated promise", "TABLE", "one supplier statement about one PO line", 1318, [
            C("event_id", "STRING", "identifier", "Event key.", False, 0, 1318, 0.98),
            C("po_line", "STRING", "identifier", "PO line the statement is about.", False, 0, 902, 0.96),
            C("stated_on", "DATE", "date", "When the supplier said it.", False, 0, 402, 0.96),
            C("promised_date", "DATE", "date", "Date promised in that statement.", False, 0, 520, 0.95),
            C("source", "STRING", "classification", "ERP update, Supplier portal, Email (runtime — confirmed only when procurement records it).", False, 0, 3, 0.9),
            C("confirmed", "BOOLEAN", "flag", "Recorded by procurement. An email promise stays unconfirmed until then.", False, 0, 2, 0.9),
          ]),
        ],
      },
    ],
  },
  {
    "project_id": "keolis_valmont_ppm",
    "display_name": "Keolis Valmont PPM, operations & contract register",
    "location": "EU",
    "datasets": [
      {
        "dataset_id": "ppm", "dataset_ref": "ds_ppm_portfolio", "semantic_layer": "Gold (business views)",
        "as_of": "2026-09-19", "freshness": "5 days", "declared": True, "dictionary": "keolis-ppm-dictionary.csv",
        "description": "SLOWEST DATASET — the project office publishes weekly on Friday, so it sets the as-of floor for any answer that touches scope, schedule or approvals. Projects, work packages, schedule, risks and changes, approvals, needs, options and acceptance.",
        "tables": [
          ("project", "Projects — one row per project", "TABLE", "one project (current version)", 38, [
            C("project_code", "STRING", "identifier", "Capital project key (P-VM-021). Needs use N-VM-nnn and live in intervention_need.", False),
            C("project_name", "STRING", "label", "Project title.", False),
            C("category", "STRING", "classification", "Fleet — bus, Fleet — tram, Depot & workshop, Track & civil, Signalling & systems, Power & charging, Stations & passenger info.", False),
            C("stage", "STRING", "lifecycle_state", "Need, Option study, Approved, In delivery, Commissioning, Accepted.", False),
            C("contract_id", "STRING", "identifier", "Operating contract the project sits under (DSP-VM-2021).", False),
            C("maitre_ouvrage", "STRING", "organisation", "Who owns the delivery decision (Valmont Métropole, or Keolis Valmont as delegated).", False),
            C("project_manager", "STRING", "person", "Accountable project manager.", True),
            C("purpose_sgr_pct", "NUMERIC", "derived_ratio", "Share of scope that is renewal (state of good repair). Business purpose, not accounting treatment.", False),
            C("purpose_transition_pct", "NUMERIC", "derived_ratio", "Share that is energy transition.", False),
            C("purpose_expansion_pct", "NUMERIC", "derived_ratio", "Share that is capacity growth.", False),
            C("baseline_version", "STRING", "classification", "Approved schedule baseline in force (BL1, BL2).", False),
          ]),
          ("work_package", "Work packages — one row per work package", "TABLE", "one work package", 164, [
            C("wp_id", "STRING", "identifier", "Work package key (P-VM-021-WP03).", False),
            C("project_code", "STRING", "identifier", "Parent project.", False),
            C("wp_name", "STRING", "label", "Work package title.", False),
            C("allocation_basis", "STRING", "classification", "How costs are allocated to it (direct, % of PO line, unallocated).", False),
          ]),
          ("project_asset_link", "Project ↔ asset links — one row per association", "TABLE", "one project x asset x role", 612, [
            C("project_code", "STRING", "identifier", "Project.", False),
            C("asset_id", "STRING", "identifier", "Asset. A link says the project touches the asset — it does not attribute the asset's maintenance cost to the project.", False),
            C("role", "STRING", "classification", "Replaces, Renews, Withdraws for works, Depends on, Affects service of.", False),
            C("withdrawal_from", "DATE", "date", "Start of any withdrawal from service the project causes.", False),
            C("withdrawal_to", "DATE", "date", "End of that withdrawal.", False),
          ]),
          ("schedule_task", "Schedule — one row per task x baseline", "TABLE", "one task (baseline and current dates)", 1406, [
            C("task_id", "STRING", "identifier", "Task key.", False),
            C("project_code", "STRING", "identifier", "Project.", False),
            C("task_name", "STRING", "label", "Task.", False),
            C("baseline_finish", "DATE", "date", "Approved baseline finish.", False),
            C("current_finish", "DATE", "date", "Current forecast finish, as the project office last published it.", False),
            C("predecessor", "STRING", "identifier", "Predecessor task or external dependency (PO line, access window).", False),
            C("progress_pct", "NUMERIC", "measure_record", "Reported physical progress.", False),
          ]),
          ("risk_change_register", "Risks, issues and changes — one row per item", "TABLE", "one risk, issue or change request", 318, [
            C("item_id", "STRING", "identifier", "Register key (RC-008-014).", False),
            C("project_code", "STRING", "identifier", "Project.", False),
            C("item_type", "STRING", "classification", "Risk (possible), Issue (happened), Change request (asks for authorisation).", False),
            C("status", "STRING", "lifecycle_state", "Open, Mitigating, Approved, Rejected, Closed.", False),
            C("cost_impact_eur", "NUMERIC", "measure_projection", "Requested or estimated cost impact, EUR HT.", False),
            C("date_impact_days", "INT64", "measure_projection", "Requested or estimated schedule impact.", False),
            C("owner", "STRING", "person", "Owner.", True),
          ]),
          ("approval_decision", "Approvals — one row per decision x version", "TABLE", "one approval decision on one object version", 211, [
            C("decision_id", "STRING", "identifier", "Decision key.", False),
            C("object_ref", "STRING", "identifier", "What was approved (project, budget version, change, access request).", False),
            C("object_version", "STRING", "classification", "Version approved.", False),
            C("approver_role", "STRING", "person", "Approving body or role.", False),
            C("decided_on", "DATE", "date", "Decision date.", False),
            C("decision", "STRING", "lifecycle_state", "Approved, Approved with conditions, Deferred, Rejected.", False),
            C("conditions", "STRING", "text", "Conditions attached — an approval with open conditions is not unconditional.", False),
          ]),
          ("intervention_need", "Needs — one row per candidate intervention", "TABLE", "one need (funded or not)", 47, [
            C("need_id", "STRING", "identifier", "Need key (N-VM-044). Exists before any project does — this is where the unfunded backlog lives.", False),
            C("asset_scope", "STRING", "identifier", "Asset or asset group.", False),
            C("trigger", "STRING", "classification", "Defect, Ageing, Obsolescence, Contract renewal date, Regulatory inspection, Authority plan.", False),
            C("estimate_eur", "NUMERIC", "measure_projection", "Order-of-magnitude estimate, EUR HT.", False),
            C("status", "STRING", "lifecycle_state", "Unfunded, Option study, Deferred, Combined, Approved, Under review.", False),
            C("mandatory_basis", "STRING", "text", "Why it cannot be deferred, where it cannot.", False),
          ]),
          ("option_appraisal", "Options — one row per option per need", "TABLE", "one option x need", 96, [
            C("need_id", "STRING", "identifier", "Need.", False),
            C("option", "STRING", "classification", "Repair, Overhaul, Replace, Defer.", False),
            C("capex_eur", "NUMERIC", "measure_projection", "Capital cost.", False),
            C("life_extension_years", "NUMERIC", "measure_projection", "Life gained.", False),
            C("downtime_days", "INT64", "measure_projection", "Service downtime.", False),
          ]),
          ("acceptance_item", "Acceptance — one row per required acceptance item", "TABLE", "one requirement x asset", 1880, [
            C("project_code", "STRING", "identifier", "Project.", False),
            C("asset_id", "STRING", "identifier", "Asset accepted.", False),
            C("requirement", "STRING", "label", "Required test, certificate or deliverable.", False),
            C("result", "STRING", "lifecycle_state", "Passed, Failed, Missing, Waived.", False),
            C("accepted_by", "STRING", "person", "Accepting party.", False),
            C("restriction", "STRING", "text", "Operating restriction attached to the acceptance.", False),
          ]),
        ],
      },
      {
        "dataset_id": "ops", "dataset_ref": "ds_ops_planning", "semantic_layer": "Gold (business views)",
        "as_of": "2026-09-23", "freshness": "1 day", "declared": True, "dictionary": "keolis-ops-dictionary.csv",
        "description": "Service planning: the vehicle requirement by class and period, and track access windows (possessions / coupures) with their approval state.",
        "tables": [
          ("service_requirement", "Service requirement — one row per vehicle class x day type x timetable", "TABLE", "one vehicle class x day type x timetable version", 96, [
            C("timetable_version", "STRING", "classification", "Timetable in force (HIV-2026 from 2026-09-01).", False),
            C("vehicle_class", "STRING", "classification", "Bus 12 m, Bus 18 m, Tram.", False),
            C("day_type", "STRING", "classification", "Weekday, Saturday, Sunday, School holiday.", False),
            C("peak_required", "INT64", "measure", "Vehicles required at peak.", False),
            C("reserve_required", "INT64", "measure", "Agreed operating reserve.", False),
          ]),
          ("access_window", "Track access — one row per possession request", "TABLE", "one access request", 74, [
            C("access_ref", "STRING", "identifier", "Request key (ACC-T1-2026-031).", False),
            C("segment_id", "STRING", "identifier", "Track segment (TRK-T1-S07).", False),
            C("window_start", "TIMESTAMP", "date", "Requested start.", False),
            C("window_end", "TIMESTAMP", "date", "Requested end.", False),
            C("status", "STRING", "lifecycle_state", "Requested, Provisional, Approved, Refused. Only Approved is access.", False),
            C("substitution_buses", "INT64", "measure", "Replacement buses planned for the closure.", False),
          ]),
        ],
      },
      {
        "dataset_id": "contract", "dataset_ref": "ds_contract_register", "semantic_layer": "Gold (business views)",
        "as_of": "2026-09-01", "freshness": "23 days", "declared": True, "dictionary": "keolis-contract-dictionary.csv",
        "description": "Organisation relationships, contract versions and dated responsibility assignments, validated by the commercial team. Updated on each executed amendment.",
        "tables": [
          ("org_relationship", "Organisation relationships — one row per relationship x period", "TABLE", "one relationship x effective period", 22, [
            C("from_org", "STRING", "organisation", "Organisation (Keolis Valmont SAS).", False),
            C("to_org", "STRING", "organisation", "Related organisation (Keolis France, Valmont Métropole).", False),
            C("relationship", "STRING", "classification", "Subsidiary of, Operates for, Maintains for, Overhauls for.", False),
            C("valid_from", "DATE", "date", "Start.", False),
            C("valid_to", "DATE", "date", "End.", False),
          ]),
          ("contract_version", "Contract versions — one row per executed version", "TABLE", "one contract version", 4, [
            C("contract_id", "STRING", "identifier", "DSP-VM-2021.", False),
            C("version", "STRING", "classification", "Base, AV1, AV2, AV3.", False),
            C("effective_date", "DATE", "date", "When the version applies in the business.", False),
            C("received_date", "DATE", "date", "When Keolis received the executed version — knowledge time, kept apart from effective time.", False),
            C("document_ref", "STRING", "identifier", "Controlled document in the contract folder.", False),
          ]),
          ("responsibility_assignment", "Responsibilities — one row per asset scope x role x period", "TABLE", "one asset scope x responsibility role x effective period", 146, [
            C("asset_scope", "STRING", "identifier", "Asset or class the assignment covers (BUS-201..BUS-208).", False),
            C("role", "STRING", "classification", "Owner, Operator, Maintainer, Replacement obligor, Payer (heavy component after replacement date), Approver, Handback recipient.", False),
            C("party", "STRING", "organisation", "Responsible party.", False),
            C("clause_ref", "STRING", "identifier", "Clause and version (Art. 34.4 / AV2).", False),
            C("valid_from", "DATE", "date", "Start.", False),
            C("valid_to", "DATE", "date", "End.", False),
            C("conditions", "STRING", "text", "Conditions (notice within 30 days, cap €35,000, exclusion for operator maintenance default).", False),
          ]),
        ],
      },
    ],
  },
]

def iter_tables():
    for proj in PROJECTS:
        for ds in proj["datasets"]:
            for t in ds["tables"]:
                yield proj, ds, t

def table_key(ds, t):
    return f"{ds['dataset_id']}.{t[0]}"

def check():
    n_t = n_c = 0
    for proj, ds, t in iter_tables():
        n_t += 1
        for c in t[5]:
            n_c += 1
            assert c[2] in ALLOWED_CLASSES, (t[0], c)
    return n_t, n_c

if __name__ == "__main__":
    print(check())
