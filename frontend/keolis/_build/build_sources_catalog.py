"""Sources, Data Catalog and platform keys: google_account, auth_roles, credentials, projects, drives,
drive_credentials, mail_corpus, settings, column_profiles, column_vocabulary, document_vocabulary,
document_extractions, data_model, change_signals."""
import json, os
from world import *
import tables as T
import corpus as C

HERE = os.path.dirname(__file__)
STATS = json.load(open(os.path.join(HERE, "corpus_stats.json")))

def google_account():
    return {"email": "nishant.srivastav@vriodigital.com", "name": "Nishant Srivastav", "picture": None}

AUTH_ROLES = [
    {"role_id": "business_user_exec", "label": "Business User -- Executive", "access_note": "All contracts, all projects, all financials. The persona the executive walkthrough is written for."},
    {"role_id": "analyst", "label": "Data Analyst", "access_note": "All projects and financials. Supplier contacts and technician narratives masked (PII)."},
    {"role_id": "architect", "label": "Domain Architect", "access_note": "Everything, at every grain, including supplier commercial terms and the contract register."},
    {"role_id": "admin", "label": "Platform Admin", "access_note": "Structure, lineage, cost and access. No financial values -- an admin configures the platform, not the portfolio."},
]

def credentials():
    return [{"project_id": p["project_id"], "credential_handle": "cred-handle-" + md5_8(p["project_id"])} for p in T.PROJECTS]

def _to_review(ds, cols):
    if ds["declared"]:
        return 0
    return sum(1 for c in cols if c[7] is not None and c[7] < 0.85)

def projects():
    out = []
    for p in T.PROJECTS:
        dss = []
        for ds in p["datasets"]:
            tabs = []
            for (tid, label, typ, grain, rows, cols) in ds["tables"]:
                tabs.append({
                    "table_id": tid, "label": label, "type": typ, "grain": grain, "rows": rows, "columns": len(cols),
                    "pii_columns": sum(1 for c in cols if c[4]), "to_review": _to_review(ds, cols),
                    "size_gb": round(rows * len(cols) * 38 / 1e9, 3), "partitioned": rows > 20000, "profiled_in_full": not ds["declared"] and rows < 20000,
                    "carries": label.split(" — ")[0] + ".",
                    "rows_basis": "profiled in full" if (not ds["declared"] and rows < 20000) else ("sampled — 20,000-row profile, count from table metadata" if not ds["declared"] else "counted from table metadata; columns declared in " + ds["dictionary"]),
                })
            dss.append({"dataset_id": ds["dataset_id"], "dataset_ref": ds["dataset_ref"], "location": p["location"], "description": ds["description"],
                        "semantic_layer": ds["semantic_layer"], "as_of": ds["as_of"], "freshness": ds["freshness"], "tables": tabs})
        out.append({"project_id": p["project_id"], "display_name": p["display_name"], "location": p["location"], "datasets": dss})
    return out

def _label(col, declared):
    return col.replace("_", " ").upper() if declared else col

def column_profiles():
    out = {}
    for proj, ds, t in T.iter_tables():
        rows = []
        for c in t[5]:
            name, typ, cls, desc, pii = c[:5]
            if ds["declared"]:
                rows.append({"column_id": name, "label": _label(name, True), "type": typ, "class": cls, "description": desc,
                             "derivation": f"declared in {ds['dictionary']}", "pii": pii, "confidence": None, "null_pct": None, "distinct": None})
            else:
                rows.append({"column_id": name, "label": name, "type": typ, "class": cls, "description": desc, "derivation": None,
                             "confidence": c[7], "pii": pii, "null_pct": c[5], "distinct": c[6]})
        out[T.table_key(ds, t)] = rows
    return out

def column_vocabulary():
    seen, rows = set(), []
    for proj, ds, t in T.iter_tables():
        if ds["declared"]:
            continue
        for c in t[5]:
            if c[0] in seen:
                continue
            seen.add(c[0])
            t0 = {"STRING": "string", "DATE": "date", "TIMESTAMP": "date", "NUMERIC": "numeric", "INT64": "numeric", "BOOLEAN": "boolean"}[c[1]]
            r = {"name": c[0], "type": t0, "class": c[2], "confidence": c[7]}
            if c[4]:
                r["pii"] = True
            rows.append(r)
    rows.sort(key=lambda r: -r["confidence"])
    return rows[:50]

DOCUMENT_VOCAB = [
    ("document_id", "string", "identifier", 0.95), ("project_code", "string", "identifier", 0.97), ("contract_no", "string", "identifier", 0.94),
    ("document_title", "string", "label", 0.93), ("document_type", "string", "classification", 0.91), ("revision", "string", "classification", 0.88),
    ("effective_date", "date", "date", 0.9), ("received_date", "date", "date", 0.87), ("signed_date", "date", "date", 0.89),
    ("party_authority", "string", "organisation", 0.92), ("party_operator", "string", "organisation", 0.93), ("supplier_name", "string", "organisation", 0.9),
    ("clause_ref", "string", "identifier", 0.86), ("asset_ref", "string", "identifier", 0.92), ("amount_eur", "numeric", "measure_record", 0.85),
    ("amount_basis", "string", "classification", 0.8), ("cap_eur", "numeric", "measure_commitment", 0.84), ("notice_days", "numeric", "measure", 0.83),
    ("status_stated", "string", "lifecycle_state", 0.82), ("finding_severity", "string", "risk_score", 0.84), ("chainage", "string", "geography", 0.81),
    ("signatory_name", "string", "person", 0.9), ("author_name", "string", "person", 0.88), ("statement_kind", "string", "classification", 0.79),
]
def document_vocabulary():
    out = []
    for n, t, c, conf in DOCUMENT_VOCAB:
        r = {"name": n, "type": t, "class": c, "confidence": conf}
        if c == "person":
            r["pii"] = True
        out.append(r)
    return out

def drive_credentials():
    return [{"drive_id": C.DRIVE_ID, "credential_handle": "drive-handle-" + md5_8(C.DRIVE_ID)},
            {"drive_id": C.MYDRIVE_ID, "credential_handle": "drive-handle-" + md5_8(C.MYDRIVE_ID)}]

def _folder_desc(fid, docs):
    f = next(x for x in C.FOLDERS if x[0] == fid)
    if f[4]:
        return f[4]
    code = f[2].split(" - ")[0]
    p = PBY.get(code)
    nc = sum(1 for d in docs if d["doc_type"] in ("contract", "amendment"))
    if p and p["budget"]:
        return f"{len(docs)} documents · {nc} contract(s) · {eur(p['budget'])} approved, {eur(p['forecast'])} forecast"
    if p:
        return f"{len(docs)} documents · unfunded — estimate {eur(p['forecast'])}"
    return f"{len(docs)} documents · need under review — no project yet"

def _doc_row(d):
    s = STATS["docs"][d["document_id"]]
    row = {"document_id": d["document_id"], "name": d["name"], "mime_type": d["mime_type"], "doc_type": d["doc_type"], "doc_type_label": d["doc_type_label"],
           "linked_entity": d["linked_entity"], "project_code": d["project_code"] or "PORTFOLIO", "pages": s["pages"], "size_mb": max(s["size_mb"], 0.01),
           "entities": len(d["extractions"]), "contract_no": d["contract_no"], "modified": d["modified"], "char_count": s["char_count"],
           "chunk_count": s["chunk_count"]}
    if d["folder"] == "f_my_workings":
        row["excerpt"] = s["text"][:300]
    else:
        row["chunks_derived"] = True
    return row

def drives():
    out = []
    for drive_id, name, kind, owner in ((C.DRIVE_ID, C.DRIVE_NAME, "shared_drive", "amelie.roussel@vriodigital.com"), (C.MYDRIVE_ID, "My Drive", "my_drive", None)):
        folders = []
        for f in C.FOLDERS:
            if f[3] != drive_id:
                continue
            docs = [d for d in C.DOCS if d["folder"] == f[0]]
            root = C.DRIVE_NAME if kind == "shared_drive" else "My Drive"
            folders.append({"folder_id": f[0], "name": f[2], "path": f"/{root}/{f[2]}", "description": _folder_desc(f[0], docs),
                            "documents": [_doc_row(d) for d in docs], "parent_id": f[1]})
        dr = {"drive_id": drive_id, "display_name": name, "kind": kind}
        if owner:
            dr["owner"] = owner
        dr["folders"] = folders
        out.append(dr)
    return out

SITE_OF = {"P-VM-014": "Dépôt Saint-Roch", "P-VM-021": "Dépôt Les Aubiers", "P-VM-008": "Tram T1 — Gare Centrale ↔ Pont Neuf", "P-VM-031": "Dépôt Saint-Roch",
           "P-VM-005": "Centre de maintenance tram La Varenne", "P-VM-017": "SST-04 Pont Neuf", "P-VM-026": "Dépôt Saint-Roch", None: "Réseau Valmo (network-wide)"}

def document_extractions():
    out, n = {}, 0
    folder_counts = {}
    for d in C.DOCS:
        folder_counts[d["folder"]] = folder_counts.get(d["folder"], 0) + 1
    for d in C.DOCS:
        rows = []
        for (ent, etype, node, norm, method, page, conf) in d["extractions"]:
            n += 1
            rows.append({"extraction_id": f"ex_{n:04d}", "extracted_entity": ent, "entity_type": etype, "resolved_node": node,
                         "resolved_facility": SITE_OF.get(d["project_code"], "Réseau Valmo (network-wide)"), "state": AUTHORITY,
                         "linked_manifests": folder_counts[d["folder"]], "confidence": conf, "document_id": d["document_id"], "source_file": d["name"],
                         "project_code": d["project_code"] or "PORTFOLIO", "normalized_value": norm, "method": method, "page": page})
        out[d["document_id"]] = rows
    return out

def mail_corpus():
    docs = []
    for em, s in STATS["mail"].items():
        ents = sum(1 for m in C.MAILS if m["thread"] == em for _ in (m["project"], m["resolved_to"]) if _)
        docs.append({"document_id": uuid5("mail/" + em), "label_id": "INBOX", "name": s["name"], "mime_type": "application/pdf", "pages": s["pages"],
                     "size_chars": s["size_chars"], "chunks": s["chunks"], "snippet": s["snippet"], "entities": ents})
    return {"documents": docs}

NAV = ["reports", "ask", "what-if", "new-graph", "sources", "catalog", "graph-studio", "audit", "settings", "ai-submissions"]
def settings():
    def perms(on, off=()):
        return {k: (k in on) for k in NAV}
    allon = [k for k in NAV if k != "settings"]
    users = [{"id": p[0], "role_id": p[1], "name": p[2], "email": p[3]} for p in PEOPLE]
    nav_on = [k for k in NAV if k not in ("settings", "reports")]
    return {
        "users": users,
        "defaults": {"business_user_exec": perms(allon), "analyst": perms(allon), "architect": perms(allon), "admin": perms(["settings"])},
        "read_only": {"admin": ["settings"]},
        "nav_permissions": {"business_user_exec": perms(nav_on), "analyst": perms(nav_on), "architect": perms(nav_on), "admin": perms(nav_on + ["settings"])},
        "report_permissions": {r: {"open": True, "edit": True, "delete": True} for r in ("business_user_exec", "analyst", "architect", "admin")},
        "report_defaults": {r: {"open": True, "edit": True, "delete": True} for r in ("business_user_exec", "analyst", "architect", "admin")},
    }

# ------------------------------------------------------------------ data modeling
DM_REL = [
    # from_table, from_col, to_table, to_col, rel_type, card, rationale
    ("ppm.project", "project_code", "fin.budget_line", "project_code", "HAS_BUDGET_LINE", "1:N", "Both carry project_code, the capital project key; a project has one budget line per cost category and version."),
    ("ppm.project", "project_code", "fin.cost_transaction", "project_code", "HAS_COST_LINE", "1:N", "Ledger lines carry the project code. Lines without one stay UNALLOCATED rather than being attributed."),
    ("ppm.project", "project_code", "fin.accrual_line", "project_code", "HAS_ACCRUAL", "1:N", "Open accruals are raised per project against a PO line."),
    ("ppm.project", "project_code", "fin.forecast_snapshot", "project_code", "HAS_FORECAST_SNAPSHOT", "1:N", "One snapshot per project per forecast date; the latest Working snapshot is the current forecast."),
    ("ppm.project", "project_code", "fin.funding_claim", "project_code", "CLAIMED_UNDER", "1:N", "Claims to the authority are lined per project."),
    ("ppm.project", "project_code", "proc.po_line", "project_code", "COMMITS", "1:N", "PO lines charged to a project are its commitments."),
    ("ppm.project", "project_code", "ppm.schedule_task", "project_code", "HAS_TASK", "1:N", "Schedule tasks belong to one project."),
    ("ppm.project", "project_code", "ppm.risk_change_register", "project_code", "HAS_RISK_OR_CHANGE", "1:N", "Risks, issues and change requests are registered per project."),
    ("ppm.project", "project_code", "ppm.project_asset_link", "project_code", "AFFECTS_ASSET", "1:N", "The bridge table names the role of each project–asset association; it does not attribute maintenance cost."),
    ("ppm.project", "project_code", "ppm.acceptance_item", "project_code", "REQUIRES_ACCEPTANCE", "1:N", "Acceptance items per project and asset."),
    ("ppm.project_asset_link", "asset_id", "eam.asset_register", "asset_id", "LINKS_ASSET", "N:1", "asset_id is the canonical asset key in both."),
    ("eam.asset_register", "asset_id", "eam.work_order", "asset_id", "HAS_WORK_ORDER", "1:N", "Work orders carry the asset worked on."),
    ("eam.asset_register", "asset_id", "eam.failure_event", "asset_id", "HAS_FAILURE", "1:N", "Failures carry the failed asset."),
    ("eam.asset_register", "asset_id", "eam.condition_assessment", "asset_id", "ASSESSED_BY", "1:N", "Inspections carry the assessed asset."),
    ("eam.asset_register", "asset_id", "eam.availability_interval", "asset_id", "HAS_AVAILABILITY_STATE", "1:N", "Availability intervals per vehicle; the only valid source for 'is it available'."),
    ("eam.asset_register", "asset_id", "eam.component_installation", "parent_asset_id", "HOSTS_COMPONENT", "1:N", "Components installed in a vehicle over dated intervals."),
    ("eam.asset_register", "asset_id", "eam.maintenance_plan_due", "asset_id", "HAS_PLANNED_TASK", "1:N", "Planned maintenance due points per asset."),
    ("eam.failure_event", "failure_id", "eam.work_order", "failure_id", "ANSWERED_BY", "1:N", "Corrective work orders reference the failure they answer."),
    ("eam.component_installation", "component_serial", "telemetry.battery_soh_daily", "component_serial", "HAS_SOH_READING", "1:N", "Battery pack serial joins the telemetry aggregate."),
    ("proc.po_line", "po_line", "proc.supplier_commitment_event", "po_line", "HAS_SUPPLIER_PROMISE", "1:N", "Every dated supplier statement about a PO line."),
    ("proc.po_line", "po_line", "proc.goods_receipt", "po_line", "RECEIVED_BY", "1:N", "Receipts against the PO line."),
    ("proc.po_line", "supplier_id", "proc.supplier", "supplier_id", "SUPPLIED_BY", "N:1", "Supplier key."),
    ("ppm.intervention_need", "need_id", "ppm.option_appraisal", "need_id", "HAS_OPTION", "1:N", "Options appraised per need."),
    ("ops.access_window", "segment_id", "eam.asset_register", "asset_id", "GRANTS_ACCESS_TO", "N:1", "Access requests name the track segment, which is an asset."),
    ("contract.contract_version", "contract_id", "ppm.project", "contract_id", "GOVERNS_PROJECT", "1:N", "Every project sits under one operating contract."),
]
DM_SUGGEST = [
    ("sg_kv_resp_asset_scope", "contract.responsibility_assignment", "asset_scope", "eam.asset_register", "asset_id", "ASSIGNS_RESPONSIBILITY_FOR", ["COVERS_ASSET", "SCOPES"], "N:N",
     "asset_scope holds ranges ('BUS-201..BUS-208') as well as single asset_ids, so an equality join matches only the single-asset rows. Declare it as a range relationship, or expand the ranges in the contract register first.", 0.62),
    ("sg_kv_wo_project", "eam.work_order", "project_code", "ppm.project", "project_code", "PART_OF_PROJECT", ["CHARGED_TO", "DELIVERS"], "N:1",
     "work_order.project_code is populated on 5.9% of orders (project tasks). The rest are maintenance and must not be attributed to a project because the asset is linked to one.", 0.81),
    ("sg_kv_claim_need", "fin.funding_claim", "project_code", "ppm.intervention_need", "need_id", "CLAIMS_FOR_NEED", ["RECOVERS"], "N:1",
     "funding_claim.project_code carries N-VM codes for potential recoveries (N-VM-044), which live in intervention_need, not project.", 0.74),
    ("sg_kv_accrual_po", "fin.accrual_line", "po_line", "proc.po_line", "po_line", "ACCRUES_AGAINST", ["MATCHES"], "N:1",
     "Accruals are raised against a PO line; matched_invoice null means the accrual is still valid.", 0.86),
    ("sg_kv_task_access", "ppm.schedule_task", "predecessor", "ops.access_window", "access_ref", "DEPENDS_ON_ACCESS", ["WAITS_FOR"], "N:1",
     "schedule_task.predecessor carries access references (ACC-…) as well as task ids; only the ACC- values resolve here.", 0.69),
]

def data_model():
    ents = {}
    for i, (ft, fc, tt, tc, rt, card, why) in enumerate(DM_REL):
        for tk in (ft,):
            e = ents.setdefault(tk, {"entity_id": f"ent-{tk.replace('.', '-').replace('_', '-')}-kv{md5_8(tk)[:5]}", "confirmed_by": None, "table_key": tk,
                                    "entity_name": tk.split(".")[1], "description": f"Entity for {tk.split('.')[1]}, created to anchor a declared relationship.",
                                    "business_purpose": None, "grain_description": None, "attributes": [], "relationships": [], "cross_attributes": [],
                                    "updated_at": f"2026-09-2{2 + i % 2}T1{i % 10}:0{i % 6}:12.000Z"})
            e["relationships"].append({"target_table_key": tt, "from_columns": [fc], "to_columns": [tc], "relationship_type": rt, "cardinality_hint": card,
                                       "rationale": why, "confirmed_by": "nishant.srivastav@vriodigital.com"})
        ents.setdefault(tt, {"entity_id": f"ent-{tt.replace('.', '-').replace('_', '-')}-kv{md5_8(tt)[:5]}", "confirmed_by": None, "table_key": tt,
                             "entity_name": tt.split(".")[1], "description": f"Entity for {tt.split('.')[1]}, created to anchor a declared relationship.",
                             "business_purpose": None, "grain_description": None, "attributes": [], "relationships": [], "cross_attributes": [],
                             "updated_at": "2026-09-22T14:02:41.000Z"})
    sugg = [{"suggestion_id": s[0], "from_table_key": s[1], "from_column": s[2], "to_table_key": s[3], "to_column": s[4], "relationship_type": s[5],
             "relationship_type_alternatives": s[6], "cardinality_hint": s[7], "rationale": s[8], "confidence": s[9]} for s in DM_SUGGEST]
    return {"suggestions": sugg, "entities": list(ents.values())}

def change_signals():
    t = portfolio_totals()
    return [
        {"signal_id": "sig-kv-01", "kind": "missing_instances", "severity": "serious", "dataset": "g_keolis_valmont_sgr", "table": "No workforce or crew-availability source",
         "detail": "Readiness checks on skills, certifications and crew hours have nothing to read: workforce planning is not connected. The readiness answer covers scope, funding, design, parts, access and acceptance only.",
         "action": "Do not infer crew availability from work-order labour hours — booked hours are not capacity.", "detected": AS_OF},
        {"signal_id": "sig-kv-02", "kind": "missing_instances", "severity": "serious", "dataset": "g_keolis_valmont_sgr", "table": "No GIS or linear-asset geometry",
         "detail": "Track segments resolve from the EAM register and the PPM text (chainage strings), not from a GIS. Adjacent-asset checks (e.g. SIG-T1-044 inside the revision C limit) come from the drawing revision note, not from geometry.",
         "action": "Do not compute distances or overlaps between segments; state the drawing as the source.", "detected": AS_OF},
        {"signal_id": "sig-kv-03", "kind": "sampling_limit", "severity": "warning", "dataset": "g_keolis_valmont_sgr", "table": "4 projects carry no current forecast",
         "detail": f"{', '.join(t['no_forecast'])} have no forecast snapshot since June 2026. Portfolio forecast figures exclude them and say so.",
         "action": "Never state 'the portfolio is within budget' without the assessed population beside it.", "detected": AS_OF},
        {"signal_id": "sig-kv-04", "kind": "shallow_chain", "severity": "warning", "dataset": "g_keolis_valmont_sgr", "table": "Unallocated ledger lines — €1.31M",
         "detail": "412 cost lines worth €1,312,480 carry no project code. They are kept as an UNALLOCATED category and are not spread across projects.",
         "action": "Do not attribute unallocated spend to a project because its cost centre matches the project's depot.", "detected": AS_OF},
        {"signal_id": "sig-kv-05", "kind": "missing_instances", "severity": "warning", "dataset": "g_keolis_valmont_sgr", "table": "Telemetry covers buses only",
         "detail": "battery_soh_daily and alarm_summary cover the battery-electric and hybrid bus fleets. Trams, substations and depot equipment have no telemetry feed; predictive questions about them are declined.",
         "action": "Do not extend a bus-fleet failure model to trams or equipment.", "detected": AS_OF},
    ]

def build():
    return {"google_account": google_account(), "auth_roles": AUTH_ROLES, "credentials": credentials(), "projects": projects(), "drives": drives(),
            "drive_credentials": drive_credentials(), "mail_corpus": mail_corpus(), "settings": settings(), "column_profiles": column_profiles(),
            "column_vocabulary": column_vocabulary(), "document_vocabulary": document_vocabulary(), "document_extractions": document_extractions(),
            "data_model": data_model(), "change_signals": change_signals()}

if __name__ == "__main__":
    b = build()
    print({k: (len(v) if hasattr(v, "__len__") else v) for k, v in b.items()})
