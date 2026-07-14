"""
Agent tools for the AI Cargo Monitoring orchestration layer.

Each tool is a LangChain StructuredTool with a Pydantic input schema.
The orchestrator imports `ALL_TOOLS` and registers them in a ToolNode.

Current implementations return realistic mock responses.  Swap the
`_execute` body for real integrations when external APIs are available.

Phase 3C: each tool module now calls REGISTRY.register() at import time,
so REGISTRY is fully populated after this __init__ runs.  Use REGISTRY
for context-aware tool discovery; use TOOL_MAP for direct name lookups.
"""

from tools.route_agent import route_tool
from tools.cold_storage_agent import cold_storage_tool
from tools.notification_agent import notification_tool
from tools.compliance_agent import compliance_tool
from tools.scheduling_agent import scheduling_tool
from tools.insurance_agent import insurance_tool
from tools.triage_agent import triage_tool
from tools.approval_workflow import approval_tool

# Phase 3C — the REGISTRY singleton is populated by each tool's module-level
# REGISTRY.register() call above.  Import it here for convenience.
from tools.registry import REGISTRY  # noqa: E402

ALL_TOOLS = [
    route_tool,
    cold_storage_tool,
    notification_tool,
    compliance_tool,
    scheduling_tool,
    insurance_tool,
    triage_tool,
    approval_tool,
]

TOOL_MAP = {t.name: t for t in ALL_TOOLS}
