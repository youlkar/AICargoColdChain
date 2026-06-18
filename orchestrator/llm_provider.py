# Multi-provider LLM abstraction. Order: groq, ollama, openai, anthropic.
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

_cached_provider: Optional[str] = None
_cached_llm = None


def _get_tracer_callbacks() -> list:
    tracing = (
        os.environ.get("LANGSMITH_TRACING", "")
        or os.environ.get("LANGCHAIN_TRACING_V2", "")
    ).lower()
    if tracing != "true":
        return []
    api_key = (
        os.environ.get("LANGSMITH_API_KEY")
        or os.environ.get("LANGCHAIN_API_KEY")
    )
    project = (
        os.environ.get("LANGSMITH_PROJECT")
        or os.environ.get("LANGCHAIN_PROJECT", "default")
    )
    if not api_key:
        return []
    try:
        from langchain_core.tracers import LangChainTracer
        tracer = LangChainTracer(project_name=project)
        return [tracer]
    except Exception as e:
        logger.debug("LangSmith tracer init failed: %s", e)
        return []


def _try_groq():
    key = os.environ.get("GROQ_API_KEY", "")
    if not key or key == "your-key-here":
        return None
    model = os.environ.get("CARGO_GROQ_MODEL", "llama-3.3-70b-versatile")
    try:
        from langchain_groq import ChatGroq
        llm = ChatGroq(
            model=model,
            temperature=0.1,
            max_tokens=1024,
            api_key=key,
            callbacks=_get_tracer_callbacks(),
        )
        logger.info("LLM provider: Groq (%s)", model)
        return llm
    except Exception as e:
        logger.warning("Groq init failed: %s", e)
        return None


def _try_ollama():
    model = os.environ.get("CARGO_OLLAMA_MODEL", "qwen2.5:7b")
    try:
        import httpx
        r = httpx.get("http://localhost:11434/api/tags", timeout=2.0)
        if r.status_code != 200:
            return None
    except Exception:
        return None
    from langchain_ollama import ChatOllama
    logger.info("LLM provider: Ollama (%s)", model)
    return ChatOllama(model=model, temperature=0.1, num_predict=1024)


def _try_openai():
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key or key == "your-key-here":
        return None
    model = os.environ.get("CARGO_OPENAI_MODEL", "gpt-4o-mini")
    try:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model=model, temperature=0.1, max_tokens=1024, api_key=key)
        logger.info("LLM provider: OpenAI (%s)", model)
        return llm
    except Exception as e:
        logger.warning("OpenAI init failed: %s", e)
        return None


def _try_anthropic():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key or key == "your-key-here":
        return None
    model = os.environ.get("CARGO_ANTHROPIC_MODEL", "claude-3-5-haiku-latest")
    try:
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model=model, temperature=0.1, max_tokens=1024, api_key=key)
        logger.info("LLM provider: Anthropic (%s)", model)
        return llm
    except Exception as e:
        logger.warning("Anthropic init failed: %s", e)
        return None


_PROVIDERS = {
    "groq": _try_groq,
    "ollama": _try_ollama,
    "openai": _try_openai,
    "anthropic": _try_anthropic,
}


def get_llm(force_refresh: bool = False):
    # Return the best available LLM, trying providers in priority order.
    global _cached_provider, _cached_llm

    if os.environ.get("CARGO_LLM_ENABLED", "1") == "0":
        _cached_llm = None
        _cached_provider = None
        return None

    if _cached_llm is not None and not force_refresh:
        return _cached_llm

    priority = os.environ.get("CARGO_LLM_PRIORITY", "groq").split(",")

    for name in priority:
        name = name.strip().lower()
        factory = _PROVIDERS.get(name)
        if factory is None:
            logger.debug("Unknown LLM provider '%s' in priority list, skipping", name)
            continue
        llm = factory()
        if llm is not None:
            _cached_provider = name
            _cached_llm = llm
            return llm

    _cached_llm = None
    _cached_provider = None
    logger.info("No LLM provider available; falling back to deterministic")
    return None


def get_provider_name() -> str:
    # Return the active provider name, or 'deterministic'.
    if _cached_provider:
        return _cached_provider
    if get_llm() is not None:
        return _cached_provider or "unknown"
    return "deterministic"


_DEFAULT_MODEL_PRICING = {
    "groq:llama-3.3-70b-versatile":   {"input": 0.59, "output": 0.79},
    "groq:llama-3.1-8b-instant":      {"input": 0.05, "output": 0.08},
    "ollama:qwen2.5:7b":              {"input": 0.0,  "output": 0.0},
    "openai:gpt-4o-mini":             {"input": 0.15, "output": 0.60},
    "openai:gpt-4o":                  {"input": 2.50, "output": 10.0},
    "anthropic:claude-3-5-haiku-latest": {"input": 0.80, "output": 4.0},
    "anthropic:claude-3-5-sonnet-latest": {"input": 3.0, "output": 15.0},
}


def _load_model_pricing() -> dict:
    # Load model pricing from CARGO_MODEL_PRICING env var (JSON) or defaults.
    raw = os.environ.get("CARGO_MODEL_PRICING", "")
    if raw:
        try:
            import json
            return json.loads(raw)
        except Exception:
            logger.warning("CARGO_MODEL_PRICING is not valid JSON; using defaults")
    return _DEFAULT_MODEL_PRICING


CARGO_MODEL_PRICING = _load_model_pricing()


def track_usage(node_name: str, response) -> dict:
    # Extract token usage from `response.usage_metadata` and compute cost.
    try:
        meta = getattr(response, "usage_metadata", None) or {}
        input_tokens = int(meta.get("input_tokens", 0) or meta.get("prompt_tokens", 0))
        output_tokens = int(meta.get("output_tokens", 0) or meta.get("completion_tokens", 0))
        total_tokens = input_tokens + output_tokens

        provider = get_provider_name()
        model = get_model_name()
        key = f"{provider}:{model}"
        pricing = CARGO_MODEL_PRICING.get(key, {"input": 0.0, "output": 0.0})
        cost_usd = (
            input_tokens * pricing["input"] / 1_000_000
            + output_tokens * pricing["output"] / 1_000_000
        )
        return {node_name: {"tokens": total_tokens, "cost_usd": round(cost_usd, 8)}}
    except Exception as exc:
        logger.debug("track_usage failed (non-fatal): %s", exc)
        return {node_name: {"tokens": 0, "cost_usd": 0.0}}


def get_model_name() -> str:
    provider = get_provider_name()
    if provider == "groq":
        return os.environ.get("CARGO_GROQ_MODEL", "llama-3.3-70b-versatile")
    if provider == "ollama":
        return os.environ.get("CARGO_OLLAMA_MODEL", "qwen2.5:7b")
    if provider == "openai":
        return os.environ.get("CARGO_OPENAI_MODEL", "gpt-4o-mini")
    if provider == "anthropic":
        return os.environ.get("CARGO_ANTHROPIC_MODEL", "claude-3-5-haiku-latest")
    return "none"
