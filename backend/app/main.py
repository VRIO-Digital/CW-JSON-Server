"""
The ContextWeave API — FastAPI over PostgreSQL.

Replaces the zero-dependency Node mock server. Same routes, same payload shapes,
same pacing; the data lives in Postgres instead of two JSON files, and the state
that used to die with the process (registered sources, profiling jobs, review
decisions, builds, publications) is now in tables of its own.

    python -m uvicorn backend.app.main:app --port 4000 --reload

The frontend calls it exactly as before: Vite proxies /api here with the prefix
stripped.
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .database import bootstrap, create_schema, engine, is_empty, session
from .routers import (
    admin,
    ask,
    connect,
    governance,
    graph,
    reports,
    sources,
    studio,
    telemetry,
    whatif,
)
from .store import load, load_settings
from .validate import validate_db, validate_settings


def _driver_line(error: Exception) -> str:
    """The driver's own sentence, not the last line of the wrapper.

    SQLAlchemy appends a docs URL, so `splitlines()[-1]` reports
    "(Background on this error at: …)" — true, and useless. The line worth
    printing is the one naming the cause.
    """
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    for line in lines:
        if any(
            marker in line
            for marker in ("FATAL", "could not connect", "Connection refused",
                           "does not exist", "timeout expired", "no password supplied")
        ):
            return line
    return lines[0] if lines else repr(error)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the schema, fill it once, then refuse to serve a document the
    routes cannot read.

    The refusal is the point. Losing a key does not throw — it *answers*: drop
    `column_profiles` and the profiler quietly swaps 206 real columns for
    synthesised ones. Failing here names the missing key at the one moment the
    fix is obvious.
    """
    # Checked before anything touches the schema. SQLAlchemy's own failure here is
    # a 30-line traceback whose one useful line is buried, and the cause is almost
    # always one of three things a person can fix in a second — so it is named.
    # Same reasoning as checking a JSON file for conflict markers *before* parsing
    # it: a diagnostic that runs after the failure never runs on the worst input.
    try:
        with engine.connect():
            pass
    except Exception as error:
        dsn = engine.url.render_as_string(hide_password=True)
        print("\ncontextweave-api: refusing to start — cannot reach PostgreSQL.")
        print(f"  · {dsn}")
        print(f"  · {_driver_line(error)}\n")
        print("  The connection is stated in backend/app/database.py and nowhere else —")
        print("  five values at the top of the file. Check, in this order:\n")
        print("    1. the server is running        pg_isready -h localhost -p 5432")
        print("    2. the password is right        it is PG_PASSWORD in that file")
        print("    3. the port is the right one    a second install often takes 5433 or 5434\n")
        # `os._exit`, not `SystemExit`: raising out of lifespan makes uvicorn log a
        # 30-frame traceback underneath the message above, which buries the one
        # line that matters — the failure this whole block exists to prevent.
        sys.stdout.flush()
        os._exit(1)

    create_schema()
    if bootstrap():
        print("contextweave-api: bootstrapped Postgres from the JSON fixtures (once).")

    with session() as db:
        document = load(db)
        settings = load_settings(db)

    problems = validate_db(document)
    if problems:
        print("\ncontextweave-api: refusing to start — the stored document cannot be served.")
        for problem in problems:
            print(f"  · {problem}")
        print("\n  Re-bootstrap it:\n      python -m backend.reseed\n")
        raise SystemExit(1)

    problems = validate_settings(document, settings)
    if problems:
        print("\ncontextweave-api: refusing to start — the stored settings cannot be served.")
        for problem in problems:
            print(f"  · {problem}")
        print("\n  Re-bootstrap them:\n      python -m backend.reseed\n")
        raise SystemExit(1)

    projects = len(document["projects"])
    datasets = sum(len(p["datasets"]) for p in document["projects"])
    tables = sum(len(d["tables"]) for p in document["projects"] for d in p["datasets"])
    drives = len(document["drives"])
    folders = sum(len(d["folders"]) for d in document["drives"])
    documents = sum(len(f["documents"]) for d in document["drives"] for f in d["folders"])

    print(f"contextweave-api: {engine.url.render_as_string(hide_password=True)}")
    print(f"  {projects} GCP projects · {datasets} datasets · {tables} tables")
    print(f"  {drives} Drives · {folders} folders · {documents} documents")

    yield


app = FastAPI(title="ContextWeave API", version="2.0.0", lifespan=lifespan)

# The deployed SPA calls this cross-origin, so every response carries the
# permissive headers the Node server sent — including on the OPTIONS preflight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    response.headers["cache-control"] = "no-store"
    return response


for module in (
    admin,
    connect,
    sources,
    graph,
    studio,
    ask,
    whatif,
    reports,
    governance,
    telemetry,
):
    app.include_router(module.router)


@app.exception_handler(StarletteHTTPException)
async def refusal(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """**`{ "error": "…" }` at the top level, on every refusal.**

    This is a contract, not a preference. `client.ts` reads `payload.error` and
    shows it verbatim — that is the whole reason the server's 400s are written as
    sentences to a person. FastAPI's default envelope is `{ "detail": … }`, which
    the client cannot see into, so every one of those carefully worded refusals
    would reach the user as "request failed (400)".
    """
    if exc.status_code == 404 and not _has_error(exc.detail):
        return JSONResponse(
            status_code=404,
            content={
                "error": f"no route for {request.method} {request.url.path} — if this "
                "endpoint is new, this server started before it existed. Restart it."
            },
        )

    if isinstance(exc.detail, dict) and "error" in exc.detail:
        content = exc.detail
    else:
        content = {"error": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content=content)


@app.exception_handler(RequestValidationError)
async def malformed(request: Request, exc: RequestValidationError) -> JSONResponse:
    """A malformed body is a 400 in the same envelope, naming the field.

    FastAPI's own 422 carries a list of objects the client would render as
    `request failed (422)`. The Node server answered a bad body with
    `{"error": "invalid JSON body"}` and a 400, so that is what this does.
    """
    parts = []
    for err in exc.errors():
        where = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query"))
        parts.append(f"{where}: {err.get('msg')}" if where else str(err.get("msg")))
    return JSONResponse(
        status_code=400,
        content={"error": "; ".join(parts) or "the request body could not be read"},
    )


def _has_error(detail: object) -> bool:
    return isinstance(detail, dict) and "error" in detail
