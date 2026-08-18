"""
PostgreSQL connection, schema and bootstrap for the ContextWeave API.

The connection is stated here and nowhere else — no .env file, no config module.
Change these five values to point at a different server.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from .models import Base, Collection, Document, Setting

# ---------------------------------------------------------------------------
# The connection. pgAdmin's default local server.
# ---------------------------------------------------------------------------
PG_HOST = "localhost"
PG_PORT = 5432
PG_DATABASE = "postgres"
PG_USER = "postgres"
PG_PASSWORD = "postgres"

DATABASE_URL = (
    f"postgresql+psycopg2://{PG_USER}:{PG_PASSWORD}"
    f"@{PG_HOST}:{PG_PORT}/{PG_DATABASE}"
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def session() -> Session:
    return SessionLocal()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
def create_schema() -> None:
    """Create every table this API needs. Safe to call on every boot."""
    Base.metadata.create_all(engine)


# ---------------------------------------------------------------------------
# Bootstrap
#
# The tenant's data ships as two JSON fixtures. They are read exactly once, to
# fill an empty database; after that Postgres is the only source of truth and
# the files are never read again. `--reseed` on the CLI forces a re-read.
# ---------------------------------------------------------------------------
FIXTURES = Path(__file__).resolve().parents[2] / "mock-server"
DB_FIXTURE = FIXTURES / "db.json"
SETTINGS_FIXTURE = FIXTURES / "settings.json"


def _read_fixture(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(
            f"\ncontextweave-api: cannot bootstrap — {path} is not there.\n"
            "  The database is empty and there is nothing to fill it from.\n"
        )
    text = path.read_text(encoding="utf-8")
    for i, line in enumerate(text.splitlines(), start=1):
        if line.startswith(("<<<<<<<", "=======", ">>>>>>>")):
            raise SystemExit(
                f"\ncontextweave-api: refusing to bootstrap — {path.name} still has "
                f"merge conflict markers.\n  · line {i}: {line[:60]}\n"
            )
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise SystemExit(
            f"\ncontextweave-api: refusing to bootstrap — {path.name} is not valid "
            f"JSON.\n  · line {error.lineno}, column {error.colno}: {error.msg}\n"
        ) from error


def is_empty(db: Session) -> bool:
    return db.scalar(select(Document.key).limit(1)) is None


def bootstrap(reseed: bool = False) -> bool:
    """Fill the database from the fixtures. Returns True if it wrote anything."""
    with session() as db:
        if not reseed and not is_empty(db):
            return False

        if reseed:
            db.query(Collection).delete()
            db.query(Document).delete()
            db.query(Setting).delete()
            db.flush()

        document = _read_fixture(DB_FIXTURE)
        settings = _read_fixture(SETTINGS_FIXTURE)

        for key, value in document.items():
            if isinstance(value, list):
                # A list key lives in `collections` and nowhere else; the
                # `documents` row records only that it is one.
                db.add(Document(key=key, kind="array", value=None))
                for position, row in enumerate(value):
                    db.add(
                        Collection(
                            collection=key,
                            position=position,
                            row_id=_row_id(key, row, position),
                            data=row,
                        )
                    )
            else:
                db.add(Document(key=key, kind="object", value=value))

        for key, value in settings.items():
            db.add(Setting(key=key, value=value))

        db.commit()
        return True


_ID_FIELDS = (
    "id",
    "role_id",
    "project_id",
    "drive_id",
    "domain_id",
    "persona_id",
    "kpi_id",
    "question_id",
    "format_id",
    "template_id",
    "use_case_id",
    "answer_id",
    "signal_id",
    "credential_handle",
    "name",
)


def _row_id(collection: str, row: Any, position: int) -> str:
    if isinstance(row, dict):
        for field in _ID_FIELDS:
            if isinstance(row.get(field), str):
                return row[field]
    return f"{collection}:{position}"
