"""
Shared plumbing for the routers: a session per request, a `Ctx` built from it,
refusals that arrive as the sentence a user reads, and the pacing the UI depends
on.
"""

from __future__ import annotations

import asyncio
from typing import Iterator

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .database import SessionLocal
from .runtime import Ctx


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_ctx(db: Session = Depends(get_db)) -> Ctx:
    return Ctx(db)


def refuse(message: str, status: int = 400) -> HTTPException:
    """Every message here is read by a user, not a maintainer — the server's own
    400s are shown verbatim, so they are written as sentences to a person."""
    return HTTPException(status_code=status, detail={"error": message})


async def pace(ms: int) -> None:
    """**A stage advances when its request returns, not on a timer the client
    holds.** The hold is here, on the endpoint, for the same reason the profiler
    is paced: an operation that returns instantly and shows nothing teaches that
    it is free, and these are the calls that would really reach Google or a model.

    Refusals are never paced — a five-second 403 on a mistyped handle reads as a
    hang.
    """
    await asyncio.sleep(ms / 1000)


# Pacing, all of it server-side.
CONSENT_START_MS = 900
CONSENT_MS = 1400
DISCOVERY_MS = 800
CONNECT_STEP_MS = 5000
SUGGEST_MS = 1100
