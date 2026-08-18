"""
The What-if lens.

Nothing here writes to the graph. Computing a scenario returns figures and stores
nothing; the saved library holds generator ids, never figures — which is why
computing is a call rather than a calculation.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query

from ..core import is_email, now_iso, round_js
from ..deps import SUGGEST_MS, get_ctx, pace, refuse
from ..models import WhatIfScenario
from ..runtime import Ctx
from ..services.reports import report_graph_counts, report_graphs
from ..services.whatif import (
    ScenarioRefused,
    save_scenario,
    saved_all,
    whatif_frame,
    whatif_resolve,
    whatif_scenario,
)

router = APIRouter()


@router.get("/whatif")
def frame(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """**The gate replaces the lens, header chrome included.** With nothing
    published there is no graph to bind to, so the source-derived copy is absent —
    a claim about data one line above the sentence saying there is none was the
    original bug. The keys are still sent because the client validates their shape.
    """
    connected = len(ctx.connected_sources())
    counts = report_graph_counts(ctx)

    if counts["published_count"] == 0:
        w = ctx.doc["whatif"]
        return {
            "connected_sources": connected,
            **counts,
            "facility": None,
            "generators": [],
            "watched_measures": [],
            "candidate_pools": [],
            "formats": {},
            "headroom": [],
            "saved": [],
            "readers": [],
            "graphs": [],
            "copy": w["copy"],
            "state_defaults": w.get("state_defaults"),
            "authoring": w.get("authoring"),
            "runtime": w.get("runtime"),
            "publishing": w.get("publishing"),
            "graph_reference": w.get("graph_reference"),
        }

    return {
        "connected_sources": connected,
        **counts,
        **whatif_frame(ctx),
        "saved": saved_all(ctx),
    }


@router.post("/whatif/resolve")
async def resolve(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Paced like the suggesters, because a resolution that returns instantly
    reads as a lookup in a list the client already had."""
    asked = str(body.get("text") or "").strip()
    if not asked:
        raise refuse("type a measure to resolve against the graph")
    payload = whatif_resolve(ctx, asked)
    await pace(SUGGEST_MS)
    return payload


@router.post("/whatif/scenario")
def scenario(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    generator = next(
        (g for g in ctx.doc["whatif"]["generators"] if g["id"] == body.get("generator_id")), None
    )
    if not generator:
        raise refuse(
            f"no generator {body.get('generator_id')} in this pool — the Runtime only offers "
            "loads the frame allows",
            status=404,
        )

    watch = body.get("watch")
    keys = watch if isinstance(watch, list) else []
    unknown = [
        k for k in keys if not any(m["key"] == k for m in ctx.doc["whatif"]["watched_measures"])
    ]
    if unknown:
        raise refuse(f"not a watched measure: {', '.join(unknown)} — author it in step 1 first")

    return whatif_scenario(ctx, generator, keys)


@router.post("/whatif/saved")
def save(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    try:
        saved, saved_id = save_scenario(ctx, body)
    except ScenarioRefused as error:
        raise refuse(str(error), status=error.status) from error
    return {"saved": saved, "saved_id": saved_id}


@router.delete("/whatif/saved/{scenario_id}")
def delete(scenario_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    row = ctx.db.get(WhatIfScenario, scenario_id)
    if not row:
        raise refuse(f"no saved scenario {scenario_id}", status=404)
    ctx.db.delete(row)
    ctx.db.commit()
    return {"saved": saved_all(ctx), "deleted": scenario_id}


@router.post("/whatif/saved/{scenario_id}/publish")
def publish(
    scenario_id: str,
    body: dict = Body(default={}),
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """Records three decisions and verifies each against a pool the server owns:
    who the readers are, which *published* graph the figures are attributed to,
    and how fresh they stay.

    **Sharing is not access control** — what publishing records is who is *told*.
    """
    row = ctx.db.get(WhatIfScenario, scenario_id)
    if not row:
        raise refuse(f"no saved scenario {scenario_id}", status=404)

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    publishing = ctx.doc["whatif"]["publishing"]
    from ..services.whatif import whatif_readers

    directory = whatif_readers(ctx)

    readers = body.get("readers")
    picked = list(dict.fromkeys(str(r).strip() for r in readers)) if isinstance(readers, list) else []
    if not picked:
        raise refuse(publishing["readers"]["empty_error"])

    strangers = [e for e in picked if not any(d["email"] == e for d in directory)]
    if strangers:
        known = ", ".join(d["email"] for d in directory)
        raise refuse(
            f"{', '.join(strangers)} is not in the directory — Settings knows {known}"
        )
    in_directory_order = [d["email"] for d in directory if d["email"] in picked]

    live = report_graphs(ctx)
    graph = next(
        (g for g in live if g["use_case_id"] == body.get("graph_use_case_id")), None
    )
    if not graph:
        if not live:
            raise refuse(publishing["graph"]["empty"])
        names = ", ".join(f"{g['name']} ({g['use_case_id']})" for g in live)
        raise refuse(
            f'no published graph "{body.get("graph_use_case_id")}" — published now: {names}'
        )

    freshness = publishing["freshness"]
    fresh = body.get("freshness") or {}
    preset = next((p for p in freshness["presets"] if p["id"] == fresh.get("preset")), None)
    if not preset:
        offered = ", ".join(p["id"] for p in freshness["presets"])
        raise refuse(f'no freshness preset "{fresh.get("preset")}" — pick one of: {offered}')

    unit = str(fresh.get("unit") or freshness["default"]["unit"])
    if unit not in freshness["units"]:
        raise refuse(
            f'no freshness unit "{unit}" — pick one of: {", ".join(freshness["units"])}'
        )

    days = [str(d) for d in fresh["days"]] if isinstance(fresh.get("days"), list) else []
    strange_days = [d for d in days if d not in freshness["days"]]
    if strange_days:
        raise refuse(f"not a day of the week: {', '.join(strange_days)}")

    # A weekly custom schedule with no day would be accepted and quietly never
    # fired, which reads on the row as a live schedule.
    if preset["id"] == "custom" and unit == "week" and not days:
        raise refuse(freshness["no_day_error"])

    time = str(fresh.get("time") or freshness["default"]["time"])
    if time not in freshness["times"]:
        raise refuse(
            f'no freshness time "{time}" — pick one of: {", ".join(freshness["times"])}'
        )

    try:
        every = int(float(fresh.get("every")))
        every = min(max(every, 1), 52)
    except (TypeError, ValueError):
        every = 1

    row.publication = {
        "readers": in_directory_order,
        "graph_use_case_id": graph["use_case_id"],
        "graph_name": graph["name"],
        # The version *and* the content hash, so "which build did a reader see"
        # is answerable.
        "graph_version": graph["version"],
        "graph_sha256": graph["sha256"],
        "freshness": {
            "preset": preset["id"],
            "every": every,
            "unit": unit,
            "days": days,
            "time": time,
        },
        # Written on every publish rather than only when absent: an anonymous
        # re-publish must stop crediting whoever went last.
        "published_by": as_ or ctx.google_account.get("email"),
        "published_at": now_iso(),
    }
    ctx.db.commit()
    return {"saved": saved_all(ctx), "saved_id": scenario_id}


@router.delete("/whatif/saved/{scenario_id}/publish")
def unpublish(scenario_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Withdraws the publication and keeps the author's draft — which is what the
    dialog promises."""
    row = ctx.db.get(WhatIfScenario, scenario_id)
    if not row:
        raise refuse(f"no saved scenario {scenario_id}", status=404)
    row.publication = None
    ctx.db.commit()
    return {"saved": saved_all(ctx), "saved_id": scenario_id}
