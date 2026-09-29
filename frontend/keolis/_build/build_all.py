"""Assemble the Keolis Valmont demo data package.

Writes one JSON file per db.json key, grouped by the screen that reads it, plus the merged
db.KEOLIS.json the JSON server loads as a dataset, the AI Submissions DB, the proposed
document_readings key and an Ask golden set for the validation harness."""
import json, os, sys, shutil
from world import *
import build_sources_catalog as SC
import build_graph as BG
import build_whatif_gov as WG
import answers as AN
import ai_submissions as AI
import uploads as UP

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/keolis/out"
PKG = "keolis_demo_data_package_2026-09-24"

# The CAPEX dataset's key order (what the DbEditor lists), kept so a diff against db.CAPEX.json reads cleanly.
ORDER = ["google_account", "auth_roles", "credentials", "projects", "audit", "traces", "evals", "change_signals", "column_profiles", "column_vocabulary",
         "document_vocabulary", "drives", "drive_credentials", "document_extractions", "graph_domains", "graph_studio", "graph_personas", "graph_hero_questions",
         "graph_answer_formats", "graph_use_cases", "graph_use_case_templates", "ask_answers", "whatif", "reports", "_provenance", "_meta", "settings",
         "reports_prototype", "data_model", "graph_metrics", "mail_corpus", "studio_graph"]

SCREENS = {
    "01_sources": ["google_account", "credentials", "projects", "drives", "drive_credentials", "mail_corpus"],
    "02_data_catalog": ["column_profiles", "column_vocabulary", "document_vocabulary", "document_extractions", "data_model", "change_signals"],
    "03_new_graph": ["graph_domains", "graph_personas", "graph_metrics", "graph_hero_questions", "graph_answer_formats", "graph_use_cases", "graph_use_case_templates"],
    "04_graph_studio": ["graph_studio", "studio_graph"],
    "05_ask": ["ask_answers"],
    "06_what_if": ["whatif"],
    "08_audit_governance": ["audit", "traces", "evals", "reports"],
    "09_platform": ["auth_roles", "settings", "reports_prototype", "_meta", "_provenance"],
}

PROVENANCE = {
    "google_account": "demo login identity (the presenter); unchanged from the existing datasets",
    "auth_roles": "the four persona roles the app already defines; access notes rewritten for Keolis Valmont",
    "credentials": "one handle per GCP project in tables.py; handle = md5(project_id)[:8], deterministic",
    "projects": "tables.py — 3 GCP projects, 7 datasets, 34 tables; row counts are the hypothetical warehouse's",
    "column_profiles": "tables.py — every column; ppm, ops and contract are declared by the dictionaries in uploads/01_data_catalog, the rest carry profiler statistics",
    "column_vocabulary": "the 50 highest-confidence profiled columns",
    "document_vocabulary": "the document-corpus profile of the Drive source",
    "drives": "corpus.py folders and documents; page, character and chunk counts measured from the rendered PDFs",
    "drive_credentials": "one handle per drive; deterministic md5",
    "document_extractions": "corpus.py — the extraction list authored with each document, resolved to canvas node ids",
    "mail_corpus": "corpus.py mailbox — 20 messages in 10 exported threads (mailbox_export/)",
    "graph_domains": "four domains ranked by what the connected data supports; 'Predictive Asset Failure' deliberately ranks none",
    "graph_personas": "seven personas; top_questions are the hero ids each one asks",
    "graph_metrics": "the governed measures of the Fleet & Infrastructure Information Report §10",
    "graph_hero_questions": "every answerable question in ask_answers (hero + standard); rationale computed from each answer's citations",
    "graph_answer_formats": "the block mixes the answers use",
    "graph_use_cases": "the one committed use case — Fleet & Infrastructure Renewal",
    "graph_use_case_templates": "assembled from the ids above",
    "graph_studio": "graph_model.py canvas (concepts, thin instances, measures; spring layout seed 7) + 8 review items + 5 sanity checks",
    "studio_graph": "the as-built graph-version shape: structured lane over 10 selected tables, document lane extracted from the rendered corpus, 25 Bridge type links",
    "ask_answers": "answers.py — 50 recorded answers; every figure computed from world.py",
    "whatif": "build_whatif_gov.py — P-VM-005 forecast decomposed into five slices (three levers)",
    "reports": "three reports and their governance; Reports is hidden from the sidebar for every persona, but governance feeds Audit & Governance",
    "audit": "authored for the demo week (Sep 21–24, 2026)",
    "traces": "11 sealed traces over recorded answers; stats computed from them",
    "evals": "computed from ask_answers, the review queue and the sanity checks",
    "settings": "the seven demo users (all on the demo login domain) and the nav permissions the app uses today (Reports hidden)",
    "reports_prototype": "the Authoring tab fixture — seven anchor projects in EUR millions",
    "data_model": "declared relationships between the 34 tables, confirmed by the presenter, plus 5 open suggestions",
    "change_signals": "the graph's own gaps — what the data cannot support, with the do-not clause",
}

def build():
    db = {}
    db.update(SC.build())
    db.update(BG.build())
    db.update(WG.build())
    db["ask_answers"] = AN.ANS
    db["_meta"] = {"package": PKG, "tenant": "Keolis Valmont (hypothetical — Keolis operating company on the fictional Réseau Valmo)", "schema_source": "the development team's db.CAPEX.json key set and field shapes, read from the demo environment on 2026-09-24",
                   "generated_by": "_build/build_all.py", "as_of": AS_OF, "note": "Every value is generated from _build/world.py, tables.py and corpus.py. Never hand-edit this file — change the generator and rebuild.",
                   "keys_carried_from_capex_schema": len(ORDER)}
    db["_provenance"] = {k: PROVENANCE[k] for k in ORDER if k in PROVENANCE}
    return {k: db[k] for k in ORDER}

def golden(db):
    cases = []
    for a in db["ask_answers"]:
        runtime = any(c["kind"] == "correspondence" for c in a["citations"])
        cases.append({"case_id": f"kv-{a['answer_id'].lower()}", "question": a["question"], "persona": a["persona"],
                      "route": "decline" if a["kind"] == "decline" else ("graph+runtime" if runtime else "graph"),
                      "expected_outcome": "decline" if a["kind"] == "decline" else "answer",
                      "labelled_answer": a["summary"], "must_retrieve": sorted({c["label"] for c in a["citations"] if c["kind"] in ("dataset", "document")}),
                      "must_cite_runtime": sorted({c["message"]["id"] for c in a["citations"] if c["kind"] == "correspondence"}),
                      "must_not": ["assign legal liability", "sum recovery states as cash", "promote an expectation to an approval"] if a["kind"] != "decline" else ["produce a prediction or a figure the data cannot support"],
                      "graph_refs": a["graph_refs"], "confidence_floor": 0.7})
    return {"_about": "Ask golden set for the validation harness — one case per recorded answer. route / expected outcome / labelled answer / must_retrieve, as the harness takes them.", "cases": cases}

def write(db):
    root = os.path.join(OUT, "json")
    if os.path.exists(root):
        shutil.rmtree(root)
    for folder, keys in SCREENS.items():
        os.makedirs(os.path.join(root, folder), exist_ok=True)
        for k in keys:
            with open(os.path.join(root, folder, f"{k}.json"), "w", encoding="utf-8") as fh:
                json.dump(db[k], fh, ensure_ascii=False, indent=2)
    os.makedirs(os.path.join(root, "07_ai_submissions"), exist_ok=True)
    with open(os.path.join(root, "07_ai_submissions", "ai_submissions_db.json"), "w", encoding="utf-8") as fh:
        json.dump(AI.build(), fh, ensure_ascii=False, indent=2)
    with open(os.path.join(root, "03_new_graph", "document_readings.PROPOSED.json"), "w", encoding="utf-8") as fh:
        json.dump(UP.document_readings(), fh, ensure_ascii=False, indent=2)
    os.makedirs(os.path.join(root, "00_merged"), exist_ok=True)
    with open(os.path.join(root, "00_merged", "db.KEOLIS.json"), "w", encoding="utf-8") as fh:
        json.dump(db, fh, ensure_ascii=False, indent=2)
    os.makedirs(os.path.join(OUT, "golden_set"), exist_ok=True)
    with open(os.path.join(OUT, "golden_set", "ask_golden_cases_keolis.json"), "w", encoding="utf-8") as fh:
        json.dump(golden(db), fh, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    db = build()
    write(db)
    sz = os.path.getsize(os.path.join(OUT, "json", "00_merged", "db.KEOLIS.json"))
    print(len(db), "keys ·", round(sz / 1e6, 2), "MB merged")
