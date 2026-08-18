"""
The New Graph wizard.

**Steps unlock in order**, and server-side only step 1's domain is enforced: a
later step's rule would stop **Save draft** from keeping partial work.

**A model call is never silent or instant.** The derivation between steps 5 and 6
is a real async run, and every `Suggest … (LLM)` response is held so the drafting
state can be seen. Both are paced for the reason the profiler is: an operation
that returns instantly and shows nothing teaches that it is free.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse

from .. import store
from ..core import (
    GAP_DECISIONS,
    normalize_drafted,
    normalize_gap_decisions,
    normalize_questions,
    normalize_source_picks,
    now_iso,
    slugify,
)
from ..deps import SUGGEST_MS, get_ctx, pace, refuse
from ..models import Derivation
from ..runtime import Ctx
from ..services.graph import (
    WIZARD_STEPS,
    advance_derivation,
    derivation_view,
    graph_coverage,
    graph_domains,
    graph_sources,
    new_derivation,
    saved_use_case,
    suggest,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Step 1
# ---------------------------------------------------------------------------
@router.get("/graph-domains")
def domains(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return graph_domains(ctx)


# ---------------------------------------------------------------------------
# Steps 2, 3 and 5 — one contract, three pools
# ---------------------------------------------------------------------------
SUGGESTERS = [
    ("/graph-personas/suggest", "graph_personas", "persona_id", "personas"),
    ("/graph-kpis/suggest", "graph_kpis", "kpi_id", "kpis"),
    ("/graph-questions/suggest", "graph_hero_questions", "question_id", "hero_questions"),
]


async def _suggest(
    ctx: Ctx, path: str, pool: str, id_key: str, member_key: str, body: dict
) -> dict[str, Any]:
    domain_id = body.get("domain_id")
    if domain_id and not any(d["domain_id"] == domain_id for d in ctx.doc["graph_domains"]):
        raise refuse(f"unknown domain {domain_id}")
    payload = suggest(ctx, path, pool, id_key, member_key, body)
    await pace(SUGGEST_MS)
    return payload


@router.post("/graph-personas/suggest")
async def suggest_personas(
    body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    return await _suggest(ctx, *SUGGESTERS[0], body)


@router.post("/graph-kpis/suggest")
async def suggest_kpis(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return await _suggest(ctx, *SUGGESTERS[1], body)


@router.post("/graph-questions/suggest")
async def suggest_questions(
    body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    return await _suggest(ctx, *SUGGESTERS[2], body)


# ---------------------------------------------------------------------------
# Step 4
# ---------------------------------------------------------------------------
@router.get("/graph-sources")
def sources(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return graph_sources(ctx)


# ---------------------------------------------------------------------------
# Steps 5 → 6
# ---------------------------------------------------------------------------
def _coverage_body(body: dict) -> tuple[str, list, list]:
    sources_in = body.get("sources")
    questions_in = body.get("hero_questions")
    if sources_in is not None and not isinstance(sources_in, list):
        raise refuse("sources must be an array")
    if questions_in is not None and not isinstance(questions_in, list):
        raise refuse("hero_questions must be an array")
    return body.get("name") or "", sources_in or [], questions_in or []


@router.post("/graph-coverage")
def coverage(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    name, picks, questions = _coverage_body(body)
    return graph_coverage(ctx, name, picks, questions)


@router.post("/graph-derivations", status_code=202)
def start_derivation(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> Any:
    """Starts the run and returns immediately; the answer arrives by polling, so
    leaving the page does not lose the run."""
    name, picks, questions = _coverage_body(body)
    cover = graph_coverage(ctx, name, picks, questions)

    run = new_derivation(cover)
    run["entity_total"] = cover["entity_count"] + cover["relationship_count"]
    ctx.db.add(
        Derivation(derivation_id=run["derivation_id"], status=run["status"], data=run)
    )
    ctx.db.commit()
    return JSONResponse(status_code=202, content=derivation_view(run))


@router.get("/graph-derivations/{derivation_id}")
def poll_derivation(derivation_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    row = ctx.db.get(Derivation, derivation_id)
    if not row:
        raise refuse(f"no derivation {derivation_id}", status=404)
    run = advance_derivation(dict(row.data))
    row.status = run["status"]
    row.data = run
    ctx.db.commit()
    return derivation_view(run)


# ---------------------------------------------------------------------------
# The saved briefs
# ---------------------------------------------------------------------------
@router.get("/graph-use-cases")
def list_use_cases(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """The step labels reach the page here and the server validates `step`
    against the same list, so a step cannot exist in the UI that the API would
    reject."""
    rows = sorted(
        ctx.doc["graph_use_cases"], key=lambda u: u.get("updated_at") or "", reverse=True
    )
    return {
        "use_cases": [saved_use_case(u) for u in rows],
        "count": len(rows),
        "draft_count": sum(1 for u in rows if u.get("status") != "committed"),
        "committed_count": sum(1 for u in rows if u.get("status") == "committed"),
        "steps": WIZARD_STEPS,
    }


@router.post("/graph-use-cases", status_code=201)
def upsert_use_case(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> Any:
    """**A saved use case is the one collection the UI writes back to the
    database.** Registered sources live in their own table and a draft survives a
    restart either way — but this asymmetry is deliberate in spirit: a
    half-finished graph brief is the user's work.

    `citations` and `formats` from an older client are ignored rather than
    refused: those fields are not wrong, they simply belong to another surface now.
    """
    name = body.get("name")
    if not name or not str(name).strip():
        raise refuse("name is required — it is what the saved use cases list shows")

    domain_id = body.get("domain_id")
    if domain_id and not any(d["domain_id"] == domain_id for d in ctx.doc["graph_domains"]):
        raise refuse(f"unknown domain {domain_id}")

    status = body.get("status")
    if status and status not in ("draft", "committed"):
        raise refuse('status must be "draft" or "committed"')

    raw_step = body.get("step", 1)
    if isinstance(raw_step, bool) or not isinstance(raw_step, int):
        try:
            raw_step = int(raw_step)
        except (TypeError, ValueError):
            raise refuse(f"step must be an integer from 1 to {len(WIZARD_STEPS)}")
    if raw_step < 1 or raw_step > len(WIZARD_STEPS):
        raise refuse(f"step must be an integer from 1 to {len(WIZARD_STEPS)}")

    for label, rows in (("personas", body.get("personas")), ("kpis", body.get("kpis"))):
        if rows is None:
            continue
        if not isinstance(rows, list):
            raise refuse(f"{label} must be an array of {{ name, description }}")
        for p in rows:
            text = p if isinstance(p, str) else (p or {}).get("name") or ""
            if not str(text).strip():
                noun = "KPI" if label == "kpis" else "persona"
                raise refuse(f"every {noun} needs a name")

    persona_tags = None if body.get("personas") is None else normalize_drafted(body["personas"])
    kpi_tags = None if body.get("kpis") is None else normalize_drafted(body["kpis"])

    questions = None
    if body.get("hero_questions") is not None:
        rows = body["hero_questions"]
        if not isinstance(rows, list):
            raise refuse("hero_questions must be an array of { text, priority }")
        for q in rows:
            text = q if isinstance(q, str) else (q or {}).get("text") or (q or {}).get("name") or ""
            if not str(text).strip():
                raise refuse("every hero question needs text")
        questions = normalize_questions(rows)

    decisions = None
    if body.get("gap_decisions") is not None:
        rows = body["gap_decisions"]
        if not isinstance(rows, list):
            raise refuse("gap_decisions must be an array of { element_id, decision }")
        if any(str((d or {}).get("decision") or "").strip() not in GAP_DECISIONS for d in rows):
            raise refuse(f"decision must be one of: {', '.join(GAP_DECISIONS)}")
        decisions = normalize_gap_decisions(rows)

    source_picks = None
    if body.get("sources") is not None:
        rows = body["sources"]
        if not isinstance(rows, list):
            raise refuse("sources must be an array of { source_id, mode, objects }")
        source_picks = normalize_source_picks(rows)
        available = graph_sources(ctx)["sources"]
        for pick in source_picks:
            source = next(
                (s for s in available if s["source_id"] == pick["source_id"]), None
            )
            if not source:
                raise refuse(f"{pick['source_id']} is not a connected source")
            # Listed but refused if picked: "not profiled yet" and "not
            # connected" are different problems, and only the user can fix either.
            if source["object_count"] == 0:
                raise refuse(
                    f"{pick['source_id']} has nothing profiled yet — profile it in the Data "
                    "Catalogue first"
                )
            if pick["mode"] == "subset":
                if not pick["objects"]:
                    unit = source["unit_label"].rstrip("s")
                    raise refuse(
                        f"pick at least one {unit} for {pick['source_id']} — an empty "
                        "selection can't derive"
                    )
                known = {o["object_id"] for o in source["objects"]}
                unknown = [o for o in pick["objects"] if o not in known]
                if unknown:
                    raise refuse(
                        f"not profiled on {pick['source_id']}: {', '.join(unknown)}"
                    )

    use_case_id = body.get("use_case_id")
    existing = None
    if use_case_id:
        existing = next(
            (u for u in ctx.doc["graph_use_cases"] if u["use_case_id"] == use_case_id), None
        )
        if not existing:
            raise refuse(f"no use case {use_case_id}", status=404)

    resolved_domain = domain_id or (existing or {}).get("domain_id")
    if not resolved_domain and (raw_step > 1 or status == "committed"):
        raise refuse(
            "pick a business domain on step 1 — a use case cannot advance past it or commit "
            "without one"
        )

    record = {
        "use_case_id": (existing or {}).get("use_case_id")
        or f"uc-{slugify(name)}-{uuid.uuid4().hex[:8]}",
        "name": str(name).strip(),
        "status": status or (existing or {}).get("status") or "draft",
        "domain_id": resolved_domain,
        "business_need": body.get("business_need") or (existing or {}).get("business_need") or "",
        "personas": persona_tags if persona_tags is not None else (existing or {}).get("personas") or [],
        "kpis": kpi_tags if kpi_tags is not None else (existing or {}).get("kpis") or [],
        "sources": source_picks if source_picks is not None else (existing or {}).get("sources") or [],
        "hero_questions": questions if questions is not None else (existing or {}).get("hero_questions") or [],
        "gap_decisions": decisions if decisions is not None else (existing or {}).get("gap_decisions") or [],
        "step": raw_step,
        "updated_at": now_iso(),
    }

    if existing:
        rows = [
            record if u["use_case_id"] == record["use_case_id"] else u
            for u in ctx.doc["graph_use_cases"]
        ]
    else:
        rows = [record, *ctx.doc["graph_use_cases"]]

    try:
        ctx.commit({**ctx.doc, "graph_use_cases": rows})
    except store.Refused as error:
        raise refuse(str(error)) from error

    return JSONResponse(
        status_code=200 if existing else 201,
        content={"saved": True, "use_case": saved_use_case(record)},
    )


@router.delete("/graph-use-cases/{use_case_id}")
def delete_use_case(use_case_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    if not any(u["use_case_id"] == use_case_id for u in ctx.doc["graph_use_cases"]):
        raise refuse(f"no use case {use_case_id}", status=404)
    try:
        ctx.commit(
            {
                **ctx.doc,
                "graph_use_cases": [
                    u for u in ctx.doc["graph_use_cases"] if u["use_case_id"] != use_case_id
                ],
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error
    return {"deleted": use_case_id}
