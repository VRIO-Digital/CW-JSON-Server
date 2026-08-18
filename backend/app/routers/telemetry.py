"""
Audit, traces, evals and change signals — all gated on a connected source.

**Nothing exists until a source is connected.** Each returns empty collections
plus `connected_sources: 0`, and each page renders its own empty state instead of
its cards. A *disconnected* source counts as not connected, but stays listed on
Sources so it can still be reconnected or deleted.

**The gated shape is not just "the lists, emptied".** Every scalar the payload
carries has to be there too, at its own empty value — `''` for a sentence, `0`
for a total, `null` for the waterfall — because `client.ts` validates the whole
envelope, and an absent key fails the schema exactly as a wrong type does. A
first draft of this file emptied only the arrays; three of the four endpoints
then failed the app's own validator with `waterfall should be an object, got
array` and friends, which reaches a user as "the trace data could not be read".
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..deps import get_ctx
from ..runtime import Ctx

router = APIRouter()


@router.get("/audit")
def audit(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    connected = len(ctx.connected_sources())
    doc = ctx.doc["audit"]
    body = {"stats": [], "events": [], "policies": []} if connected == 0 else dict(doc)
    return {
        **body,
        "event_window": "" if connected == 0 else doc["event_window"],
        "policy_total": 0 if connected == 0 else doc["policy_total"],
        "connected_sources": connected,
    }


@router.get("/traces")
def traces(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    connected = len(ctx.connected_sources())
    body = (
        {"stats": [], "items": [], "sampling": "", "waterfall": None}
        if connected == 0
        else dict(ctx.doc["traces"])
    )
    return {**body, "connected_sources": connected}


@router.get("/evals")
def evals(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    connected = len(ctx.connected_sources())
    body = (
        {"stats": [], "runs": [], "checks": [], "run_trigger": "", "failure_summary": ""}
        if connected == 0
        else dict(ctx.doc["evals"])
    )
    return {**body, "connected_sources": connected}


@router.get("/change-signals")
def change_signals(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """No surface reads this — the Catalogue's third tab was removed on request.
    The endpoint stays, waiting for a caller, rather than being deleted along with
    the layers beneath it."""
    connected = len(ctx.connected_sources())
    signals = ctx.doc["change_signals"] if connected else []
    return {
        "signals": signals,
        "count": len(signals),
        "connected_sources": connected,
    }
