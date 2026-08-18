"""
The New Graph wizard: six steps from a business need to a committed brief.

Two rules the copy on the page promises, kept here:

* **The step labels live on the server** (`WIZARD_STEPS`) and reach the page in
  the `/graph-use-cases` payload, so a step cannot exist in the UI that the API
  would reject.
* **A suggestion always says why it was suggested.** There is no model behind
  "Suggest personas (LLM)" — the pool is ranked by keywords in the business
  need, then domain fit, then a hash of the brief, so the same brief always
  drafts the same four.
"""

from __future__ import annotations

import uuid
from typing import Any

from ..core import (
    entity_name,
    js_hash,
    normalize_questions,
    normalize_source_picks,
    now_iso,
    number_format,
    round_js,
    slugify,
)
from ..runtime import Ctx
from .catalogue import document_dictionary, table_dictionary

WIZARD_STEPS = [
    "Domain",
    "Personas",
    "KPIs",
    "Sources",
    "Hero questions",
    "Entities & relationships",
]

FIT_ORDER = {"strong": 0, "partial": 1, "none": 2}


def match_score(seed: str) -> float:
    return round_js(0.86 + (js_hash(seed) % 14) / 100, 2)


# ---------------------------------------------------------------------------
# Step 1 — domains, ranked by what the connected data supports
# ---------------------------------------------------------------------------
def graph_domains(ctx: Ctx) -> dict[str, Any]:
    """`fit` is seeded per domain but **downgraded at request time**: a domain
    cannot claim it is "already profiled" while the tenant has profiled
    nothing, so with no sources connected the ranking legitimately differs from
    a screenshot taken with data.

    The note is swapped with the fit — a downgraded domain saying its seeded
    "already profiled" note would be the claim the downgrade exists to prevent.
    """
    connected = ctx.connected_sources()
    profiled = sum(
        len(s.get("profiled") or []) + len(s.get("profiled_docs") or []) for s in connected
    )

    domains = []
    for d in ctx.doc["graph_domains"]:
        seeded = d.get("fit") or "none"
        fit = seeded
        if fit == "strong" and profiled == 0:
            fit = "partial" if connected else "none"

        if fit == seeded:
            note = d.get("note")
        elif fit == "partial":
            note = "Partial fit — a source is connected but nothing is profiled yet."
        else:
            note = d.get("unmet_note") or d.get("note")

        domains.append(
            {
                "domain_id": d["domain_id"],
                "name": d["name"],
                "expected_sources": d.get("expected_sources") or [],
                "fit": fit,
                "note": note,
                "rank": d.get("rank", 99),
            }
        )

    domains.sort(key=lambda d: (FIT_ORDER[d["fit"]], d["rank"]))
    return {
        "domains": domains,
        "domain_count": len(domains),
        "connected_sources": len(connected),
        "profiled_objects": profiled,
    }


# ---------------------------------------------------------------------------
# Steps 2, 3 and 5 — suggestions
# ---------------------------------------------------------------------------
def as_suggestion(entry: dict, id_key: str, why: str) -> dict[str, Any]:
    """`detail` is what a suggestion is *for*; `why` is why it was drafted.
    Two fields because they answer two questions, and neither may stand in for
    the other."""
    out = {
        "id": entry[id_key],
        "name": entry.get("name") or entry.get("text") or "",
        "detail": entry.get("focus")
        or entry.get("definition")
        or entry.get("rationale")
        or entry.get("format")
        or "",
        "why": why,
    }
    if entry.get("priority"):
        out["priority"] = entry["priority"]
    return out


def suggest_from(
    pool: list[dict], id_key: str, domain_id: str | None, business_need: str, limit: int = 4
) -> list[dict[str, Any]]:
    need = str(business_need or "").lower()
    scored = []
    for p in pool:
        hits = sum(1 for k in (p.get("keywords") or []) if k in need)
        domains = p.get("domains") or []
        domain_fit = 1 if not domains else (2 if domain_id in domains else 0)
        scored.append(
            {
                "entry": p,
                "hits": hits,
                "domain_fit": domain_fit,
                "jitter": js_hash(f"{need}:{p[id_key]}") % 100,
            }
        )

    kept = [s for s in scored if s["domain_fit"] > 0 or s["hits"] > 0]
    kept.sort(key=lambda s: (-s["hits"], -s["domain_fit"], -s["jitter"]))

    out = []
    for s in kept[:limit]:
        if s["hits"] > 0:
            matched = [k for k in (s["entry"].get("keywords") or []) if k in need][:3]
            why = f"matches your brief on {', '.join(matched)}"
        else:
            why = "typical for this domain"
        out.append(as_suggestion(s["entry"], id_key, why))
    return out


TEMPLATE_MIN_PHRASES = 2


def match_template(ctx: Ctx, business_need: str) -> dict | None:
    """**A tie matches nothing.** Two templates scoring equally means the brief
    named neither, so it falls back to keyword ranking rather than picking one."""
    need = " ".join(str(business_need or "").lower().split())
    if not need:
        return None

    scored = [
        {
            "template": t,
            "hits": sum(1 for phrase in t["match_phrases"] if phrase in need),
        }
        for t in ctx.doc["graph_use_case_templates"]
    ]
    scored.sort(key=lambda s: -s["hits"])
    if not scored:
        return None

    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    if best["hits"] < TEMPLATE_MIN_PHRASES:
        return None
    if runner_up and runner_up["hits"] == best["hits"]:
        return None
    return best["template"]


def bundle_from(template: dict, pool: list[dict], id_key: str, member_key: str) -> list[dict]:
    """A match returns the members **whole and in the template's own order**,
    past the 4/5 keyword limit — a template is a stated answer rather than a
    ranking, and truncating it would drop members the use case claims."""
    out = []
    for member_id in template[member_key]:
        entry = next((e for e in pool if e[id_key] == member_id), None)
        if entry:
            out.append(
                as_suggestion(entry, id_key, f"named in the {template['name']} use case")
            )
    return out


def suggest(
    ctx: Ctx, path: str, pool_key: str, id_key: str, member_key: str, body: dict
) -> dict[str, Any]:
    """Steps 2, 3 and 5 share one contract, so the UI reads one shape.

    A hero question is the graph's contract, so five are drafted where personas
    and KPIs get four.
    """
    domain_id = body.get("domain_id")
    business_need = body.get("business_need") or ""
    pool = ctx.doc[pool_key]

    template = match_template(ctx, business_need) if member_key else None
    if template:
        suggestions = bundle_from(template, pool, id_key, member_key)
        derived_from = f"the {template['name']} use case"
    else:
        limit = 5 if pool_key == "graph_hero_questions" else 4
        suggestions = suggest_from(pool, id_key, domain_id, business_need, limit)
        derived_from = "business need + domain" if business_need else "domain only"

    return {
        "suggestions": suggestions,
        "count": len(suggestions),
        "derived_from": derived_from,
        "run": {
            "stages": DRAFT_STAGES,
            # Deterministic, so the same brief always reports the same cost.
            "cost_usd": round_js(0.01 + (js_hash(f"{path}:{business_need}") % 6) / 100, 2),
            "cost_cap_usd": COST_CAP_USD,
        },
    }


DRAFT_STAGES = ["Reading your brief", "Drafting candidates", "Ranking against your data"]
SUGGEST_MS = 1100


# ---------------------------------------------------------------------------
# Step 4 — the profiled objects a brief may draw on
# ---------------------------------------------------------------------------
def graph_sources(ctx: Ctx) -> dict[str, Any]:
    """Lists **profiled state, not registrations**. A source with nothing
    profiled comes back with `object_count: 0` and is refused if picked —
    listed but disabled, because "not profiled yet" and "not connected" are
    different problems."""
    sources = []
    for source in ctx.connected_sources():
        is_drive = source.get("kind") == "gdrive"
        drive = ctx.find_drive(source.get("drive_id")) if is_drive else None

        if is_drive:
            objects = []
            for p in source.get("profiled_docs") or []:
                meta = ctx.find_document(drive, p["folder_id"], p["document_id"])
                folder = ctx.find_folder(drive, p["folder_id"])
                objects.append(
                    {
                        "object_id": f"{p['folder_id']}.{p['document_id']}",
                        "parent_id": p["folder_id"],
                        "label": f"{(folder or {}).get('name') or p['folder_id']} / "
                        f"{(meta or {}).get('name') or p['document_id']}",
                        "units": p["entities"],
                        "unit_label": "entities",
                    }
                )
            scope = [
                (ctx.find_folder(drive, fid) or {}).get("name") or fid
                for fid in source.get("folders") or []
            ]
        else:
            objects = [
                {
                    "object_id": f"{p['dataset_id']}.{p['table_id']}",
                    "parent_id": p["dataset_id"],
                    "label": f"{p['dataset_id']}.{p['table_id']}",
                    "units": p["columns"],
                    "unit_label": "columns",
                }
                for p in source.get("profiled") or []
            ]
            scope = source.get("datasets") or []

        sources.append(
            {
                "source_id": source["source_id"],
                "source_name": source["source_name"],
                "connector": source["connector"],
                "kind": source["kind"],
                "status": source["status"],
                "type_label": "Google Drive" if is_drive else "BigQuery",
                "account": source.get("project_id") or source.get("drive_id") or "—",
                "scope_label": "Folders" if is_drive else "Datasets",
                "scope": scope,
                "objects": objects,
                "object_count": len(objects),
                "unit_label": "documents" if is_drive else "tables",
            }
        )

    return {
        "sources": sources,
        "source_count": len(sources),
        "profiled_source_count": sum(1 for s in sources if s["object_count"] > 0),
    }


def selected_profiled_objects(ctx: Ctx, picks: Any) -> list[dict[str, Any]]:
    out = []
    for pick in normalize_source_picks(picks):
        source = ctx.source(pick["source_id"])
        if not source or source.get("status") != "connected":
            continue
        wanted = set(pick["objects"])
        take_all = pick["mode"] != "subset"

        if source.get("kind") == "gdrive":
            drive = ctx.find_drive(source.get("drive_id"))
            for p in source.get("profiled_docs") or []:
                object_id = f"{p['folder_id']}.{p['document_id']}"
                if not take_all and object_id not in wanted:
                    continue
                meta = ctx.find_document(drive, p["folder_id"], p["document_id"])
                if not meta:
                    continue
                out.append(
                    {
                        "objectId": object_id,
                        "sourceName": source["source_name"],
                        "label": meta["name"],
                        "size": f"{meta['pages']} pages",
                        "evidenceKind": "extraction match",
                        "columns": [
                            {"id": e["entity_id"], "class": e["class"]}
                            for e in document_dictionary(ctx, source, p["folder_id"], meta)[
                                "entities"
                            ]
                        ],
                    }
                )
            continue

        project = ctx.find_project(source.get("project_id"))
        for p in source.get("profiled") or []:
            object_id = f"{p['dataset_id']}.{p['table_id']}"
            if not take_all and object_id not in wanted:
                continue
            dataset = next(
                (
                    d
                    for d in (project or {}).get("datasets", [])
                    if d["dataset_id"] == p["dataset_id"]
                ),
                None,
            )
            meta = next(
                (t for t in (dataset or {}).get("tables", []) if t["table_id"] == p["table_id"]),
                None,
            )
            rows = (meta or {}).get("rows") or 0
            out.append(
                {
                    "objectId": object_id,
                    "sourceName": source["source_name"],
                    "label": p["table_id"],
                    "size": f"{number_format(rows)} rows",
                    "evidenceKind": "match",
                    "columns": [
                        {"id": c["column_id"], "class": c["class"]}
                        for c in table_dictionary(
                            ctx, source, p["dataset_id"], p["table_id"], p["columns"], rows
                        )
                    ],
                }
            )
    return out


# ---------------------------------------------------------------------------
# Step 6 — coverage, derived only from what is profiled
# ---------------------------------------------------------------------------
STOPWORDS = {
    "which", "what", "where", "when", "whose", "there", "their", "these", "those",
    "about", "across", "based", "before", "being", "between", "could", "every",
    "from", "have", "highest", "lowest", "most", "other", "should", "still",
    "that", "the", "them", "they", "this", "total", "with", "within", "would",
    "can", "complete", "specific", "different", "historical", "receive", "exhibit",
    "nearing", "through", "quarter", "trace",
}


def graph_coverage(ctx: Ctx, name: str, picks: Any, hero_questions: Any) -> dict[str, Any]:
    """An entity names the table it came from; a relationship is claimed only
    where two objects share an identifier column. A hero question no profiled
    column covers becomes a **gap**, and the build stays blocked until every gap
    has a decision."""
    import re

    objects = selected_profiled_objects(ctx, picks)
    questions = normalize_questions(hero_questions)
    elements: list[dict[str, Any]] = []

    for o in objects:
        match = match_score(f"{o['sourceName']}:{o['objectId']}")
        elements.append(
            {
                "element_id": f"entity:{o['objectId']}",
                "name": entity_name(o["label"]),
                "kind": "entity",
                "status": "backed",
                "confidence": match,
                "evidence": f"{o['sourceName']} · {o['label']} ({o['size']}) · "
                f"{o['evidenceKind']} {match:.2f}",
                "reason": None,
            }
        )

    def keys_for(o: dict) -> set[str]:
        return {c["id"] for c in o["columns"] if c["class"] == "identifier"}

    i = 0
    while i < len(objects) and len(elements) < 40:
        for j in range(i + 1, len(objects)):
            shared = [k for k in keys_for(objects[i]) if k in keys_for(objects[j])]
            if not shared:
                continue
            key = shared[0]
            match = match_score(f"{objects[i]['objectId']}~{objects[j]['objectId']}")
            elements.append(
                {
                    "element_id": f"rel:{objects[i]['objectId']}~{objects[j]['objectId']}",
                    "name": f"{entity_name(objects[i]['label'])} → links-to → "
                    f"{entity_name(objects[j]['label'])}",
                    "kind": "relationship",
                    "status": "backed",
                    "confidence": match,
                    "evidence": f"shared key {key} · {objects[i]['sourceName']} · "
                    f"match {match:.2f}",
                    "reason": None,
                }
            )
            break
        i += 1

    vocabulary: set[str] = set()
    for o in objects:
        for word in entity_name(o["label"]).lower().split(" "):
            vocabulary.add(word)
        for c in o["columns"]:
            for word in c["id"].lower().split("_"):
                vocabulary.add(word)

    for q in questions:
        cleaned = re.sub(r"[^a-z0-9\s]", " ", q["text"].lower())
        salient: list[str] = []
        for w in cleaned.split():
            if len(w) >= 5 and w not in STOPWORDS and w not in salient:
                salient.append(w)
        if not salient:
            continue
        if any(any(v.startswith(w[:5]) for v in vocabulary) for w in salient):
            continue
        missing = ", ".join(salient[:3])
        elements.append(
            {
                "element_id": f"gap:{slugify(q['text'])[:48]}",
                "name": q["text"],
                "kind": "entity" if q["priority"] == "high" else "relationship",
                "status": "gap",
                "confidence": round_js(0.2 + (js_hash(q["text"]) % 30) / 100, 2),
                "evidence": None,
                "reason": "No candidates in any connected source — nothing profiled "
                f"covers {missing}.",
            }
        )

    entities = [e for e in elements if e["kind"] == "entity" and e["status"] == "backed"]
    relationships = [
        e for e in elements if e["kind"] == "relationship" and e["status"] == "backed"
    ]
    gaps = [e for e in elements if e["status"] == "gap"]

    return {
        "title": f"{name or 'Untitled use case'} — coverage review",
        "entity_count": len(entities),
        "relationship_count": len(relationships),
        "hero_question_count": len(questions),
        "gap_count": len(gaps),
        "object_count": len(objects),
        "elements": elements,
    }


# ---------------------------------------------------------------------------
# The derivation between steps 5 and 6 — a real async run
# ---------------------------------------------------------------------------
DERIVATION_STAGES = [
    "Reading the business need",
    "Matching hero questions to profiled columns",
    "Deriving the entities you need",
    "Proposing relationships",
    "Checking coverage against the catalogue",
]
DERIVATION_STAGE_MS = 1300
COST_CAP_USD = 1


def derivation_view(run: dict) -> dict[str, Any]:
    """Never shows a cost figure the server did not report."""
    return {
        "derivation_id": run["derivation_id"],
        "status": run["status"],
        "stage_index": run["stage_index"],
        "stage_total": len(DERIVATION_STAGES),
        "stage_label": run["stage_label"],
        "progress": run["progress"],
        "revealed": run["revealed"],
        "entity_total": run["entity_total"],
        "cost_usd": round_js(run["cost"], 2),
        "cost_cap_usd": COST_CAP_USD,
        "started_at": run["started_at"],
        "finished_at": run.get("finished_at"),
        "coverage": run["coverage"] if run["status"] == "complete" else None,
    }


def advance_derivation(run: dict) -> dict:
    """Paced like the profiler, and derived from the clock for the same reason."""
    from datetime import datetime, timezone

    if run["status"] == "complete":
        return run

    started = datetime.fromisoformat(run["started_at"].replace("Z", "+00:00"))
    elapsed = (datetime.now(timezone.utc) - started).total_seconds() * 1000
    stage_index = min(len(DERIVATION_STAGES), int(elapsed // DERIVATION_STAGE_MS))
    if stage_index < 1:
        return run

    names = [e["name"] for e in run["coverage"]["elements"] if e["status"] == "backed"]
    cost = 0.0
    for i in range(1, stage_index + 1):
        cost = min(COST_CAP_USD, cost + 0.06 + (js_hash(f"{run['derivation_id']}:{i}") % 8) / 100)

    run["stage_index"] = stage_index
    run["stage_label"] = DERIVATION_STAGES[stage_index - 1]
    run["progress"] = round_js(stage_index / len(DERIVATION_STAGES) * 100)
    run["cost"] = cost

    import math

    target = math.ceil(len(names) * stage_index / len(DERIVATION_STAGES))
    run["revealed"] = names[:target]

    if stage_index >= len(DERIVATION_STAGES):
        run["status"] = "complete"
        run["progress"] = 100
        run["revealed"] = names
        run["finished_at"] = run.get("finished_at") or now_iso()

    return run


def new_derivation(coverage: dict) -> dict[str, Any]:
    return {
        "derivation_id": str(uuid.uuid4()),
        "status": "running",
        "stage_index": 0,
        "stage_label": "queued",
        "progress": 0,
        "revealed": [],
        "entity_total": coverage["entity_count"],
        "cost": 0.0,
        "coverage": coverage,
        "started_at": now_iso(),
        "finished_at": None,
    }


# ---------------------------------------------------------------------------
# A saved brief
# ---------------------------------------------------------------------------
def saved_use_case(u: dict) -> dict[str, Any]:
    """`step` is clamped: a brief saved on the old step 6 or 7 opens on the new
    last step, because a stepper pointing at a step the API would reject is
    worse than a brief that opens one screen further back."""
    from ..core import normalize_drafted, normalize_gap_decisions

    try:
        step = int(u.get("step") or 1)
    except (TypeError, ValueError):
        step = 1

    return {
        "use_case_id": u["use_case_id"],
        "name": u["name"],
        "status": "committed" if u.get("status") == "committed" else "draft",
        "domain_id": u.get("domain_id"),
        "business_need": u.get("business_need") or "",
        "personas": normalize_drafted(u.get("personas")),
        "kpis": normalize_drafted(u.get("kpis")),
        "sources": normalize_source_picks(u.get("sources")),
        "hero_questions": normalize_questions(u.get("hero_questions")),
        "gap_decisions": normalize_gap_decisions(u.get("gap_decisions")),
        "step": min(max(step, 1), len(WIZARD_STEPS)),
        "step_total": len(WIZARD_STEPS),
        "updated_at": u.get("updated_at"),
    }
