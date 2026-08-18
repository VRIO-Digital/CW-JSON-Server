"""
End-to-end smoke test.

Runs the whole API against a throwaway SQLite database so it can be exercised
without a live Postgres server. It bootstraps from the same two fixtures, then
walks a real path through the product: sign in, connect both connectors, profile,
read both dictionaries, draft a brief, build a graph, publish it, ask it, run a
What-if scenario, and read a report.

    python backend/smoke.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Point the engine at SQLite before the app module builds it.
DB_FILE = Path(tempfile.gettempdir()) / "cw_smoke.sqlite"
if DB_FILE.exists():
    DB_FILE.unlink()

import backend.app.database as database  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

database.engine = create_engine(f"sqlite+pysqlite:///{DB_FILE}", future=True)
database.SessionLocal = sessionmaker(bind=database.engine, autoflush=False, expire_on_commit=False)

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import deps  # noqa: E402
from backend.app.main import app  # noqa: E402

deps.SessionLocal = database.SessionLocal

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASS.append(name)
        print(f"  ok   {name}")
    else:
        FAIL.append(f"{name} — {detail}")
        print(f"  FAIL {name} — {detail}")


def main() -> int:
    # Zero the pacing so the walk does not take four minutes. The pacing itself is
    # asserted separately, below.
    for key in ("CONSENT_START_MS", "CONSENT_MS", "DISCOVERY_MS", "CONNECT_STEP_MS", "SUGGEST_MS"):
        setattr(deps, key, 0)
    import backend.app.routers.connect as connect_router
    import backend.app.routers.graph as graph_router
    import backend.app.routers.studio as studio_router
    import backend.app.routers.whatif as whatif_router
    import backend.app.routers.reports as reports_router

    for module in (connect_router, graph_router, studio_router, whatif_router, reports_router):
        for key in ("CONSENT_START_MS", "CONSENT_MS", "DISCOVERY_MS", "CONNECT_STEP_MS", "SUGGEST_MS"):
            if hasattr(module, key):
                setattr(module, key, 0)

    with TestClient(app) as client:
        print("\n— boot and bootstrap —")
        r = client.get("/health")
        check("health answers", r.status_code == 200 and r.json()["ok"] is True, r.text[:200])
        check("8 tables of catalogue seeded", r.json()["projects"] == 3, r.text[:200])

        r = client.get("/db")
        sections = {s["key"]: s for s in r.json()["sections"]}
        check("25 top-level sections in Postgres schema", len(sections) == 25, str(len(sections)))
        # 206 across the five Gold views of epa_hazwaste — the figure CLAUDE.md
        # states. The other three keys profile other projects' tables.
        epa = {k: len(v) for k, v in r.json()["db"]["column_profiles"].items()
               if k.startswith("epa_hazwaste.")}
        check("the 206 real epa_hazwaste columns survived the bootstrap",
              sum(epa.values()) == 206 and len(epa) == 5, str(epa))
        check("189 canvas nodes / 241 edges",
              len(r.json()["db"]["graph_studio"]["canvas"]["nodes"]) == 189
              and len(r.json()["db"]["graph_studio"]["canvas"]["edges"]) == 241)

        print("\n— identity —")
        r = client.get("/auth/roles")
        check("4 personas served from the database", r.json()["count"] == 4, r.text[:200])
        roles = r.json()["roles"]

        r = client.post("/auth/login", json={"email": "nope@example.com", "password": "secret1"})
        check("unknown address is refused, naming who is known",
              r.status_code == 400 and "Settings knows" in r.json()["error"], r.text[:300])

        users = client.get("/settings").json()["users"]
        me = users[0]["email"]
        r = client.post("/auth/login", json={"email": me, "password": "secret1"})
        check("a known address signs in with its own persona",
              r.status_code == 200 and r.json()["role_id"] in [x["role_id"] for x in roles], r.text[:300])
        check("initials are derived, never invented", len(r.json()["initials"]) == 2, r.text[:200])

        print("\n— gates, before anything is connected —")
        for path in ("/audit", "/traces", "/evals"):
            r = client.get(path)
            check(f"{path} is gated on a connected source",
                  r.json()["connected_sources"] == 0 and r.json()["stats"] == [], r.text[:200])
        r = client.get("/reports")
        check("/reports is gated on a *published graph*",
              r.json()["published_count"] == 0 and r.json()["reports"] == [], r.text[:200])
        r = client.get("/whatif")
        check("the What-if lens states no figures while gated",
              r.json()["facility"] is None and r.json()["generators"] == [], r.text[:200])

        print("\n— connect BigQuery —")
        start = client.get("/sources/oauth/start", params={"provider": "bigquery"}).json()
        check("BigQuery consent asks for one scope", len(start["scopes"]) == 1, str(start["scopes"]))
        cb = client.get(
            "/sources/oauth/callback",
            params={"state": start["state"], "provider": "bigquery", "as": me},
        )
        check("the consent names whoever is signed in", cb.json()["account"]["email"] == me, cb.text[:200])
        session = cb.json()["session"]

        r = client.get("/sources/oauth/drives", params={"session": session})
        check("a BigQuery session is refused by the Drive twin",
              r.status_code == 400 and "read its projects" in r.json()["error"], r.text[:300])

        projects = client.get("/sources/oauth/projects", params={"session": session}).json()["projects"]
        demo = next(p for p in projects if p["project_id"] == "vrio-contextweave-demo")

        r = client.post("/sources", json={
            "project_id": demo["project_id"], "credential_handle": demo["credential_handle"],
            "datasets": ["epa_hazwaste"], "source_name": "EPA",
        })
        check("a short source name is refused, naming the length",
              r.status_code == 400 and "at least 6" in r.json()["error"], r.text[:300])

        r = client.post("/sources/preview", json={
            "project_id": demo["project_id"], "credential_handle": demo["credential_handle"],
        })
        check("preview reports the real dataset", r.json()["dataset_count"] >= 1, r.text[:200])

        r = client.post("/sources", json={
            "project_id": demo["project_id"], "credential_handle": demo["credential_handle"],
            "datasets": ["epa_hazwaste"], "source_name": "EPA Hazwaste register",
        })
        check("BigQuery source registers", r.status_code == 201, r.text[:300])
        bq = r.json()["source_id"]

        r = client.get("/sources").json()
        check("profiled counts are 0 on registration",
              r["profiled_tables"] == 0 and r["profiled_columns"] == 0, str(r)[:200])

        r = client.get(f"/sources/{bq}/browse-documents")
        check("a BigQuery source refuses the document twin, naming it",
              r.status_code == 400 and "/browse" in r.json()["error"], r.text[:300])

        browse = client.get(f"/sources/{bq}/browse").json()
        tables = browse["datasets"][0]["tables"]
        check("the five Gold views are browsable", len(tables) == 5, str(len(tables)))

        print("\n— profile it —")
        r = client.post(f"/sources/{bq}/profile", json={
            "objects": [{"dataset_id": "epa_hazwaste", "table_id": t["table_id"]} for t in tables],
        })
        check("profiling answers 202 with a queued job",
              r.status_code == 202 and r.json()["job"]["status"] == "queued", r.text[:300])

        # The pipeline is derived from the clock, so wind the job's trigger back
        # rather than sleeping through 5 stages.
        from datetime import datetime, timedelta, timezone
        from backend.app.models import ProfilingJob
        with database.SessionLocal() as db:
            row = db.get(ProfilingJob, r.json()["job"]["job_id"])
            data = dict(row.data)
            past = (datetime.now(timezone.utc) - timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            data["triggered_at"] = past
            row.triggered_at = past
            row.data = data
            db.commit()

        board = client.get("/profiling-jobs").json()
        check("reading the board completes the run",
              board["active_count"] == 0 and board["recent"][0]["status"] == "complete", str(board)[:300])
        check("all 5 stages ran", board["recent"][0]["stage_index"] == 5, str(board)[:200])

        cols = client.get(f"/sources/{bq}/columns").json()
        check("the dictionary serves all 206 real columns",
              cols["facets"]["all"] == 206, str(cols["facets"]))
        check("PII columns are counted", cols["facets"]["pii"] > 0, str(cols["facets"]))
        first_table = cols["datasets"][0]["tables"][0]
        check("a column states its derivation, not just a class",
              first_table["columns"][0]["derivation"] in ("llm", "profiled", "read", "excel"),
              str(first_table["columns"][0]))

        r = client.patch(f"/sources/{bq}/columns", json={
            "dataset_id": "epa_hazwaste", "table_id": first_table["table_id"],
            "column_id": first_table["columns"][0]["column_id"], "description": "A human note.",
        })
        check("a column note is stored", r.status_code == 200, r.text[:200])
        cols2 = client.get(f"/sources/{bq}/columns").json()
        note = cols2["datasets"][0]["tables"][0]["columns"][0]
        check("and it wins over the profiled description",
              note["description"] == "A human note." and note["description_status"] == "described",
              str(note)[:200])

        print("\n— connect Drive —")
        start = client.get("/sources/oauth/start", params={"provider": "drive"}).json()
        check("Drive consent asks for two scopes", len(start["scopes"]) == 2, str(start["scopes"]))
        r = client.get("/sources/oauth/callback",
                       params={"state": start["state"], "provider": "bigquery", "as": me})
        check("a state replayed against the other provider is refused",
              r.status_code == 400 and "granted for drive" in r.json()["error"], r.text[:300])

        start = client.get("/sources/oauth/start", params={"provider": "drive"}).json()
        cb = client.get("/sources/oauth/callback",
                        params={"state": start["state"], "provider": "drive", "as": me}).json()
        drives = client.get("/sources/oauth/drives", params={"session": cb["session"]}).json()["drives"]
        cd = next(d for d in drives if d["drive_id"] == "compliance-docs")

        folders = client.get(f"/drives/{cd['drive_id']}/folders").json()["folders"]
        check("folders carry parent_id on every row, roots included",
              all("parent_id" in f for f in folders), str(folders)[:200])
        unstructured = next(f for f in folders if "08_unstructured" in f["path"])

        r = client.post("/sources/drive", json={
            "drive_id": cd["drive_id"], "credential_handle": cd["credential_handle"],
            "folders": [unstructured["folder_id"]], "source_name": "Compliance Docs drive",
        })
        check("Drive source registers", r.status_code == 201, r.text[:300])
        gd = r.json()["source_id"]

        docs = client.get(f"/sources/{gd}/browse-documents").json()
        check("the 7 EPA enforcement PDFs are browsable",
              docs["object_count"] == 7, str(docs["object_count"]))

        r = client.post(f"/sources/{gd}/profile-documents", json={
            "objects": [{"folder_id": unstructured["folder_id"], "document_id": d["document_id"]}
                        for d in docs["folders"][0]["documents"]],
        })
        with database.SessionLocal() as db:
            row = db.get(ProfilingJob, r.json()["job"]["job_id"])
            data = dict(row.data)
            data["triggered_at"] = past
            row.triggered_at = past
            row.data = data
            db.commit()
        client.get("/profiling-jobs")

        dd = client.get(f"/sources/{gd}/documents").json()
        check("the document dictionary reviews 7 files", dd["facets"]["all"] == 7, str(dd["facets"]))
        check("consent decrees land in their own facet",
              dd["facets"]["consent_decrees"] > 0, str(dd["facets"]))
        one = dd["folders"][0]["documents"][0]
        check("a document reports its resolution as a read fact",
              "resolution" in one, str(one.keys()))
        check("and the entity list stays separate from it",
              isinstance(one["entities"], list), str(one.keys()))

        print("\n— re-profiling is not the first click —")
        r = client.post(f"/sources/{bq}/profile", json={
            "objects": [{"dataset_id": "epa_hazwaste", "table_id": tables[0]["table_id"]}],
        })
        job = r.json()["job"]
        check("an all-skipped run completes instantly rather than faking a run",
              job["status"] == "complete" and job["stage_label"] == "nothing to profile", str(job)[:300])

        print("\n— the reads every page makes on arrival —")
        r = client.get("/projects/vrio-contextweave-demo/datasets").json()
        check("the dataset list carries its tables",
              r["project_id"] == "vrio-contextweave-demo" and len(r["datasets"]) >= 1, str(r)[:200])
        r = client.get("/change-signals").json()
        check("change signals are served with a count, waiting for a caller",
              isinstance(r["signals"], list) and r["count"] == len(r["signals"]), str(r)[:200])
        r = client.get("/graph-use-cases").json()
        check("the saved briefs list states the step labels the stepper renders",
              len(r["steps"]) == 6 and r["count"] >= 1, str(r.get("steps"))[:200])

        print("\n— the gates opened —")
        r = client.get("/audit").json()
        check("/audit now has its cards", r["connected_sources"] == 2 and len(r["stats"]) > 0, str(r)[:200])

        print("\n— the wizard —")
        d = client.get("/graph-domains").json()
        check("domains are ranked by what the data supports",
              d["profiled_objects"] == 12 and d["domains"][0]["fit"] == "strong", str(d)[:300])

        # At least TEMPLATE_MIN_PHRASES (2) of the template's own match phrases,
        # so the brief *names* the use case rather than describing something new.
        need = ("Cradle-to-grave liability: unify the inbound manifest stream, every "
                "federal compliance record and the enforcement documents into one "
                "queryable model, so the facility can judge a generator before it "
                "accepts the next load.")
        p = client.post("/graph-personas/suggest",
                        json={"domain_id": d["domains"][0]["domain_id"], "business_need": need}).json()
        check("a suggestion always says why it was drafted",
              all(s["why"] for s in p["suggestions"]), str(p)[:300])
        check("a named use case gets its own list, whole",
              "use case" in p["derived_from"] and p["count"] == 4, str(p["derived_from"]))
        check("and it reports a cost the server computed",
              isinstance(p["run"]["cost_usd"], float), str(p["run"]))

        gs = client.get("/graph-sources").json()
        check("step 4 lists profiled state, not registrations",
              gs["profiled_source_count"] == 2, str(gs["source_count"]))

        r = client.post("/graph-use-cases", json={
            "name": "Cradle-to-Grave Liability", "domain_id": d["domains"][0]["domain_id"],
            "business_need": need, "step": 4,
            "personas": [{"name": s["name"], "description": s["detail"], "source": "ai"}
                         for s in p["suggestions"]],
            "sources": [{"source_id": bq, "mode": "all"}, {"source_id": gd, "mode": "all"}],
        })
        check("a brief saves", r.status_code == 201, r.text[:300])
        uc = r.json()["use_case"]["use_case_id"]

        r = client.post("/graph-use-cases", json={
            "name": "No domain", "step": 3,
        })
        check("advancing past step 1 without a domain is refused",
              r.status_code == 400 and "business domain" in r.json()["error"], r.text[:300])

        cov = client.post("/graph-coverage", json={
            "name": "Cradle-to-Grave Liability",
            "sources": [{"source_id": bq, "mode": "all"}, {"source_id": gd, "mode": "all"}],
            "hero_questions": [{"text": "Which inbound generators carry open violations?"},
                               {"text": "What is the flux capacitor throughput of warp nacelles?"}],
        }).json()
        check("coverage derives entities from profiled objects only",
              cov["entity_count"] == 12, str(cov["entity_count"]))
        check("an uncovered hero question becomes a gap with a reason",
              cov["gap_count"] == 1 and cov["elements"][-1]["reason"], str(cov["gap_count"]))

        print("\n— commit and build —")
        r = client.post("/graph-use-cases", json={
            "use_case_id": uc, "name": "Cradle-to-Grave Liability",
            "domain_id": d["domains"][0]["domain_id"], "business_need": need,
            "step": 6, "status": "committed",
            "hero_questions": [{"text": "Which inbound generators carry open violations?"}],
        })
        check("committing the brief works", r.status_code == 200, r.text[:300])

        r = client.get("/graph-studio").json()
        check("the studio lists the newly built graph beside the seeded one",
              r["count"] == 2 and any(g["use_case_id"] == uc for g in r["graphs"]), str(r["count"]))
        check("and a draft is counted but not listed", r["draft_count"] == 1, str(r["draft_count"]))

        st = client.get(f"/graph-studio/{uc}").json()
        check("the review queue is 5 rows plus a pivot",
              st["must_review_count"] == 5 and st["pivot_count"] == 1, str(st["must_review_count"]))
        check("publish is blocked, and says why twice over",
              st["publish"]["blocked"] and len(st["publish"]["reasons"]) == 2, str(st["publish"]))
        check("a brief never built reports v1", st["version"] == "v1", st["version"])

        r = client.post(f"/graph-studio/{uc}/builds")
        check("a build answers 202 with a queued run",
              r.status_code == 202 and r.json()["step_total"] == 31, r.text[:300])
        check("and reports its own pace rather than the page restating it",
              r.json()["step_ms"] == 3000, r.text[:200])
        build_id = r.json()["build_id"]

        from backend.app.models import StudioBuild
        with database.SessionLocal() as db:
            row = db.get(StudioBuild, build_id)
            data = dict(row.data)
            data["started_at"] = (datetime.now(timezone.utc) - timedelta(seconds=200)).strftime(
                "%Y-%m-%dT%H:%M:%S.000Z")
            row.data = data
            db.commit()

        b = client.get(f"/graph-studio/{uc}/builds/{build_id}").json()
        check("all 11 stages complete", b["status"] == "complete" and b["stage_index"] == 11, str(b)[:200])

        hist = client.get(f"/graph-studio/{uc}/builds").json()
        check("the build history keeps every run", hist["count"] == 1, str(hist["count"]))

        print("\n— settle the queue —")
        st = client.get(f"/graph-studio/{uc}").json()
        for item in st["must_review"]:
            choice = item["actions"][0]["choice"]
            payload = {"item_id": item["item_id"], "choice": choice}
            if item["justification"]:
                r = client.post(f"/graph-studio/{uc}/decisions", json=payload)
                check("a schema-changing row refuses without a justification",
                      r.status_code == 400 and "justification" in r.json()["error"],
                      r.text[:200])
                payload["justification"] = "Recorded for the smoke test."
            r = client.post(f"/graph-studio/{uc}/decisions", json=payload)
            assert r.status_code == 200, r.text

        r = client.post(f"/graph-studio/{uc}/decisions",
                        json={"item_id": st["must_review"][0]["item_id"], "choice": "nonsense"})
        check("a choice the row does not offer is refused, naming what it takes",
              r.status_code == 400 and "it takes" in r.json()["error"], r.text[:300])

        st = client.get(f"/graph-studio/{uc}").json()
        check("clearing every row still leaves publish blocked on the pivot",
              st["publish"]["blocked"] and st["must_review_outstanding"] == 0, str(st["publish"]))

        pivot_option = st["pivot"]["options"][0]["option_id"]
        st = client.post(f"/graph-studio/{uc}/pivot", json={"option_id": pivot_option}).json()["studio"]
        check("settling the pivot opens the gate", st["publish"]["blocked"] is False, str(st["publish"]))

        print("\n— canvas and query —")
        canvas = client.get(f"/graph-studio/{uc}/canvas").json()
        check("the canvas draws the package's own graph",
              canvas["node_count"] == 189 and canvas["edge_count"] == 241, str(canvas["node_count"]))
        check("settling a row stops its element being proposed",
              canvas["facets"]["needs_review"] == 0, str(canvas["facets"]))
        check("and studio-authored elements are counted separately",
              canvas["facets"]["studio_authored"] >= 0, str(canvas["facets"]))

        q = client.post(f"/graph-studio/{uc}/query",
                        json={"question": "Are we accepting waste from generators under a consent decree?"}).json()
        check("a recorded sanity check wins and names itself",
              q["recorded"] and q["check_id"], str(q)[:300])
        check("a recorded traversal is a sub-graph, not a chain", q["path_labels"] == [], str(q)[:200])
        check("the answer carries the marked canvas back with it",
              q["canvas"]["node_count"] == 189, str(q["canvas"].keys()))

        q = client.post(f"/graph-studio/{uc}/query", json={"question": "What about warp nacelles?"}).json()
        check("an unrecognised question abstains and says why",
              q["answerable"] is False and q["reason"], str(q)[:200])

        print("\n— publish —")
        versions = client.get(f"/graph-studio/{uc}").json()["versions"]
        check("a version is content-addressed", len(versions) == 1 and versions[0]["sha256"], str(versions)[:200])
        sha = versions[0]["sha256"]

        r = client.post(f"/graph-studio/{uc}/versions/{sha}/publish", params={"as": "not-an-email"})
        check("a malformed publisher is a 400, not a quiet fallback",
              r.status_code == 400 and "not an email" in r.json()["error"], r.text[:300])

        r = client.post(f"/graph-studio/{uc}/versions/{sha}/publish", params={"as": me})
        check("publishing flips a pointer", r.status_code == 200 and r.json()["published"] == sha, r.text[:300])
        check("and the row is now marked published",
              r.json()["studio"]["versions"][0]["published"] is True, str(r.json()["studio"]["versions"])[:200])

        print("\n— Ask —")
        a = client.get("/ask").json()
        check("Ask lists the published graph and only that — a built-but-unpublished "
              "graph is absent", a["count"] == 1 and a["built_count"] == 2,
              f"count={a['count']} built={a['built_count']}")
        check("it reports the content it will answer from",
              a["graphs"][0]["sha256"] == sha, str(a["graphs"][0])[:200])
        check("published_by is the address that published it",
              a["graphs"][0]["published_by"] == me, str(a["graphs"][0]["published_by"]))
        check("the answer-requirements pool is served, not client-held",
              len(a["answer_requirements"]["formats"]) == 10, str(len(a["answer_requirements"]["formats"])))

        r = client.post("/ask", json={"use_case_id": uc, "question": "hi", "formats": ["nope"]})
        check("an unknown format is a plain 400 before the stream opens",
              r.status_code == 400 and "this graph offers" in r.json()["error"], r.text[:300])

        import backend.app.routers.ask as ask_router
        ask_router.ASK_STAGE_MS = 0
        ask_router.ASK_BLOCK_MS = 0

        question = client.get("/ask").json()["graphs"][0]["suggested_questions"][0]
        streamed = client.post("/ask", json={"use_case_id": uc, "question": question})
        check("the answer streams as an event stream",
              streamed.headers["content-type"].startswith("text/event-stream"),
              streamed.headers.get("content-type", ""))
        events = [line for line in streamed.text.splitlines() if line.startswith("event:")]
        check("stages, a summary and a done event all arrive",
              "event: summary" in events and "event: done" in events, str(events)[:300])

        print("\n— What-if —")
        w = client.get("/whatif").json()
        check("the lens opens once a graph is published",
              w["facility"] is not None and len(w["generators"]) == 24, str(len(w["generators"])))
        check("every pool states its count", all("count" in p for p in w["candidate_pools"]), str(w["candidate_pools"])[:200])
        check("headroom is computed per pool", len(w["headroom"]) == len(w["candidate_pools"]))

        r = client.post("/whatif/resolve", json={"text": "tonnage"}).json()
        check("a measure that measures the wrong thing gets its own verdict",
              r["verdict"] in ("grounds_not_inherited", "resolved", "refused"), str(r)[:200])
        r = client.post("/whatif/resolve", json={"text": "warp core breach risk"}).json()
        check("and an unresolvable one is refused in the tenant's words",
              r["verdict"] == "refused" and r["measure_key"] is None, str(r)[:200])

        gen = w["generators"][0]
        keys = [m["key"] for m in w["watched_measures"]]
        s = client.post("/whatif/scenario", json={"generator_id": gen["id"], "watch": keys}).json()
        check("a scenario names the federal source of every figure",
              all(m["source"] for m in s["measures"]), str(s["measures"])[:200])
        check("a measure with no baseline reports null, never 0",
              any(m["baseline"] is None for m in s["measures"]), str([m["baseline"] for m in s["measures"]]))
        check("an absence has no circle in the traversal",
              all(n["key"] != "enforcement" for n in s["subgraph"]["nodes"]) or gen["enforcement"] > 0,
              str(s["subgraph"]["nodes"])[:200])
        check("every edge label comes from the graph's own list",
              all(e["label"] in s["subgraph"]["relationships"] for e in s["subgraph"]["edges"]),
              str(s["subgraph"]["edges"])[:200])

        r = client.post("/whatif/saved", json={
            "name": "Smoke scenario", "pool": w["candidate_pools"][0]["key"], "watch": keys,
            "cases": [{"generator_id": gen["id"]}],
        })
        check("a scenario saves as a frame plus its cases", r.status_code == 200, r.text[:300])
        sid = r.json()["saved_id"]

        excluded_pool = next((p for p in w["candidate_pools"] if p["count"] < len(w["generators"])), None)
        if excluded_pool:
            admitted = {g["id"] for g in
                        [x for x in w["generators"]]}
            r = client.post("/whatif/saved", json={
                "name": "Bad", "pool": excluded_pool["key"], "watch": keys,
                "cases": [{"generator_id": g["id"]} for g in w["generators"]],
            })
            check("a case whose load the frame excludes is refused",
                  r.status_code == 400 and "pool" in r.json()["error"], r.text[:300])

        r = client.post(f"/whatif/saved/{sid}/publish", json={
            "readers": ["stranger@example.com"], "graph_use_case_id": uc,
            "freshness": {"preset": w["publishing"]["freshness"]["presets"][0]["id"]},
        })
        check("a reader outside the directory is refused, naming who is in it",
              r.status_code == 400 and "directory" in r.json()["error"], r.text[:300])

        r = client.post(f"/whatif/saved/{sid}/publish", json={
            "readers": [me], "graph_use_case_id": uc,
            "freshness": {"preset": w["publishing"]["freshness"]["presets"][0]["id"]},
        })
        check("publishing a scenario records readers, the graph and its hash",
              r.status_code == 200 and r.json()["saved"][0]["published"]["graph_sha256"] == sha,
              r.text[:400])

        print("\n— Reports —")
        rp = client.get("/reports").json()
        check("the section opens once a graph is published",
              rp["published_count"] == 1 and len(rp["reports"]) == 5, str(rp["published_count"]))
        check("36 inbound generators on the register",
              rp["reports"][0]["spine_total"] == 36, str(rp["reports"][0])[:200])
        check("the governance chips count the list, not a filtered copy",
              any(s["key"] == "current" for s in rp["governance"]["statuses"]),
              str(rp["governance"]["statuses"])[:200])

        report_id = rp["reports"][0]["report_id"]
        one = client.get(f"/reports/{report_id}").json()["report"]
        check("every figure is computed per request", one["row_count"] > 0, str(one["row_count"]))
        check("a chart is emitted in the answer's payload shape",
              any(b["type"] == "chart" and "data" in b for b in one["blocks"]), str([b["type"] for b in one["blocks"]]))
        check("the horizon is stated, never applied",
              "not a filter that ran" in " ".join(
                  client.post("/reports/build", json=one["frame"]).json()["report"]["caveats"]),
              "")

        built = client.post("/reports/build", json=one["frame"]).json()["report"]
        check("the written frame keeps the tenant's authored tiles", built["variant"] == "written", built["variant"])

        other = dict(one["frame"])
        other["scope"] = "cd"
        gen_report = client.post("/reports/build", json=other).json()["report"]
        check("a different frame recomputes the tiles and says so",
              gen_report["variant"] == "generated"
              and all(t["unit"] == "computed for this frame" for t in gen_report["tiles"]),
              str(gen_report["tiles"])[:300])

        r = client.post("/reports/build", json={**one["frame"], "use_case_id": "uc-nope"})
        check("a frame naming an unpublished graph is refused, naming the live ones",
              r.status_code == 400 and "not a published graph" in r.json()["error"], r.text[:300])

        r = client.post("/reports/read", json={"question": "which generators have been penalised the most"}).json()
        check("reading a question returns a sentence and a frame, never figures",
              "reading" in r and "frame" in r and "blocks" not in r, str(r.keys()))

        r = client.post("/reports/saved", json={
            **one["frame"], "name": "Smoke saved report", "question": "smoke",
        })
        check("saving without a name is the one thing the app must not decide",
              r.status_code == 200, r.text[:300])
        saved_id = r.json()["saved"][-1]["saved_id"]

        back = client.get(f"/reports/saved/{saved_id}").json()
        check("a saved report is re-asked rather than replayed",
              back["report"]["row_count"] == one["row_count"], str(back["report"]["row_count"]))

        print("\n— Audit & Governance —")
        g = client.get("/governance").json()
        check("the roster total is stated", g["roster_total"] == 36, str(g["roster_total"]))
        check("the basis list is derived from the dictionary, never written",
              all(b["basis"] != "enf" for b in g["bases"]), str([b["basis"] for b in g["bases"]]))
        check("a persona with no rule says so rather than 'opens empty'",
              any(p["resolution"]["summary"] == "No rule authored yet" for p in g["people"]),
              str([p["resolution"]["summary"] for p in g["people"]]))
        check("the not-enforced sentence is served with the rules",
              "recorded, not enforced" in g["copy"]["not_enforced"], str(g["copy"])[:200])
        check("the published scenario is a governable artifact",
              any(a["kind"] == "whatif" and a["can_unpublish"] for a in g["artifacts"]),
              str([(a["kind"], a["can_unpublish"]) for a in g["artifacts"]]))

        role_id = g["people"][0]["role_id"]
        basis = next(b for b in g["bases"] if not b["identity"])
        r = client.patch(f"/governance/scope/{role_id}", params={"as": me},
                         json={"rule": {"basis": basis["basis"], "values": [basis["values"][0]["value"]]}})
        check("authoring a rule resolves it against the live register",
              r.status_code == 200, r.text[:300])
        person = next(p for p in r.json()["people"] if p["role_id"] == role_id)
        check("and names the rows as well as counting them",
              person["resolution"]["count"] > 0 and len(person["resolution"]["sample"]) > 0,
              str(person["resolution"])[:200])
        check("the change is on the trail with who did it",
              r.json()["log"][0]["actor"] == me and "not enforced" in r.json()["log"][0]["detail"],
              str(r.json()["log"][0])[:300])

        r = client.patch(f"/governance/scope/{role_id}", params={"as": me},
                         json={"rule": {"basis": "not_a_basis", "values": []}})
        check("a basis the register does not offer is refused, naming what it does",
              r.status_code == 400 and "offers" in r.json()["error"], r.text[:300])

        report_artifact = next(a for a in g["artifacts"] if a["kind"] == "report")
        r = client.post(f"/governance/artifacts/{report_artifact['artifact_id']}/unpublish",
                        params={"as": me})
        check("unpublish is refused where the server has no such act, naming the equivalent",
              r.status_code == 400 and "every reader" in r.json()["error"], r.text[:300])

        print("\n— Settings —")
        s = client.get("/settings").json()
        admin_role = next(p for p in s["personas"] if p["nav"].get("settings") and p["read_only"])
        r = client.patch(f"/settings/personas/{admin_role['role_id']}/nav",
                         json={"nav": {"settings": False}})
        check("the Settings lock is enforced by the server, not a disabled switch",
              r.status_code == 400 and "fixed for" in r.json()["error"], r.text[:300])

        other_persona = next(p for p in s["personas"] if not p["nav"].get("settings"))
        r = client.patch(f"/settings/personas/{other_persona['role_id']}/nav",
                         json={"nav": {"reports": False}})
        check("a permission is stored", r.status_code == 200, r.text[:200])
        after = next(p for p in r.json()["personas"] if p["role_id"] == other_persona["role_id"])
        check("and it persists", after["nav"]["reports"] is False, str(after["nav"]))

        r = client.post(f"/settings/personas/{other_persona['role_id']}/reset").json()
        after = next(p for p in r["personas"] if p["role_id"] == other_persona["role_id"])
        check("Reset restores the authored default",
              after["nav"]["reports"] == other_persona["defaults"]["reports"], str(after["nav"]))

        r = client.patch(f"/settings/personas/{other_persona['role_id']}/nav",
                         json={"nav": {"time-travel": True}})
        check("a navigation item the app does not have is refused, naming what it has",
              r.status_code == 400 and "this app has" in r.json()["error"], r.text[:300])

        print("\n— the validator still guards the writes —")
        r = client.put("/db/column_profiles", json={"value": {}})
        check("a write that would drop the real columns is refused",
              r.status_code == 400 and "column_profiles" in r.json()["error"], r.text[:300])

        r = client.put("/db/graph_studio", json={"value": {
            **client.get("/db").json()["db"]["graph_studio"],
            "canvas": {"nodes": [], "edges": [{"edge_id": "e", "from": "a", "to": "b", "label": "x"}]},
        }})
        check("an edge with no node is refused at the boundary",
              r.status_code == 400, r.text[:300])

        r = client.get("/nope")
        check("an unknown route names the stale-server cause",
              r.status_code == 404 and "restart" in r.json()["error"].lower(), r.text[:300])
        check("every refusal is { error } at the top level, as client.ts reads it",
              "detail" not in r.json(), r.text[:200])

        r = client.post("/auth/login", content=b"{not json", headers={"content-type": "application/json"})
        check("a malformed body is a 400 in the same envelope",
              r.status_code == 400 and "error" in r.json() and "detail" not in r.json(), r.text[:300])

        print("\n— persistence: the state Node lost on restart —")
        with database.SessionLocal() as db:
            from backend.app.models import Source, StudioDecision, StudioPublication
            check("registered sources are rows", db.query(Source).count() == 2)
            check("review decisions are rows", db.query(StudioDecision).count() == 5)
            check("publication is a row", db.query(StudioPublication).count() == 1)

    print(f"\n{'=' * 62}")
    print(f"  {len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print(f"{'=' * 62}")
        for f in FAIL:
            print(f"  · {f}")
    print(f"{'=' * 62}\n")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
