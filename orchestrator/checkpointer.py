
# LangGraph checkpointer Postgres in production, MemorySaver in development.
#
# Async: the orchestrator runs via app.ainvoke() (see graph.py), which
# requires a checkpointer implementing the *async* BaseCheckpointSaver
# interface (aget_tuple/aput/...). The sync PostgresSaver's async methods
# raise NotImplementedError, so this must be AsyncPostgresSaver bound to a
# real psycopg AsyncConnection — not the sync PostgresSaver.

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_checkpointer = None
_checkpointer_conn = None  # kept alive for the process lifetime; closing it drops the connection


async def get_checkpointer():
    # Return the singleton async checkpointer.
    global _checkpointer, _checkpointer_conn
    if _checkpointer is not None:
        return _checkpointer

    db_url = os.environ.get("SUPABASE_DB_URL")

    if db_url:
        try:
            import psycopg
            from psycopg.rows import dict_row
            from psycopg import AsyncConnection
            from langgraph.checkpoint.postgres import PostgresSaver
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            # Schema migration (setup()) only exists on the sync saver;
            # run it once via a short-lived sync connection, then use a
            # separate async connection for actual request traffic.
            with psycopg.connect(
                db_url, autocommit=True, prepare_threshold=None, row_factory=dict_row
            ) as setup_conn:
                PostgresSaver(setup_conn).setup()

            # prepare_threshold=None: Supabase's transaction-mode pooler
            # (pgbouncer) doesn't preserve server-side prepared statements
            # across pooled connections, so psycopg's auto-prepare must be
            # fully disabled or requests intermittently fail with
            # 'prepared statement "_pg3_N" already exists'.
            _checkpointer_conn = await AsyncConnection.connect(
                db_url, autocommit=True, prepare_threshold=None, row_factory=dict_row
            )
            _checkpointer = AsyncPostgresSaver(_checkpointer_conn)
            logger.info("Checkpointer: AsyncPostgresSaver (Supabase) — HITL pauses survive restarts.")
        except Exception as exc:
            # print() as well as logger.warning(): in some deployment
            # environments a telemetry SDK (e.g. Azure Monitor) attaches its
            # own root logging handler before this module is imported, which
            # makes logging.basicConfig() a no-op and silently swallows this
            # warning. print() always reaches stdout regardless.
            print(f"[checkpointer] AsyncPostgresSaver init failed ({exc!r}), falling back to MemorySaver.", flush=True)
            logger.warning("AsyncPostgresSaver init failed (%s), falling back to MemorySaver.", exc)
            get_checkpointer._last_error = repr(exc)
            _checkpointer = _make_memory_saver()
    else:
        _checkpointer = _make_memory_saver()

    return _checkpointer


def _make_memory_saver():
    from langgraph.checkpoint.memory import MemorySaver
    logger.info("Checkpointer: MemorySaver (in-process). Set SUPABASE_DB_URL for production.")
    return MemorySaver()
