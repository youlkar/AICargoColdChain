
# LangGraph checkpointer Postgres in production, MemorySaver in development.


from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_checkpointer = None


def get_checkpointer():
    # Return the singleton checkpointer.
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer

    db_url = os.environ.get("SUPABASE_DB_URL")

    if db_url:
        try:
            from langgraph.checkpoint.postgres import PostgresSaver
            _checkpointer = PostgresSaver.from_conn_string(db_url)
            _checkpointer.setup()
            logger.info("Checkpointer: PostgresSaver (Supabase) — HITL pauses survive restarts.")
        except Exception as exc:
            logger.warning("PostgresSaver init failed (%s), falling back to MemorySaver.", exc)
            _checkpointer = _make_memory_saver()
    else:
        _checkpointer = _make_memory_saver()

    return _checkpointer


def _make_memory_saver():
    from langgraph.checkpoint.memory import MemorySaver
    logger.info("Checkpointer: MemorySaver (in-process). Set SUPABASE_DB_URL for production.")
    return MemorySaver()
