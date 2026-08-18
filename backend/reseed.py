"""
Re-fill Postgres from the two JSON fixtures.

    python -m backend.reseed

The bootstrap runs by itself on a first boot and never again — Postgres is the
source of truth once it holds the document. This is the deliberate way back:
it drops the tenant's data and re-reads the fixtures, which is the fix when a
section has been edited into a state the API refuses to serve.

It does **not** clear the run state (sources, jobs, decisions, publications).
Pass `--all` for that.
"""

from __future__ import annotations

import sys

from .app.database import bootstrap, create_schema, engine, session
from .app.models import (
    Derivation,
    GovernanceEvent,
    GovernanceScope,
    OAuthSession,
    OAuthState,
    ProfilingJob,
    Source,
    StudioBuild,
    StudioDecision,
    StudioPivot,
    StudioPublication,
    WhatIfScenario,
)

RUN_STATE = (
    Source, ProfilingJob, OAuthState, OAuthSession, Derivation, StudioDecision,
    StudioPivot, StudioBuild, StudioPublication, WhatIfScenario, GovernanceEvent,
    GovernanceScope,
)


def main() -> int:
    create_schema()
    if "--all" in sys.argv:
        with session() as db:
            for model in RUN_STATE:
                db.query(model).delete()
            db.commit()
        print("cleared the run state (sources, jobs, decisions, publications)")

    bootstrap(reseed=True)
    print(f"re-seeded {engine.url.render_as_string(hide_password=True)} from the JSON fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
