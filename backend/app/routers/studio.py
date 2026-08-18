"""
Graph Studio: the review queue, the canvas, the query, the builds and publication.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse

from ..core import is_email
from ..deps import SUGGEST_MS, get_ctx, pace, refuse
from ..runtime import Ctx
from ..services.studio import (
    advance_build,
    build_view,
    builds_for,
    built_graphs,
    clear_publication,
    find_built_graph,
    graph_studio,
    live_sha,
    record_decision,
    record_pivot,
    set_publication,
    start_build,
    studio_canvas,
    studio_items,
    studio_query,
    studio_summary,
    versions_for,
)

router = APIRouter()


def _built(ctx: Ctx, use_case_id: str) -> dict[str, Any]:
    found = find_built_graph(ctx, use_case_id)
    if found.get("error"):
        raise refuse(found["error"], status=found["status"])
    return found["use_case"]


@router.get("/graph-studio")
def list_graphs(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """**The studio lists graphs, it is not one graph.** A draft is not listed —
    but the draft *count* is shown, because it answers "where is my graph?"."""
    graphs = [studio_summary(ctx, u) for u in built_graphs(ctx)]
    graphs.sort(key=lambda g: g.get("built_at") or "", reverse=True)
    return {
        "graphs": graphs,
        "count": len(graphs),
        "draft_count": len(ctx.doc["graph_use_cases"]) - len(graphs),
    }


@router.get("/graph-studio/{use_case_id}")
def read_graph(use_case_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return graph_studio(ctx, _built(ctx, use_case_id))


@router.post("/graph-studio/{use_case_id}/decisions")
def decide(
    use_case_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """**A row's buttons are its own.** The server validates against the row's own
    `actions` and names them in the refusal, so the page cannot offer a button the
    API would reject.

    A `schema-changing` row cannot be resolved without a justification, enforced
    here rather than merely shown.
    """
    use_case = _built(ctx, use_case_id)
    item_id = body.get("item_id")
    choice = body.get("choice")
    justification = body.get("justification")

    gen = ctx.doc["graph_studio"]["generated"]
    everything = [
        *studio_items(
            ctx,
            use_case_id,
            "must_review",
            gen["must_review_total"],
            ctx.doc["graph_studio"]["review_items"],
        ),
        *studio_items(ctx, use_case_id, "confirmed", gen["sample_size"]),
        *studio_items(ctx, use_case_id, "auto_approved", gen["sample_size"]),
    ]
    item = next((i for i in everything if i["item_id"] == item_id), None)
    if not item:
        raise refuse(f"no review item {item_id}", status=404)

    if item.get("actions"):
        allowed = [a["choice"] for a in item["actions"]]
    elif item.get("action_set") == "causal":
        # The fallback family for a row that states none.
        allowed = ["approve-causal", "downgrade-correlational", "reject"]
    else:
        allowed = ["approve", "correct", "reject"]

    if choice not in allowed:
        raise refuse(
            f'"{choice}" is not one of the choices {item_id} offers — '
            f"it takes: {', '.join(allowed)}"
        )

    if item.get("justification") and not str(justification or "").strip():
        raise refuse(
            "this decision changes the schema — record a justification before resolving it"
        )

    record_decision(
        ctx,
        use_case_id,
        item_id,
        choice,
        str(justification or "").strip() or None,
        ctx.account_email,
    )
    return {"item_id": item_id, "studio": graph_studio(ctx, use_case)}


@router.post("/graph-studio/{use_case_id}/pivot")
def pivot(
    use_case_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """The pivot is a separate precondition from the queue: clearing every row
    still leaves publish blocked while it is open, because settling it changes
    what the decided rows mean."""
    use_case = _built(ctx, use_case_id)
    option_id = body.get("option_id")
    options = [o["option_id"] for o in ctx.doc["graph_studio"]["pivot"]["options"]]
    if option_id not in options:
        raise refuse(f"option_id must be one of: {', '.join(options)}")

    record_pivot(ctx, use_case_id, option_id, ctx.account_email)
    return {"chosen": option_id, "studio": graph_studio(ctx, use_case)}


@router.get("/graph-studio/{use_case_id}/canvas")
def canvas(use_case_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    _built(ctx, use_case_id)
    return studio_canvas(ctx, use_case_id)


@router.post("/graph-studio/{use_case_id}/query")
async def query(
    use_case_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """The answer carries the marked canvas back with it, so there is no second
    request and no second truth. A recorded check names its hops, so the
    highlight is exactly those; a derived walk can only say which nodes it
    crossed."""
    _built(ctx, use_case_id)
    question = body.get("question")
    if not question or not str(question).strip():
        raise refuse("ask a question first")

    answer = studio_query(ctx, use_case_id, str(question).strip())
    await pace(SUGGEST_MS)
    return {
        **answer,
        "canvas": studio_canvas(
            ctx,
            use_case_id,
            answer["path"],
            [e["edge_id"] for e in answer["edges_used"]] if answer["recorded"] else None,
        ),
    }


# ---------------------------------------------------------------------------
# Builds
# ---------------------------------------------------------------------------
@router.post("/graph-studio/{use_case_id}/builds", status_code=202)
def start(use_case_id: str, ctx: Ctx = Depends(get_ctx)) -> Any:
    """**Building lives here, not in the wizard, because a graph is built more
    than once.** Answers 202 with a queued run — the same contract as a profiling
    job — and the Build tab polls it."""
    use_case = _built(ctx, use_case_id)
    return JSONResponse(status_code=202, content=build_view(start_build(ctx, use_case)))


@router.get("/graph-studio/{use_case_id}/builds")
def history(use_case_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    use_case = _built(ctx, use_case_id)
    runs = builds_for(ctx, use_case_id, use_case)
    return {
        "use_case_id": use_case_id,
        "builds": [build_view(r) for r in runs],
        "count": len(runs),
    }


@router.get("/graph-studio/{use_case_id}/builds/{build_id}")
def one_build(use_case_id: str, build_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    use_case = _built(ctx, use_case_id)
    run = next(
        (r for r in builds_for(ctx, use_case_id, use_case) if r["build_id"] == build_id), None
    )
    if not run:
        raise refuse(f"no build {build_id} for {use_case_id}", status=404)
    return build_view(advance_build(ctx, run, use_case))


# ---------------------------------------------------------------------------
# Publication — a pointer, never a rewrite
# ---------------------------------------------------------------------------
@router.post("/graph-studio/{use_case_id}/versions/{sha}/publish")
def publish(
    use_case_id: str,
    sha: str,
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """Publishing makes the draft's *own* version live; it does not mint a new
    number. The gate still refuses an unreviewed graph whichever row is chosen,
    and **publishing an older row is the rollback**."""
    use_case = _built(ctx, use_case_id)

    row = next((v for v in versions_for(ctx, use_case_id) if v["sha256"] == sha), None)
    if not row:
        raise refuse(f"no version {sha} for {use_case_id} — build the graph again.", status=404)

    gate = graph_studio(ctx, use_case)["publish"]
    if gate["blocked"]:
        raise refuse(f"publish is blocked — {' · '.join(gate['reasons'])}")

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    # Written *or cleared* every time: a record keyed by content and holding a
    # fact about an act must be rewritten on every act, or an anonymous
    # re-publish keeps crediting whoever went last.
    set_publication(ctx, use_case_id, sha, as_ or None)
    return {"published": sha, "studio": graph_studio(ctx, use_case)}


@router.post("/graph-studio/{use_case_id}/versions/{sha}/unpublish")
def unpublish(use_case_id: str, sha: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Unpublishing takes a graph out of Ask immediately."""
    use_case = _built(ctx, use_case_id)
    if live_sha(ctx, use_case_id) != sha:
        raise refuse(f"version {sha} is not the published one — nothing to unpublish")
    clear_publication(ctx, use_case_id)
    return {"published": None, "studio": graph_studio(ctx, use_case)}
