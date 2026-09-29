-- Keolis Valmont warehouse — reference DDL for the demo (BigQuery dialect). Hypothetical.
-- Do NOT upload this on the profiled datasets (eam, telemetry, fin, proc): see README §Data Catalog.

-- Asset register — one row per physical asset or functional location · grain: one asset per effective period · rows: 1,184
CREATE TABLE `keolis_valmont_eam.eam.asset_register` (
  `asset_id` STRING OPTIONS(description="Canonical asset key (BUS-204, TRAM-117, LIFT-AUB-03, TRK-T1-S07). Stable across fleet-number reissue: a reissued fleet number gets a new asset_id."),
  `source_alias` STRING OPTIONS(description="The EAM's own equipment number. Two networks reuse fleet numbers; the alias is only unique together with network_code."),
  `network_code` STRING OPTIONS(description="Network the asset belongs to. VALMO for every row in this extract."),
  `asset_class` STRING OPTIONS(description="Bus, Tram, Bus component, Tram component, Track, Signalling, Traction power, Charging, Depot equipment, Depot facility, Stations, Systems."),
  `model` STRING OPTIONS(description="Manufacturer model (Arvéa Citybus 12 D, Transalp TV-100 …)."),
  `vin_or_serial` STRING OPTIONS(description="VIN for road vehicles, manufacturer serial for equipment. Null for linear and civil assets."),
  `commissioned_date` DATE OPTIONS(description="Date the asset entered service. For tram TV-100 this is the 2008–09 acceptance date."),
  `status` STRING OPTIONS(description="In service, Restricted, Withdrawn, Awaiting disposal."),
  `site_id` STRING OPTIONS(description="Home depot or location (DEP-AUB, DEP-SRO, DEP-CMT, or a line segment for linear assets)."),
  `owner_party` STRING OPTIONS(description="Legal owner as the EAM records it. Always 'Valmont Métropole' for biens de retour — ownership is not responsibility; see contract.responsibility_assignment."),
  `criticality` STRING OPTIONS(description="Engineering criticality A/B/C. A = a failure removes service or creates a safety restriction."),
  `valid_from` DATE OPTIONS(description="Start of this version of the asset record."),
  `valid_to` DATE OPTIONS(description="End of this version; null for the current row.")
);

-- Component installations — one row per install interval · grain: one component serial x parent asset x install interval · rows: 6,412
CREATE TABLE `keolis_valmont_eam.eam.component_installation` (
  `component_serial` STRING OPTIONS(description="Serial of the installed component (traction battery pack, engine, bogie, pantograph)."),
  `component_type` STRING OPTIONS(description="Battery pack, Engine, Gearbox, Bogie, Pantograph, Door drive, HVAC unit."),
  `parent_asset_id` STRING OPTIONS(description="The vehicle the component sits in during this interval. Joins asset_register.asset_id."),
  `position` STRING OPTIONS(description="Position on the parent (roof pack 1, bogie B2 …)."),
  `installed_at` TIMESTAMP OPTIONS(description="Install timestamp."),
  `removed_at` TIMESTAMP OPTIONS(description="Removal timestamp; null while installed."),
  `usage_at_transfer_km` NUMERIC OPTIONS(description="Accumulated component km at installation, carried across vehicles."),
  `removal_reason` STRING OPTIONS(description="Failure, Campaign, Transfer, Overhaul."),
  `project_code` STRING OPTIONS(description="Capital project the installation belongs to, where it was a campaign (P-VM-031 for the battery campaign). Null for routine swaps.")
);

-- Work orders — one row per work order · grain: one work order · rows: 48,210
CREATE TABLE `keolis_valmont_eam.eam.work_order` (
  `wo_id` STRING OPTIONS(description="Work order key (WO-2026-071244)."),
  `wo_type` STRING OPTIONS(description="Corrective, Preventive, Campaign, Inspection, Modification."),
  `priority` STRING OPTIONS(description="P1 (service-affecting) to P4."),
  `status` STRING OPTIONS(description="Open, In progress, Awaiting parts, Closed, Cancelled. An open work order does NOT mean the vehicle is unavailable — use availability_interval."),
  `asset_id` STRING OPTIONS(description="Asset worked on. Joins asset_register.asset_id."),
  `failure_id` STRING OPTIONS(description="The failure event the work order answers, for corrective work."),
  `project_code` STRING OPTIONS(description="Capital project code where the work is a project task; null for maintenance."),
  `scheduled_start` DATE OPTIONS(description="Planned start."),
  `actual_finish` TIMESTAMP OPTIONS(description="Close-out timestamp. Null while open; 312 closed orders lack it (known close-out gap)."),
  `labour_hours` NUMERIC OPTIONS(description="Booked technician hours."),
  `material_cost_eur` NUMERIC OPTIONS(description="Parts issued against the order, EUR HT, at stores average cost."),
  `technician_note` STRING OPTIONS(description="Free-text narrative from the technician. Can carry names — masked for Data Analyst.")
);

-- Failures and defects — one row per reported failure · grain: one failure event · rows: 9,876
CREATE TABLE `keolis_valmont_eam.eam.failure_event` (
  `failure_id` STRING OPTIONS(description="Failure key."),
  `asset_id` STRING OPTIONS(description="Failed asset."),
  `component_serial` STRING OPTIONS(description="Failed component where known."),
  `failed_at` TIMESTAMP OPTIONS(description="Time of failure as reported by the driver or the system."),
  `symptom_code` STRING OPTIONS(description="Reported symptom (loss of oil pressure, BMS fault, door fault …)."),
  `failure_mode` STRING OPTIONS(description="Confirmed failure mode, set after diagnosis. Null = not yet confirmed — a symptom is not a cause."),
  `severity` STRING OPTIONS(description="S1 (safety/service loss) to S4."),
  `service_restriction` STRING OPTIONS(description="Restriction imposed (withdrawn, speed-restricted, depot-only)."),
  `downtime_start` TIMESTAMP OPTIONS(description="Start of the unavailability this failure caused."),
  `downtime_end` TIMESTAMP OPTIONS(description="End of that unavailability; null if still unavailable or not recorded.")
);

-- Condition assessments — one row per asset per inspection · grain: one asset x inspection · rows: 3,140
CREATE TABLE `keolis_valmont_eam.eam.condition_assessment` (
  `inspection_id` STRING OPTIONS(description="Inspection key (IR-T1-2026-07)."),
  `asset_id` STRING OPTIONS(description="Assessed asset."),
  `inspected_at` DATE OPTIONS(description="Inspection date."),
  `method` STRING OPTIONS(description="Visual, NDT ultrasonic, Rail profile measurement, Thermography, Statutory (lifting equipment)."),
  `score` NUMERIC OPTIONS(description="Condition score in the scale named by score_scale. Scales differ by method — never average across scales."),
  `score_scale` STRING OPTIONS(description="1–5 (FTA-style), 0–100 wear %, pass/restrict/fail."),
  `finding_severity` STRING OPTIONS(description="Minor, Significant, Replacement threshold reached."),
  `next_inspection_due` DATE OPTIONS(description="Next due date for the assessed asset.")
);

-- Usage — one row per asset per month · grain: one asset x month · rows: 21,760
CREATE TABLE `keolis_valmont_eam.eam.usage_monthly` (
  `asset_id` STRING OPTIONS(description="Vehicle or equipment."),
  `period` DATE OPTIONS(description="First day of the month."),
  `distance_km` NUMERIC OPTIONS(description="Odometer km in the month (vehicles)."),
  `operating_hours` NUMERIC OPTIONS(description="Hours in service (equipment, trams)."),
  `meter_reset_flag` BOOL OPTIONS(description="True when the meter was reset or rolled over this month — exclude from exposure until reconciled.")
);

-- Availability — one row per availability state interval · grain: one asset x state interval · rows: 61,402
CREATE TABLE `keolis_valmont_eam.eam.availability_interval` (
  `asset_id` STRING OPTIONS(description="Vehicle."),
  `state` STRING OPTIONS(description="Available, Unavailable."),
  `reason` STRING OPTIONS(description="Corrective, Preventive, Campaign, Awaiting parts, Accident, Not released by engineering."),
  `from_ts` TIMESTAMP OPTIONS(description="Interval start."),
  `to_ts` TIMESTAMP OPTIONS(description="Interval end; null = current state."),
  `engineering_release` BOOL OPTIONS(description="Released by engineering for passenger duty."),
  `depot_id` STRING OPTIONS(description="Depot holding the vehicle during the interval.")
);

-- Maintenance plan — one row per planned task due · grain: one asset x planned task x due point · rows: 12,930
CREATE TABLE `keolis_valmont_eam.eam.maintenance_plan_due` (
  `plan_task_id` STRING OPTIONS(description="Planned task key (OIL-60K, BRAKE-6M …)."),
  `asset_id` STRING OPTIONS(description="Asset the task is due on."),
  `due_km` NUMERIC OPTIONS(description="Due point in km, for distance-based tasks."),
  `due_date` DATE OPTIONS(description="Due date, for calendar-based tasks."),
  `done_at` DATE OPTIONS(description="Completion date; null = not done."),
  `overdue_km` NUMERIC OPTIONS(description="How far past due_km the asset ran before the task was done (or to date).")
);

-- Battery state of health — one row per pack per day · grain: one battery pack x day · rows: 88,410
CREATE TABLE `keolis_valmont_eam.telemetry.battery_soh_daily` (
  `component_serial` STRING OPTIONS(description="Battery pack serial. Joins eam.component_installation.component_serial."),
  `day` DATE OPTIONS(description="Measurement day."),
  `soh_pct` NUMERIC OPTIONS(description="State of health, % of nominal capacity, from the BMS estimator (algorithm v3.2)."),
  `max_cell_temp_spread_c` NUMERIC OPTIONS(description="Max cell-module temperature spread in the day, °C."),
  `quality_flag` STRING OPTIONS(description="OK, Gap, Calibrating.")
);

-- Alarms — one row per asset x alarm code x day · grain: one asset x alarm code x day · rows: 14,220
CREATE TABLE `keolis_valmont_eam.telemetry.alarm_summary` (
  `asset_id` STRING OPTIONS(description="Vehicle or substation."),
  `alarm_code` STRING OPTIONS(description="OEM alarm code (E-214 BMS isolation …)."),
  `day` DATE OPTIONS(description="Day."),
  `occurrences` INT64 OPTIONS(description="Alarm count in the day."),
  `threshold_version` STRING OPTIONS(description="Alarm threshold set in force.")
);

-- Budget lines — one row per project x cost category x version · grain: one project x cost category x budget version · rows: 1,412
CREATE TABLE `keolis_valmont_erp.fin.budget_line` (
  `project_code` STRING OPTIONS(description="Capital project key (P-VM-021)."),
  `cost_category` STRING OPTIONS(description="Works, Equipment, Studies, Internal labour, Contingency."),
  `budget_version` STRING OPTIONS(description="Original baseline, Revised 1, Revised 2 … — each approved version is kept."),
  `amount_eur` NUMERIC OPTIONS(description="Approved amount, EUR HT."),
  `funding_source` STRING OPTIONS(description="PPI (authority), GER (Keolis, inside contract price), GRANT (state via authority)."),
  `approved_date` DATE OPTIONS(description="Approval date of this version."),
  `approver_role` STRING OPTIONS(description="Role that approved the version (Comité d'investissement Keolis Valmont, Bureau métropolitain).")
);

-- Ledger lines — one row per posted cost line · grain: one ledger document line · rows: 36,480
CREATE TABLE `keolis_valmont_erp.fin.cost_transaction` (
  `ledger_doc` STRING OPTIONS(description="Ledger document and line (FI-5100482211/002)."),
  `posting_date` DATE OPTIONS(description="Date the line was posted — a March service can post in April."),
  `service_period` DATE OPTIONS(description="Month the cost relates to."),
  `amount_eur` NUMERIC OPTIONS(description="Posted amount, EUR HT. Negative for reversals."),
  `gl_account` STRING OPTIONS(description="General-ledger account."),
  `cost_center` STRING OPTIONS(description="Cost centre (depot or function)."),
  `project_code` STRING OPTIONS(description="Capital project code. Null on 412 lines worth €1.31M — kept visible as UNALLOCATED, never dropped."),
  `wo_id` STRING OPTIONS(description="EAM work order the cost belongs to, where the line came from stores."),
  `reversal_of` STRING OPTIONS(description="The ledger line this one reverses (accrual reversal on invoice arrival).")
);

-- Accruals — one row per open accrual · grain: one accrual line · rows: 684
CREATE TABLE `keolis_valmont_erp.fin.accrual_line` (
  `accrual_id` STRING OPTIONS(description="Accrual key."),
  `project_code` STRING OPTIONS(description="Project."),
  `po_line` STRING OPTIONS(description="PO line the accrual is raised against."),
  `service_period` DATE OPTIONS(description="Month accrued."),
  `amount_eur` NUMERIC OPTIONS(description="Accrued, not yet invoiced, EUR HT."),
  `matched_invoice` STRING OPTIONS(description="Invoice that reversed this accrual; null = still valid.")
);

-- Forecast snapshots — one row per project x snapshot · grain: one project x forecast snapshot · rows: 2,210
CREATE TABLE `keolis_valmont_erp.fin.forecast_snapshot` (
  `project_code` STRING OPTIONS(description="Project."),
  `snapshot_date` DATE OPTIONS(description="Forecast date. Monthly, plus ad-hoc re-forecasts."),
  `actual_through` DATE OPTIONS(description="Actuals included up to this date."),
  `ctc_committed_eur` NUMERIC OPTIONS(description="Remaining committed work — not the full PO value again."),
  `ctc_uncommitted_eur` NUMERIC OPTIONS(description="Expected uncommitted work."),
  `contingency_eur` NUMERIC OPTIONS(description="Separately held contingency (not inside the CTC figures)."),
  `scenario` STRING OPTIONS(description="Working, Board, Downside."),
  `approver` STRING OPTIONS(description="Controller who approved the snapshot.")
);

-- Funding claims — one row per claim line · grain: one claim x project · rows: 146
CREATE TABLE `keolis_valmont_erp.fin.funding_claim` (
  `claim_id` STRING OPTIONS(description="Claim key (CLM-2026-Q2-02)."),
  `project_code` STRING OPTIONS(description="Project or need code the claim lines against."),
  `funding_agreement` STRING OPTIONS(description="PPI convention or grant agreement reference."),
  `claimed_eur` NUMERIC OPTIONS(description="Amount claimed, EUR HT."),
  `status` STRING OPTIONS(description="Potential, Submitted, Accepted, Disputed, Paid — five separate states, never collapsed."),
  `submitted_on` DATE OPTIONS(description="Submission date; null for potential lines."),
  `paid_eur` NUMERIC OPTIONS(description="Cash received.")
);

-- PO lines — one row per purchase-order line · grain: one PO line · rows: 9,214
CREATE TABLE `keolis_valmont_erp.proc.po_line` (
  `po_line` STRING OPTIONS(description="PO and line (PO-4500018812/30)."),
  `supplier_id` STRING OPTIONS(description="Supplier."),
  `project_code` STRING OPTIONS(description="Project the line is charged to."),
  `item_text` STRING OPTIONS(description="Item or service."),
  `ordered_eur` NUMERIC OPTIONS(description="Ordered value, EUR HT."),
  `received_eur` NUMERIC OPTIONS(description="Received value to date."),
  `cancelled_eur` NUMERIC OPTIONS(description="Cancelled value."),
  `required_date` DATE OPTIONS(description="Date the project needs the item."),
  `promised_date` DATE OPTIONS(description="Supplier's latest promised date as recorded in the ERP — can lag correspondence.")
);

-- Receipts — one row per goods receipt · grain: one receipt line · rows: 12,840
CREATE TABLE `keolis_valmont_erp.proc.goods_receipt` (
  `receipt_id` STRING OPTIONS(description="Receipt key."),
  `po_line` STRING OPTIONS(description="PO line received against."),
  `received_on` DATE OPTIONS(description="Receipt date."),
  `quantity` NUMERIC OPTIONS(description="Quantity received."),
  `quality_hold` BOOL OPTIONS(description="Held by quality inspection.")
);

-- Suppliers — one row per supplier · grain: one supplier · rows: 402
CREATE TABLE `keolis_valmont_erp.proc.supplier` (
  `supplier_id` STRING OPTIONS(description="Supplier key (SUP-0214)."),
  `supplier_name` STRING OPTIONS(description="Registered name."),
  `category` STRING OPTIONS(description="Rolling stock, Equipment, Works, Systems, Services."),
  `contact_email` STRING OPTIONS(description="Account manager email — PII, masked for Data Analyst.")
);

-- Stores — one row per part x location · grain: one part x stores location · rows: 5,620
CREATE TABLE `keolis_valmont_erp.proc.part_inventory` (
  `part_id` STRING OPTIONS(description="Part number."),
  `location` STRING OPTIONS(description="Stores location (depot)."),
  `on_hand` NUMERIC OPTIONS(description="Quantity on hand."),
  `reserved` NUMERIC OPTIONS(description="Reserved — including emergency-maintenance reserve, which a project cannot draw."),
  `lead_time_days` INT64 OPTIONS(description="Replenishment lead time.")
);

-- Supplier commitments — one row per dated promise · grain: one supplier statement about one PO line · rows: 1,318
CREATE TABLE `keolis_valmont_erp.proc.supplier_commitment_event` (
  `event_id` STRING OPTIONS(description="Event key."),
  `po_line` STRING OPTIONS(description="PO line the statement is about."),
  `stated_on` DATE OPTIONS(description="When the supplier said it."),
  `promised_date` DATE OPTIONS(description="Date promised in that statement."),
  `source` STRING OPTIONS(description="ERP update, Supplier portal, Email (runtime — confirmed only when procurement records it)."),
  `confirmed` BOOL OPTIONS(description="Recorded by procurement. An email promise stays unconfirmed until then.")
);

-- Projects — one row per project · grain: one project (current version) · rows: 38
CREATE TABLE `keolis_valmont_ppm.ppm.project` (
  `project_code` STRING OPTIONS(description="Capital project key (P-VM-021). Needs use N-VM-nnn and live in intervention_need."),
  `project_name` STRING OPTIONS(description="Project title."),
  `category` STRING OPTIONS(description="Fleet — bus, Fleet — tram, Depot & workshop, Track & civil, Signalling & systems, Power & charging, Stations & passenger info."),
  `stage` STRING OPTIONS(description="Need, Option study, Approved, In delivery, Commissioning, Accepted."),
  `contract_id` STRING OPTIONS(description="Operating contract the project sits under (DSP-VM-2021)."),
  `maitre_ouvrage` STRING OPTIONS(description="Who owns the delivery decision (Valmont Métropole, or Keolis Valmont as delegated)."),
  `project_manager` STRING OPTIONS(description="Accountable project manager."),
  `purpose_sgr_pct` NUMERIC OPTIONS(description="Share of scope that is renewal (state of good repair). Business purpose, not accounting treatment."),
  `purpose_transition_pct` NUMERIC OPTIONS(description="Share that is energy transition."),
  `purpose_expansion_pct` NUMERIC OPTIONS(description="Share that is capacity growth."),
  `baseline_version` STRING OPTIONS(description="Approved schedule baseline in force (BL1, BL2).")
);

-- Work packages — one row per work package · grain: one work package · rows: 164
CREATE TABLE `keolis_valmont_ppm.ppm.work_package` (
  `wp_id` STRING OPTIONS(description="Work package key (P-VM-021-WP03)."),
  `project_code` STRING OPTIONS(description="Parent project."),
  `wp_name` STRING OPTIONS(description="Work package title."),
  `allocation_basis` STRING OPTIONS(description="How costs are allocated to it (direct, % of PO line, unallocated).")
);

-- Project ↔ asset links — one row per association · grain: one project x asset x role · rows: 612
CREATE TABLE `keolis_valmont_ppm.ppm.project_asset_link` (
  `project_code` STRING OPTIONS(description="Project."),
  `asset_id` STRING OPTIONS(description="Asset. A link says the project touches the asset — it does not attribute the asset's maintenance cost to the project."),
  `role` STRING OPTIONS(description="Replaces, Renews, Withdraws for works, Depends on, Affects service of."),
  `withdrawal_from` DATE OPTIONS(description="Start of any withdrawal from service the project causes."),
  `withdrawal_to` DATE OPTIONS(description="End of that withdrawal.")
);

-- Schedule — one row per task x baseline · grain: one task (baseline and current dates) · rows: 1,406
CREATE TABLE `keolis_valmont_ppm.ppm.schedule_task` (
  `task_id` STRING OPTIONS(description="Task key."),
  `project_code` STRING OPTIONS(description="Project."),
  `task_name` STRING OPTIONS(description="Task."),
  `baseline_finish` DATE OPTIONS(description="Approved baseline finish."),
  `current_finish` DATE OPTIONS(description="Current forecast finish, as the project office last published it."),
  `predecessor` STRING OPTIONS(description="Predecessor task or external dependency (PO line, access window)."),
  `progress_pct` NUMERIC OPTIONS(description="Reported physical progress.")
);

-- Risks, issues and changes — one row per item · grain: one risk, issue or change request · rows: 318
CREATE TABLE `keolis_valmont_ppm.ppm.risk_change_register` (
  `item_id` STRING OPTIONS(description="Register key (RC-008-014)."),
  `project_code` STRING OPTIONS(description="Project."),
  `item_type` STRING OPTIONS(description="Risk (possible), Issue (happened), Change request (asks for authorisation)."),
  `status` STRING OPTIONS(description="Open, Mitigating, Approved, Rejected, Closed."),
  `cost_impact_eur` NUMERIC OPTIONS(description="Requested or estimated cost impact, EUR HT."),
  `date_impact_days` INT64 OPTIONS(description="Requested or estimated schedule impact."),
  `owner` STRING OPTIONS(description="Owner.")
);

-- Approvals — one row per decision x version · grain: one approval decision on one object version · rows: 211
CREATE TABLE `keolis_valmont_ppm.ppm.approval_decision` (
  `decision_id` STRING OPTIONS(description="Decision key."),
  `object_ref` STRING OPTIONS(description="What was approved (project, budget version, change, access request)."),
  `object_version` STRING OPTIONS(description="Version approved."),
  `approver_role` STRING OPTIONS(description="Approving body or role."),
  `decided_on` DATE OPTIONS(description="Decision date."),
  `decision` STRING OPTIONS(description="Approved, Approved with conditions, Deferred, Rejected."),
  `conditions` STRING OPTIONS(description="Conditions attached — an approval with open conditions is not unconditional.")
);

-- Needs — one row per candidate intervention · grain: one need (funded or not) · rows: 47
CREATE TABLE `keolis_valmont_ppm.ppm.intervention_need` (
  `need_id` STRING OPTIONS(description="Need key (N-VM-044). Exists before any project does — this is where the unfunded backlog lives."),
  `asset_scope` STRING OPTIONS(description="Asset or asset group."),
  `trigger` STRING OPTIONS(description="Defect, Ageing, Obsolescence, Contract renewal date, Regulatory inspection, Authority plan."),
  `estimate_eur` NUMERIC OPTIONS(description="Order-of-magnitude estimate, EUR HT."),
  `status` STRING OPTIONS(description="Unfunded, Option study, Deferred, Combined, Approved, Under review."),
  `mandatory_basis` STRING OPTIONS(description="Why it cannot be deferred, where it cannot.")
);

-- Options — one row per option per need · grain: one option x need · rows: 96
CREATE TABLE `keolis_valmont_ppm.ppm.option_appraisal` (
  `need_id` STRING OPTIONS(description="Need."),
  `option` STRING OPTIONS(description="Repair, Overhaul, Replace, Defer."),
  `capex_eur` NUMERIC OPTIONS(description="Capital cost."),
  `life_extension_years` NUMERIC OPTIONS(description="Life gained."),
  `downtime_days` INT64 OPTIONS(description="Service downtime.")
);

-- Acceptance — one row per required acceptance item · grain: one requirement x asset · rows: 1,880
CREATE TABLE `keolis_valmont_ppm.ppm.acceptance_item` (
  `project_code` STRING OPTIONS(description="Project."),
  `asset_id` STRING OPTIONS(description="Asset accepted."),
  `requirement` STRING OPTIONS(description="Required test, certificate or deliverable."),
  `result` STRING OPTIONS(description="Passed, Failed, Missing, Waived."),
  `accepted_by` STRING OPTIONS(description="Accepting party."),
  `restriction` STRING OPTIONS(description="Operating restriction attached to the acceptance.")
);

-- Service requirement — one row per vehicle class x day type x timetable · grain: one vehicle class x day type x timetable version · rows: 96
CREATE TABLE `keolis_valmont_ppm.ops.service_requirement` (
  `timetable_version` STRING OPTIONS(description="Timetable in force (HIV-2026 from 2026-09-01)."),
  `vehicle_class` STRING OPTIONS(description="Bus 12 m, Bus 18 m, Tram."),
  `day_type` STRING OPTIONS(description="Weekday, Saturday, Sunday, School holiday."),
  `peak_required` INT64 OPTIONS(description="Vehicles required at peak."),
  `reserve_required` INT64 OPTIONS(description="Agreed operating reserve.")
);

-- Track access — one row per possession request · grain: one access request · rows: 74
CREATE TABLE `keolis_valmont_ppm.ops.access_window` (
  `access_ref` STRING OPTIONS(description="Request key (ACC-T1-2026-031)."),
  `segment_id` STRING OPTIONS(description="Track segment (TRK-T1-S07)."),
  `window_start` TIMESTAMP OPTIONS(description="Requested start."),
  `window_end` TIMESTAMP OPTIONS(description="Requested end."),
  `status` STRING OPTIONS(description="Requested, Provisional, Approved, Refused. Only Approved is access."),
  `substitution_buses` INT64 OPTIONS(description="Replacement buses planned for the closure.")
);

-- Organisation relationships — one row per relationship x period · grain: one relationship x effective period · rows: 22
CREATE TABLE `keolis_valmont_ppm.contract.org_relationship` (
  `from_org` STRING OPTIONS(description="Organisation (Keolis Valmont SAS)."),
  `to_org` STRING OPTIONS(description="Related organisation (Keolis France, Valmont Métropole)."),
  `relationship` STRING OPTIONS(description="Subsidiary of, Operates for, Maintains for, Overhauls for."),
  `valid_from` DATE OPTIONS(description="Start."),
  `valid_to` DATE OPTIONS(description="End.")
);

-- Contract versions — one row per executed version · grain: one contract version · rows: 4
CREATE TABLE `keolis_valmont_ppm.contract.contract_version` (
  `contract_id` STRING OPTIONS(description="DSP-VM-2021."),
  `version` STRING OPTIONS(description="Base, AV1, AV2, AV3."),
  `effective_date` DATE OPTIONS(description="When the version applies in the business."),
  `received_date` DATE OPTIONS(description="When Keolis received the executed version — knowledge time, kept apart from effective time."),
  `document_ref` STRING OPTIONS(description="Controlled document in the contract folder.")
);

-- Responsibilities — one row per asset scope x role x period · grain: one asset scope x responsibility role x effective period · rows: 146
CREATE TABLE `keolis_valmont_ppm.contract.responsibility_assignment` (
  `asset_scope` STRING OPTIONS(description="Asset or class the assignment covers (BUS-201..BUS-208)."),
  `role` STRING OPTIONS(description="Owner, Operator, Maintainer, Replacement obligor, Payer (heavy component after replacement date), Approver, Handback recipient."),
  `party` STRING OPTIONS(description="Responsible party."),
  `clause_ref` STRING OPTIONS(description="Clause and version (Art. 34.4 / AV2)."),
  `valid_from` DATE OPTIONS(description="Start."),
  `valid_to` DATE OPTIONS(description="End."),
  `conditions` STRING OPTIONS(description="Conditions (notice within 30 days, cap €35,000, exclusion for operator maintenance default).")
);

