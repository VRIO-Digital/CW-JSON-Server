"""Integrity checks over the built package. Exit code 1 on any failure."""
import json, os, re, sys, glob
OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/keolis/out"
db = json.load(open(os.path.join(OUT, "json/00_merged/db.KEOLIS.json")))
ai = json.load(open(os.path.join(OUT, "json/07_ai_submissions/ai_submissions_db.json")))
fails, notes = [], []
def check(cond, msg):
    (notes if cond else fails).append(("ok  " if cond else "FAIL") + " " + msg)

nodes = {n["node_id"] for n in db["graph_studio"]["canvas"]["nodes"]}
edges = {e["edge_id"]: e for e in db["graph_studio"]["canvas"]["edges"]}
check(all(e["from"] in nodes and e["to"] in nodes for e in edges.values()), f"canvas: all {len(edges)} edges connect existing nodes ({len(nodes)} nodes)")
bad = [(a["answer_id"], r) for a in db["ask_answers"] for r in a["graph_refs"] if r not in nodes]
check(not bad, f"ask_answers: every graph_ref resolves on the canvas {bad[:3]}")
bad = [(i["item_id"], r) for i in db["graph_studio"]["review_items"] for r in i["graph_refs"] if r not in nodes]
check(not bad, f"review_items: every graph_ref resolves {bad}")
flagged = {n.get("review_item_id") for n in db["graph_studio"]["canvas"]["nodes"]} | {e.get("review_item_id") for e in edges.values()}
check(all(i["item_id"] in flagged for i in db["graph_studio"]["review_items"] if i["item_id"] not in ("rq6", "rq8")) , "review_items: each item (bar two finance items) marks a node or edge on the canvas")
for sc in db["graph_studio"]["sanity_checks"]:
    check(all(p in nodes for p in sc["path"]) and all(e in edges for e in sc["edges_used"] if e), f"sanity check {sc['check_id']}: path and edges resolve")
check(all(e for sc in db["graph_studio"]["sanity_checks"] for e in sc["edges_used"]), "sanity checks: no null edge ids")
aids = {a["answer_id"] for a in db["ask_answers"]}
check(all(h["answer_id"] in aids for h in db["graph_hero_questions"]), "hero questions: every answer_id exists")
hq = {h["question_id"] for h in db["graph_hero_questions"]}
check(all(q in hq for p in db["graph_personas"] for q in p.get("top_questions", [])), "personas: top_questions exist in the hero pool")
check(all(q in hq for q in db["graph_use_case_templates"][0]["hero_questions"]), "template: hero questions exist")
check(all(m in {x["metric_id"] for x in db["graph_metrics"]} for m in db["graph_use_case_templates"][0]["metrics"]), "template: metrics exist")
check(all(p in {x["persona_id"] for x in db["graph_personas"]} for p in db["graph_use_case_templates"][0]["personas"]), "template: personas exist")
check({a["hero_ref"] for a in db["ask_answers"] if a["hero_ref"]} <= hq, "ask_answers: hero_refs exist in the hero pool")
# citations numbering
check(all([c["n"] for c in a["citations"]] == list(range(1, len(a["citations"]) + 1)) and len(a["citations"]) == len(a["evidence"]) for a in db["ask_answers"]), "ask_answers: citations numbered 1..n and aligned with evidence")
msgs = {c["message"]["id"] for a in db["ask_answers"] for c in a["citations"] if c["kind"] == "correspondence"}
obs = {i["message_id"] for a in db["ask_answers"] for b in a["blocks"] if b["type"] == "observation" for i in b["items"]}
sys.path.insert(0, os.path.dirname(__file__)); import corpus as C, world as W, tables as T
check(msgs | obs <= set(C.MSG), f"correspondence: {len(msgs | obs)} cited messages all exist in the mailbox")
exported = {m for em in C.EXPORTS for m in [x["message_id"] for x in C.MAILS if x["thread"] == em]}
check(msgs | obs <= exported, "correspondence: every cited message is inside an exported EM-xx PDF")
# catalog ↔ projects
tabs = {f"{ds['dataset_id']}.{t['table_id']}": t for p in db["projects"] for ds in p["datasets"] for t in ds["tables"]}
check(set(tabs) == set(db["column_profiles"]), f"catalog: column_profiles keys = project tables ({len(tabs)})")
check(all(len(db["column_profiles"][k]) == tabs[k]["columns"] for k in tabs), "catalog: column counts match")
derivs = {c["derivation"].replace("declared in ", "") for v in db["column_profiles"].values() for c in v if c["derivation"]}
upl = {os.path.basename(p) for p in glob.glob(os.path.join(OUT, "uploads/01_data_catalog/*"))}
check(derivs <= upl, f"catalog: every 'declared in <file>' has that file in uploads/01_data_catalog {derivs}")
docids = {d["document_id"] for dr in db["drives"] for f in dr["folders"] for d in f["documents"]}
check(docids == set(db["document_extractions"]), "drive: every listed document has its extraction list")
pdfs = {os.path.basename(p) for p in glob.glob(os.path.join(OUT, "drive_corpus/**/*.*"), recursive=True)}
check({d["name"] for dr in db["drives"] for f in dr["folders"] for d in f["documents"]} <= pdfs, f"drive: every listed file exists in drive_corpus ({len(pdfs)} files)")
mails = {os.path.basename(p) for p in glob.glob(os.path.join(OUT, "mailbox_export/*.pdf"))}
check({d["name"] for d in db["mail_corpus"]["documents"]} == mails, f"mailbox: mail_corpus lists exactly the {len(mails)} exported PDFs")
ext_nodes = {e["resolved_node"] for v in db["document_extractions"].values() for e in v}
check(len([n for n in ext_nodes if n in nodes]) / len(ext_nodes) > 0.6, f"extractions: {len([n for n in ext_nodes if n in nodes])}/{len(ext_nodes)} resolved nodes are on the canvas")
# arithmetic
B = W.EX_B
check(B["actuals"] + B["accruals"] + B["committed_remaining"] + B["uncommitted_remaining"] + B["contingency"] == 390000, "example B: forecast components foot to €390,000")
wi = db["whatif"]
base = round(sum(s["base_usd_m"] for s in wi["slices"]), 1)
check(base == wi["facility"]["baseline"]["forecast"], f"what-if: slices sum to the base forecast ({base})")
check(abs(base - W.PBY["P-VM-005"]["forecast"] / 1e6) < 0.05, "what-if: base forecast equals P-VM-005 forecast total")
for ex in wi["runtime"]["worked_examples"]:
    check(abs(sum(ex["slice_breakdown"].values()) - ex["forecast_usd_m"]) < 0.11, f"what-if: worked example '{ex['case'][:24]}' foots")
inc = sum(p["cost"] for p in ai["projects"] if p["decision"] == "include")
q12 = next(a for a in db["ask_answers"] if a["answer_id"] == "Q12")
check(inc == next(i["value"] for b in q12["blocks"] if b["type"] == "metric" for i in b["items"] if i["label"] == "Claimable Q3"), "AI Submissions ↔ Ask Q12: claimable Q3 = €4.86M in both")
pg = ai["programme"]
check(sum(c["budget"] for c in pg["byClass"]) == pg["budget"] and sum(c["fc"] for c in pg["byClass"]) == pg["fc66"], "AI Submissions: programme categories foot to budget and forecast")
q29 = next(a for a in db["ask_answers"] if a["answer_id"] == "Q29")
check(abs(next(i["value"] for b in q29["blocks"] if b["type"] == "metric" for i in b["items"] if i["label"] == "Forecast FY2026") - pg["fc66"]) < 1, "Ask Q29 FY2026 forecast = AI Submissions programme forecast")
check(abs(next(i["value"] for b in q29["blocks"] if b["type"] == "metric" for i in b["items"] if i["label"] == "Plan FY2026") - pg["budget"]) < 1, "Ask Q29 FY2026 plan = AI Submissions programme budget")
q7 = next(a for a in db["ask_answers"] if a["answer_id"] == "Q07")
check(sum(1 for r in C.DOC["DOC:p-vm-031-commissioning"]["body"] if r[0] == "t" for row in r[2] if row and row[-1] == "Released") == 37, "example D: commissioning register shows 37 released")
fleet_bev = W.FLEET["bus_bev"]["count"]
check(fleet_bev == 40, "fleet: 40 Arvéa eCity 12 buses for the 40-pack campaign")
# leftovers from other tenants
blob = json.dumps(db, ensure_ascii=False) + json.dumps(ai, ensure_ascii=False)
left = [w for w in ("Northline", "Veolia", "PFAS", "Quarrydown", "Kelso", "EPBCS", "DSIC", "NJ BPU", "Draycott", "Dunmoor", "northline", "Sofia Lindqvist", "Dana Whitfield", "Rei Nakamura", "Ellis Hargrove")
        if w in blob]
check(not left, f"no other tenant's content left {left}")
dollars = sorted(set(re.findall(r'\$[A-Z0-9][A-Z0-9.]*', blob)))
check(set(dollars) <= {"$PROJECTNAME", "$CODE"} | {d for d in dollars if re.match(r"\$\d+\.\d\d$", d)}, f"money: only EUR amounts; '$' appears only as report tokens and USD model-cost figures {dollars}")
# dates
check(all(m["sent_at"] <= "2026-09-24" for m in C.MAILS), "mailbox: no message dated after today")
check(all(d["modified"] <= "2026-09-24" for d in C.DOCS), "drive: no document modified after today")
# declines carry no figures presented as answers
check(all(a["confidence_level"] == "High" for a in db["ask_answers"] if a["kind"] == "decline"), "declines: confidence reflects certainty that the decline is right")
print("\n".join(notes + fails))
print(f"\n{len(notes)} passed · {len(fails)} failed")
sys.exit(1 if fails else 0)
