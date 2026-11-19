"""SQLite persistence via SQLAlchemy.

Tables are created on startup with ``create_all``; there are no migrations yet.
While the schema is changing during development, delete ``backend/data/vouch.db``
after pulling a schema change.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Request
from sqlalchemy import DateTime, Engine, create_engine, event, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator[datetime]):
    """Store timezone-aware UTC datetimes; SQLite would otherwise drop the zone."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetimes are not allowed; use UTC.")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:  # noqa: ANN001
        return None if value is None else value.replace(tzinfo=timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_db_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    connect_args = {}
    if url.get_backend_name() == "sqlite":
        connect_args["check_same_thread"] = False
        # Wait for another request's write transaction instead of failing immediately.
        connect_args["timeout"] = 30
        if url.database and url.database != ":memory:":
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, connect_args=connect_args)

    if url.get_backend_name() == "sqlite":

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
            # SQLAlchemy emits BEGIN itself. A reserved lock at BEGIN, not at the
            # first write, is what orders monitoring cutoff timestamps: the clock
            # is read only while this transaction already excludes other writers.
            dbapi_connection.isolation_level = None
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        @event.listens_for(engine, "begin")
        def _begin_immediate(conn) -> None:  # noqa: ANN001
            conn.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


def init_db(engine: Engine) -> sessionmaker[Session]:
    # Import models so their tables are registered on Base.metadata.
    from app.monitoring import models as monitoring_models  # noqa: F401
    from app.sessions import models  # noqa: F401

    Base.metadata.create_all(engine)
    _check_schema_is_current(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


class OutdatedDatabaseError(RuntimeError):
    pass


def _check_schema_is_current(engine: Engine) -> None:
    """Fail at startup if an older database is missing columns (no migrations yet)."""
    inspector = inspect(engine)
    missing = []
    for table in Base.metadata.sorted_tables:
        existing = {column["name"] for column in inspector.get_columns(table.name)}
        missing += [f"{table.name}.{c.name}" for c in table.columns if c.name not in existing]
    if missing:
        raise OutdatedDatabaseError(
            f"The database at {engine.url.render_as_string(hide_password=True)} was created by an "
            f"older backend version and is missing: {', '.join(missing)}. There are no migrations "
            "yet: stop the server, delete backend/data/vouch.db (development data only), and start again."
        )


def get_db(request: Request) -> Iterator[Session]:
    db: Session = request.app.state.db_sessionmaker()
    try:
        yield db
    finally:
        db.close()
