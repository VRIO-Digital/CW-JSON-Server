"""
Reports.

**Publication is the only gate.** Nothing published means empty collections and
`published_count: 0`, with the other two counts beside it because "publish the
build you have" and "finish a draft" are different fixes. A connected source is
deliberately not a second gate: publishing is already downstream of having
something to build from.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query

from .. import store
from ..core import is_email, js_hash, now_iso
from ..deps import SUGGEST_MS, get_ctx, pace, refuse
from ..runtime import Ctx
from ..services.governance import report_governance_view
from ..services.reports import (
    REPORT_HORIZON_CAVEAT,
    report_build,
    report_build_reading,
    report_frame_from,
    report_frame_problem,
    report_graph,
    report_graph_counts,
    report_graph_for,
    report_match,
    report_role_from,
    report_saved_view,
    report_view,
    report_viewer_roles_problem,
    reports_list,
)

router = APIRouter()

RESTORE = "python -m backend.reseed governance"


@router.get("/reports")
def index(
    as_role: str | None = Query(default=None), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    connected = len(ctx.connected_sources())
    counts = report_graph_counts(ctx)
    if counts["published_count"] == 0:
        return {
            "connected_sources": connected,
            **counts,
            "graph": None,
            "graphs": [],
            "reports": [],
            "saved": [],
            "authoring": None,
        }
    return {
        "connected_sources": connected,
        **counts,
        **reports_list(ctx, report_role_from(as_role, ctx)),
    }


# ---------------------------------------------------------------------------
# Governance writes — both commit, because both are somebody's decision
# ---------------------------------------------------------------------------
@router.patch("/reports/governance/{report_id}/audience")
def set_audience(
    report_id: str,
    body: dict = Body(default={}),
    as_role: str | None = Query(default=None),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """`[]` is **private**, and private is a decision — accepted here for exactly
    that reason, while the seed still refuses one because there it is a typo."""
    rows = ctx.doc["reports"]["governance"]["reports"]
    if not any(r["report_id"] == report_id for r in rows):
        known = ", ".join(r["report_id"] for r in rows)
        raise refuse(f'no governed report "{report_id}" — this tenant governs {known}', 404)

    audience = body.get("audience")
    if not isinstance(audience, list):
        pool = ", ".join(r["role_id"] for r in ctx.doc["auth_roles"])
        raise refuse(
            "send audience as an array of role ids — an empty array makes the report private, "
            f"which is a decision. Roles: {pool}"
        )

    ids = list(dict.fromkeys(str(r) for r in audience))
    unknown = [i for i in ids if not any(r["role_id"] == i for r in ctx.doc["auth_roles"])]
    if unknown:
        pool = ", ".join(r["role_id"] for r in ctx.doc["auth_roles"])
        raise refuse(f"no such role: {', '.join(unknown)} — this tenant has {pool}")

    try:
        ctx.commit(
            {
                **ctx.doc,
                "reports": {
                    **ctx.doc["reports"],
                    "governance": {
                        **ctx.doc["reports"]["governance"],
                        "reports": [
                            {**r, "audience": ids} if r["report_id"] == report_id else r
                            for r in rows
                        ],
                    },
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error

    return {"governance": report_governance_view(ctx, report_role_from(as_role, ctx))}


@router.delete("/reports/governance/{report_id}")
def delete_governance(
    report_id: str,
    as_role: str | None = Query(default=None),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """Drops the governance row, **not the definition** — which stays, so a
    re-seed restores it. The reply carries the command, because "gone for good"
    and "a seed brings it back" are different promises."""
    rows = ctx.doc["reports"]["governance"]["reports"]
    if not any(r["report_id"] == report_id for r in rows):
        known = ", ".join(r["report_id"] for r in rows)
        raise refuse(f'no governed report "{report_id}" — this tenant governs {known}', 404)

    if len(rows) == 1:
        raise refuse(
            "this is the last governed definition — removing it would leave the section with "
            "nothing to govern, which reads as a broken page rather than an empty one. "
            f'Re-seed with "{RESTORE}" if that is really what you want.'
        )

    try:
        ctx.commit(
            {
                **ctx.doc,
                "reports": {
                    **ctx.doc["reports"],
                    "governance": {
                        **ctx.doc["reports"]["governance"],
                        "reports": [r for r in rows if r["report_id"] != report_id],
                    },
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error

    return {
        "removed": report_id,
        "restore": RESTORE,
        "governance": report_governance_view(ctx, report_role_from(as_role, ctx)),
    }


# ---------------------------------------------------------------------------
# Reading a question, and building from a frame
# ---------------------------------------------------------------------------
@router.post("/reports/read")
async def read_question(
    body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """**Returns a sentence and a frame, never figures**, and is paced because
    reading a question back is the one act here that reads as a model call.
    Picking a standard report by id is neither matched nor paced."""
    rep = ctx.doc["reports"]
    asked = str(body.get("question") or "").strip()
    use_case_id = body.get("use_case_id")

    # A frame is validated before the sentence is read: a sentence read back
    # against a graph nobody published is theatre.
    if use_case_id:
        from ..services.reports import report_graphs

        if not any(g["use_case_id"] == use_case_id for g in report_graphs(ctx)):
            first = rep["reports"][0]
            raise refuse(
                report_frame_problem(
                    ctx,
                    {
                        "report_id": first["report_id"],
                        "use_case_id": use_case_id,
                        "scope": first["scope"],
                        "measure": first["measure"],
                        "horizon": rep["assumptions"]["horizon"]["value"],
                        "filters": [],
                    },
                )
                or f'"{use_case_id}" is not a published graph'
            )

    report_id = body.get("report_id")
    picked = (
        next((r for r in rep["reports"] if r["report_id"] == report_id), None)
        if report_id
        else None
    )
    if report_id and not picked:
        known = ", ".join(r["report_id"] for r in rep["reports"])
        raise refuse(f'no report "{report_id}" — this section has {known}', status=404)
    if not picked and not asked:
        raise refuse("type what you need, or start from one of the standard reports")

    if picked:
        match = {"report": picked, "matched": True, "why": f"Starting from {picked['report_tag']}."}
    else:
        match = report_match(ctx, asked)

    frame = {
        "report_id": match["report"]["report_id"],
        # The graph is part of the frame, not a detail of the request that read it
        # back.
        "use_case_id": use_case_id or (report_graph(ctx) or {}).get("use_case_id"),
        "scope": match["report"]["scope"],
        "measure": match["report"]["measure"],
        "horizon": rep["assumptions"]["horizon"]["value"],
        "filters": [],
    }

    payload = {
        "question": picked["question"] if picked else asked,
        "matched": match["matched"],
        "why": match["why"],
        "report_tag": match["report"]["report_tag"],
        "heading": match["report"]["heading"],
        "spine": match["report"]["spine"],
        "graph": report_graph_for(ctx, frame["use_case_id"]),
        "frame": frame,
        **report_build_reading(ctx, match["report"], frame),
        "caveats": [REPORT_HORIZON_CAVEAT],
    }

    if not picked:
        await pace(SUGGEST_MS)
    return payload


@router.post("/reports/build")
def build(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Not paced: it is a read over the rosters, like a What-if scenario."""
    frame = report_frame_from(body)
    problem = report_frame_problem(ctx, frame)
    if problem:
        raise refuse(problem)
    report = next(
        (r for r in ctx.doc["reports"]["reports"] if r["report_id"] == frame["report_id"])
    )
    return {"report": report_build(ctx, report, frame)}


# ---------------------------------------------------------------------------
# Saved reports — a question, not a result
# ---------------------------------------------------------------------------
@router.post("/reports/saved")
def save(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Stores the frame and the question, and **no figures**, so reading it back
    re-asks it.

    **Who saved it is told, never guessed.** The identity is client-held and the
    server has nothing to look it up from, so saving without a name is a 400:
    naming is the one thing the app must not decide.
    """
    frame = report_frame_from(body)
    problem = report_frame_problem(ctx, frame)
    if problem:
        raise refuse(problem)

    name = str(body.get("name") or "").strip()
    if not name:
        raise refuse("name this report so the library is readable")

    viewer_roles = (
        [str(r) for r in body["viewer_roles"]]
        if isinstance(body.get("viewer_roles"), list)
        else None
    )
    roles_problem = report_viewer_roles_problem(ctx, viewer_roles)
    if roles_problem:
        raise refuse(roles_problem)

    saved_by = str(body["saved_by"]).strip() if body.get("saved_by") else None
    if saved_by is not None and not is_email(saved_by):
        raise refuse(
            f'"{saved_by}" is not an email — send the signed-in address as saved_by, or nothing'
        )

    saved = list(ctx.doc["reports"].get("saved") or [])
    index = -1
    if body.get("saved_id"):
        index = next(
            (i for i, s in enumerate(saved) if s["saved_id"] == body["saved_id"]), -1
        )

    previous = saved[index] if index >= 0 else {}
    row = {
        "saved_id": body["saved_id"] if index >= 0 else f"rp-{len(saved) + 1}-{js_hash(name) % 9999}",
        "name": name,
        "question": str(body.get("question") or "").strip() or None,
        **frame,
        "saved_by": saved_by if saved_by is not None else previous.get("saved_by"),
        # Stored as role ids, so a renamed role leaves no stale label.
        "viewer_roles": viewer_roles
        if viewer_roles is not None
        else previous.get("viewer_roles") or [r["role_id"] for r in ctx.doc["auth_roles"]],
        "saved_at": now_iso(),
    }

    if index >= 0:
        saved[index] = row
    else:
        saved.append(row)

    try:
        ctx.commit({**ctx.doc, "reports": {**ctx.doc["reports"], "saved": saved}})
    except store.Refused as error:
        raise refuse(str(error)) from error

    return {"saved": [report_saved_view(ctx, s) for s in ctx.doc["reports"].get("saved") or []]}


@router.get("/reports/saved/{saved_id}")
def read_saved(saved_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Re-asks the question rather than returning a stored result. A row whose
    graph is no longer published still answers and says so in a caveat."""
    saved_rows = ctx.doc["reports"].get("saved") or []
    saved = next((s for s in saved_rows if s["saved_id"] == saved_id), None)
    if not saved:
        raise refuse(
            f"no saved report {saved_id} — the library has {len(saved_rows)} report(s)",
            status=404,
        )

    connected = len(ctx.connected_sources())
    counts = report_graph_counts(ctx)
    if counts["published_count"] == 0:
        return {"connected_sources": connected, **counts, "report": None, "saved": None}

    report = next(
        (r for r in ctx.doc["reports"]["reports"] if r["report_id"] == saved["report_id"])
    )
    return {
        "connected_sources": connected,
        **counts,
        "saved": report_saved_view(ctx, saved),
        "report": report_build(
            ctx,
            report,
            {
                "report_id": saved["report_id"],
                "use_case_id": saved.get("use_case_id"),
                "scope": saved["scope"],
                "measure": saved["measure"],
                "horizon": saved["horizon"],
                "filters": saved.get("filters") or [],
            },
        ),
    }


@router.post("/reports/saved/{saved_id}/roles")
def set_roles(
    saved_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """Its own endpoint rather than a field on the save: setting an audience is
    not re-saving the report, and asking the caller to re-post the frame, the name
    and the question invites one of them to arrive stale."""
    saved = list(ctx.doc["reports"].get("saved") or [])
    if not any(s["saved_id"] == saved_id for s in saved):
        raise refuse(f"no saved report {saved_id}", status=404)

    raw = body.get("viewer_roles")
    ids = [str(r) for r in raw] if isinstance(raw, list) else None
    problem = report_viewer_roles_problem(ctx, ids)
    if problem:
        raise refuse(problem)

    try:
        ctx.commit(
            {
                **ctx.doc,
                "reports": {
                    **ctx.doc["reports"],
                    "saved": [
                        {**s, "viewer_roles": ids} if s["saved_id"] == saved_id else s
                        for s in saved
                    ],
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error

    return {"saved": [report_saved_view(ctx, s) for s in ctx.doc["reports"].get("saved") or []]}


@router.delete("/reports/saved/{saved_id}")
def delete_saved(saved_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    saved = list(ctx.doc["reports"].get("saved") or [])
    if not any(s["saved_id"] == saved_id for s in saved):
        raise refuse(f"no saved report {saved_id}", status=404)
    try:
        ctx.commit(
            {
                **ctx.doc,
                "reports": {
                    **ctx.doc["reports"],
                    "saved": [s for s in saved if s["saved_id"] != saved_id],
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error
    return {
        "saved": [report_saved_view(ctx, s) for s in ctx.doc["reports"].get("saved") or []],
        "deleted": saved_id,
    }


# Declared last: `/reports/{report_id}` matches the parent segment of every route
# above, so it must not be able to win.
@router.get("/reports/{report_id}")
def read_report(report_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    report = next(
        (r for r in ctx.doc["reports"]["reports"] if r["report_id"] == report_id), None
    )
    if not report:
        known = ", ".join(r["report_id"] for r in ctx.doc["reports"]["reports"])
        raise refuse(f'no report "{report_id}" — this section has {known}', status=404)

    connected = len(ctx.connected_sources())
    counts = report_graph_counts(ctx)
    if counts["published_count"] == 0:
        return {"connected_sources": connected, **counts, "report": None}
    return {"connected_sources": connected, **counts, "report": report_view(ctx, report)}
