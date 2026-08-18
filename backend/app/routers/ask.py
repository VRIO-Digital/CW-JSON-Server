"""
Ask.

`POST /ask` answers with `text/event-stream` — stages, then the summary, then one
block at a time, then `done` with the whole envelope. Pacing is per-piece rather
than one hold, so a five-block answer legitimately takes longer than a one-line
abstention.

**Refusals stay plain 400s before the stream opens**: an error must never arrive
as an event inside a 200, and refusals are never paced.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from ..deps import get_ctx, refuse
from ..runtime import Ctx
from ..services.ask import (
    ASK_BLOCK_MS,
    ASK_STAGE_MS,
    CITATION_OPTIONS,
    DEFAULT_CITATIONS,
    ask_answer,
    ask_answer_formats,
    askable_graph,
)
from ..services.ask import ask_requested
from ..services.studio import built_graphs, find_built_graph, published_version

router = APIRouter()


@router.get("/ask")
def list_live(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Lists only the graphs a publication resolves for — a draft is absent, a
    built-but-unpublished graph is absent, and unpublishing takes a graph out
    immediately. Both counts ride along, because "finish the wizard" and "press
    Publish" are different fixes."""
    built = built_graphs(ctx)
    graphs = [g for g in (askable_graph(ctx, u) for u in built) if g]
    graphs.sort(key=lambda g: g.get("published_at") or "", reverse=True)

    return {
        "graphs": graphs,
        "count": len(graphs),
        "built_count": len(built),
        "draft_count": len(ctx.doc["graph_use_cases"]) - len(built),
        "answer_requirements": {
            "citations_options": CITATION_OPTIONS,
            "default_citations": DEFAULT_CITATIONS,
            "formats": ask_answer_formats(ctx),
            "note": (
                "Citations really apply — an answer that carries none says so. A render "
                "format is stated, not applied: an answer renders as the blocks it holds."
            ),
        },
    }


@router.post("/ask")
def ask(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> StreamingResponse:
    use_case_id = str(body.get("use_case_id") or "").strip()
    if not use_case_id:
        raise refuse("choose a graph to ask first")

    found = find_built_graph(ctx, use_case_id)
    if found.get("error"):
        raise refuse(found["error"], status=found["status"])
    use_case = found["use_case"]

    if published_version(ctx, use_case_id) is None:
        raise refuse(
            f"{use_case['name']} has never been published — publish it in Graph Studio, "
            "then ask it"
        )

    question = body.get("question")
    if not str(question or "").strip():
        raise refuse("ask a question first")

    requested = ask_requested(ctx, body)
    if requested.get("error"):
        raise refuse(requested["error"])

    # Composed before the stream opens, which is how the summary event can state
    # `block_count` — a client-side guess would put a shimmer under an answer that
    # had already finished.
    answer = ask_answer(ctx, use_case, str(question).strip(), requested)

    async def stream() -> AsyncIterator[bytes]:
        def event(name: str, data: Any) -> bytes:
            return f"event: {name}\ndata: {json.dumps(data)}\n\n".encode("utf-8")

        for step in answer["reasoning"]:
            yield event("stage", {"step": step["step"], "detail": step["detail"]})
            await asyncio.sleep(ASK_STAGE_MS / 1000)

        yield event(
            "summary",
            {
                "answered": answer["answered"],
                "summary": answer["summary"],
                "reason": answer["reason"],
                "answer": answer["answer"],
                "block_count": len(answer.get("blocks") or []),
            },
        )

        for index, block in enumerate(answer.get("blocks") or []):
            await asyncio.sleep(ASK_BLOCK_MS / 1000)
            yield event("block", {"index": index, "block": block})

        await asyncio.sleep(ASK_BLOCK_MS / 1000)
        yield event("done", answer)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-store", "x-accel-buffering": "no"},
    )
