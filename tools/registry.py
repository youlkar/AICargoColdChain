"""
Dynamic tool registry
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ToolMetadata:
    name: str
    wave: int                        = 1
    category: str                    = "general"
    applicable_tiers: List[str]      = field(default_factory=lambda: ["*"])
    applicable_phases: List[str]     = field(default_factory=lambda: ["*"])
    applicable_products: List[str]   = field(default_factory=lambda: ["*"])
    always_deferred: bool            = False
    description: str                 = ""


class ToolRegistry:
    # Central registry for all orchestrator tools.

    def __init__(self):
        self._tools: Dict[str, Any]          = {}   # name → StructuredTool
        self._meta:  Dict[str, ToolMetadata] = {}   # name → ToolMetadata

    # Registration

    def register(self, tool: Any, meta: ToolMetadata) -> None:
        self._tools[meta.name] = tool
        self._meta[meta.name]  = meta
        logger.debug("REGISTRY  registered tool=%s wave=%d category=%s",
                     meta.name, meta.wave, meta.category)

    # Query

    def query(
        self,
        tier: str            = "*",
        phase: str           = "*",
        product_type: str    = "*",
        wave: Optional[int]  = None,
        include_deferred: bool = False,
    ) -> List[Any]:
        # Return tools whose metadata matches the given runtime context.

        matched = []
        for name, meta in self._meta.items():
            if not include_deferred and meta.always_deferred:
                continue
            if wave is not None and meta.wave != wave:
                continue
            if not _matches(tier, meta.applicable_tiers):
                continue
            if not _matches(phase, meta.applicable_phases):
                continue
            if not _matches(product_type, meta.applicable_products):
                continue
            matched.append(self._tools[name])

        logger.debug("REGISTRY  query tier=%s phase=%s wave=%s → %d tools",
                     tier, phase, wave, len(matched))
        return matched

    def query_names(self, **kwargs) -> List[str]:
        # Same as query() but returns names instead of tool objects.
        return [t.name for t in self.query(**kwargs)]

    def get(self, name: str) -> Optional[Any]:
        return self._tools.get(name)

    def get_meta(self, name: str) -> Optional[ToolMetadata]:
        return self._meta.get(name)

    def tool_map(self) -> Dict[str, Any]:
        # Return a {name: tool} dict — drop-in replacement for TOOL_MAP.
        return dict(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def __len__(self) -> int:
        return len(self._tools)


# Singleton

REGISTRY = ToolRegistry()


#  Matching helper

def _matches(value: str, allowed: List[str]) -> bool:
    # True if value matches the allowed list (which may contain "*").
    if "*" in allowed:
        return True
    if not value or value == "*":
        return True   # caller passed wildcard — always match
    return value in allowed
