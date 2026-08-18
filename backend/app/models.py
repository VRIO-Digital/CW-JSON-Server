"""
The schema.

Two ideas, and the split between them is the whole design:

* **`documents` and `collections` hold the tenant's data.** A top-level key that
  is an object (`graph_studio`, `reports`, `whatif`) is one `documents` row; a
  key that is a list (`projects`, `ask_answers`) is a `collections` row per
  member, so it is queryable as rows rather than buried in one blob. Every key
  lives in exactly one of the two — `documents.kind` says which — because two
  homes for one collection is how they come to disagree.

* **Everything else was in-memory in the Node server and is now a table.**
  Registered sources, profiling jobs, consent sessions, studio decisions,
  builds and publications used to die with the process. They persist now, which
  is a real change in behaviour and a deliberate one: a database that forgets
  what it was told is not a database.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# Postgres is the target and gets real JSONB — indexable, and the reason the
# document can live in a column at all. The plain-JSON variant exists so the
# whole stack can be exercised on SQLite in a test without a server.
Json = JSON().with_variant(JSONB, "postgresql")
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# The tenant's data
# ---------------------------------------------------------------------------
class Document(Base):
    """One top-level key. `kind='array'` means the rows are in `collections`."""

    __tablename__ = "cw_documents"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="object")
    value: Mapped[dict | None] = mapped_column(Json, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Collection(Base):
    """One member of a list-shaped top-level key, in its authored order."""

    __tablename__ = "cw_collection_rows"
    __table_args__ = (
        Index("ix_cw_collection_rows_key", "collection", "position"),
        UniqueConstraint("collection", "position", name="uq_cw_collection_position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection: Mapped[str] = mapped_column(String(120), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    row_id: Mapped[str] = mapped_column(String(255), nullable=False)
    data: Mapped[dict] = mapped_column(Json, nullable=False)


class Setting(Base):
    """settings.json — users, persona navigation, and the defaults Reset restores."""

    __tablename__ = "cw_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict | list] = mapped_column(Json, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------------------------------------------------------------------------
# Run state — everything the Node server kept in memory
# ---------------------------------------------------------------------------
class Source(Base):
    """A source registered through the connect wizard."""

    __tablename__ = "cw_sources"

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    connector: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="connected")
    registered_at: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(Json, nullable=False)


class ProfilingJob(Base):
    __tablename__ = "cw_profiling_jobs"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    triggered_at: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(Json, nullable=False)


class OAuthState(Base):
    __tablename__ = "cw_oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    data: Mapped[dict] = mapped_column(Json, nullable=False, default=dict)


class OAuthSession(Base):
    __tablename__ = "cw_oauth_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    account: Mapped[str] = mapped_column(String(255), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    data: Mapped[dict] = mapped_column(Json, nullable=False, default=dict)


class Derivation(Base):
    __tablename__ = "cw_graph_derivations"

    derivation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    data: Mapped[dict] = mapped_column(Json, nullable=False)


class StudioDecision(Base):
    """One review-queue answer, keyed by graph *and* row so two graphs cannot
    answer each other's questions."""

    __tablename__ = "cw_studio_decisions"
    __table_args__ = (
        UniqueConstraint("use_case_id", "item_id", name="uq_cw_studio_decision"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    use_case_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    choice: Mapped[str] = mapped_column(String(64), nullable=False)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[str] = mapped_column(String(64), nullable=False)
    decided_by: Mapped[str] = mapped_column(String(255), nullable=False)


class StudioPivot(Base):
    __tablename__ = "cw_studio_pivots"

    use_case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    option_id: Mapped[str] = mapped_column(String(64), nullable=False)
    decided_at: Mapped[str] = mapped_column(String(64), nullable=False)
    decided_by: Mapped[str] = mapped_column(String(255), nullable=False)


class StudioBuild(Base):
    __tablename__ = "cw_studio_builds"

    build_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    use_case_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(Json, nullable=False)


class StudioPublication(Base):
    """Which content hash is live for a graph, and who put it there.

    Keyed by graph and hash rather than by graph alone, because who published a
    build is a fact about that build — and it is rewritten on every publish, so
    an anonymous re-publish cannot keep crediting whoever went last.
    """

    __tablename__ = "cw_studio_publications"
    __table_args__ = (
        UniqueConstraint("use_case_id", "sha256", name="uq_cw_studio_publication"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    use_case_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    sha256: Mapped[str] = mapped_column(String(128), nullable=False)
    live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    published_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    published_at: Mapped[str | None] = mapped_column(String(64), nullable=True)


class WhatIfScenario(Base):
    __tablename__ = "cw_whatif_scenarios"

    scenario_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    saved_at: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(Json, nullable=False)
    publication: Mapped[dict | None] = mapped_column(Json, nullable=True)


class GovernanceEvent(Base):
    """The audit trail — rule changes, readers added and removed, withdrawals."""

    __tablename__ = "cw_governance_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[str] = mapped_column(String(64), nullable=False)
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[dict] = mapped_column(Json, nullable=False, default=dict)


class GovernanceScope(Base):
    """A persona's access rule: a restriction basis and the values it admits."""

    __tablename__ = "cw_governance_scopes"

    role_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    basis: Mapped[str | None] = mapped_column(String(64), nullable=True)
    values: Mapped[list] = mapped_column(Json, nullable=False, default=list)
    updated_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
