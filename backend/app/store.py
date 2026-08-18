"""
Reading and writing the tenant's document.

The Node server held `db.json` in memory and rewrote the whole file on every
commit. Here the document is assembled from Postgres per request and written
back key by key — so two writers touching different sections cannot clobber
each other the way one whole-file write did.

`load()` returns a plain dict with exactly the shape the routes expect, which is
what makes the ported logic a translation rather than a rewrite.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import _row_id
from .models import Collection, Document, Setting
from .validate import validate_db, validate_settings


class Refused(Exception):
    """A write the database will not accept, with the reason a user can act on."""


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------
def load(db: Session) -> dict[str, Any]:
    document: dict[str, Any] = {}
    kinds = {}
    for row in db.scalars(select(Document)).all():
        kinds[row.key] = row.kind
        document[row.key] = [] if row.kind == "array" else row.value

    for row in db.scalars(
        select(Collection).order_by(Collection.collection, Collection.position)
    ).all():
        document.setdefault(row.collection, []).append(row.data)

    return document


def sections(db: Session) -> list[dict[str, Any]]:
    document = load(db)
    from .validate import DB_SHAPE

    out = []
    for key, value in document.items():
        if isinstance(value, list):
            kind, count = "array", len(value)
        elif isinstance(value, dict):
            kind, count = "object", len(value)
        else:
            kind, count = type(value).__name__, 1
        out.append({"key": key, "kind": kind, "count": count, "required": key in DB_SHAPE})
    return out


def commit(db: Session, document: dict[str, Any]) -> None:
    """Validate, then persist. Refuses rather than writing a document the API
    could not serve — the same rule the Node `commitDb` kept."""
    problems = validate_db(document)
    if problems:
        raise Refused(
            "refusing to write — "
            + "; ".join(problems)
            + ". Restore the section, or re-seed it."
        )

    existing = {row.key: row for row in db.scalars(select(Document)).all()}

    for key, value in document.items():
        if isinstance(value, list):
            _write_collection(db, key, value)
            row = existing.get(key)
            if row is None:
                db.add(Document(key=key, kind="array", value=None))
            else:
                row.kind, row.value = "array", None
        else:
            row = existing.get(key)
            if row is None:
                db.add(Document(key=key, kind="object", value=value))
            elif row.value != value or row.kind != "object":
                row.kind, row.value = "object", value

    for key, row in existing.items():
        if key not in document:
            db.execute(delete(Collection).where(Collection.collection == key))
            db.delete(row)

    db.commit()


def commit_section(db: Session, key: str, value: Any) -> None:
    document = load(db)
    document[key] = value
    commit(db, document)


def _write_collection(db: Session, key: str, rows: list[Any]) -> None:
    """Replace one collection's rows. Whole-collection replacement rather than a
    diff: the positions are the authored order, and a partial update that leaves
    a stale position reorders somebody's list without saying so."""
    current = db.scalars(
        select(Collection).where(Collection.collection == key).order_by(Collection.position)
    ).all()
    if [r.data for r in current] == list(rows):
        return

    db.execute(delete(Collection).where(Collection.collection == key))
    db.flush()
    for position, row in enumerate(rows):
        db.add(
            Collection(
                collection=key,
                position=position,
                row_id=_row_id(key, row, position),
                data=row,
            )
        )


# ---------------------------------------------------------------------------
# Settings — its own small store, separate from the document
# ---------------------------------------------------------------------------
def load_settings(db: Session) -> dict[str, Any]:
    return {row.key: row.value for row in db.scalars(select(Setting)).all()}


def commit_settings(db: Session, document: dict[str, Any], settings: dict[str, Any]) -> None:
    problems = validate_settings(document, settings)
    if problems:
        raise Refused(
            "refusing to write settings — "
            + "; ".join(problems)
            + ". Re-author them if they have drifted."
        )

    existing = {row.key: row for row in db.scalars(select(Setting)).all()}
    for key, value in settings.items():
        row = existing.get(key)
        if row is None:
            db.add(Setting(key=key, value=value))
        elif row.value != value:
            row.value = value
    for key, row in existing.items():
        if key not in settings:
            db.delete(row)
    db.commit()
