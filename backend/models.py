"""
Shared Pydantic models used by the FastAPI backend, risk engine, and the orchestrator.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# Enums

class RiskTier(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TransitPhase(str, Enum):
    loading_zone = "loading_zone"
    road_transit = "road_transit"
    sea_transit = "sea_transit"
    air_handoff = "air_handoff"
    customs_clearance = "customs_clearance"
    cold_store_transfer = "cold_store_transfer"
    last_mile = "last_mile"


# Risk engine output (-> orchestrator input)

class KeyDriver(BaseModel):
    feature: str
    shap_value: float


class RiskEngineOutput(BaseModel):
    # The payload the risk engine produces and the orchestrator consumes.
    # Matches the 'INPUT YOU WILL RECEIVE' section of system_prompt.md.

    shipment_id: str
    container_id: str
    window_id: str
    leg_id: str
    product_type: str
    transit_phase: str
    risk_tier: RiskTier
    fused_risk_score: float = Field(ge=0.0, le=1.0)
    ml_spoilage_probability: float = Field(ge=0.0, le=1.0)
    deterministic_rule_flags: List[str]
    key_drivers: List[KeyDriver]
    recommended_actions_from_risk_engine: List[str]
    confidence_score: float = Field(ge=0.0, le=1.0)
    operational_constraints: List[str] = Field(default_factory=list)
    available_tools: List[str] = Field(default_factory=list)


# Orchestrator output

class PlanStep(BaseModel):
    step: int
    action: str
    reason: str


class ToolAction(BaseModel):
    tool: str
    input: Dict[str, Any]
    result: Dict[str, Any]


class OrchestratorDecision(BaseModel):
    # The output the orchestrator produces. Matches the OUTPUT FORMAT
    # section of system_prompt.md.

    shipment_id: str
    container_id: str
    window_id: str
    leg_id: str
    risk_tier: RiskTier
    fused_risk_score: float
    ml_spoilage_probability: float
    decision_summary: str
    key_drivers: List[str]
    draft_plan: List[PlanStep]
    reflection_notes: List[str]
    revised_plan: List[PlanStep]
    actions_taken: List[ToolAction]
    fallback_plan: List[PlanStep]
    requires_approval: bool
    approval_reason: Optional[str] = None
    audit_log_summary: str
    confidence: float = Field(ge=0.0, le=1.0)


# API response models

class ShipmentSummary(BaseModel):
    shipment_id: str
    containers: List[str]
    products: List[str]
    total_windows: int
    latest_risk_tier: RiskTier
    max_fused_score: float
    pct_critical: float
    pct_high: float
    value_at_risk_usd: float = 0.0


class WindowRisk(BaseModel):
    window_id: str
    shipment_id: str
    container_id: str
    product_id: str
    leg_id: str
    window_start: str
    window_end: str
    transit_phase: str
    avg_temp_c: float
    escalated: bool = False
    det_score: Optional[float] = None
    ml_score: Optional[float] = None
    final_score: Optional[float] = None
    risk_tier: Optional[RiskTier] = None
    det_rules_fired: str = ""
    recommended_actions: str = ""
    requires_human_approval: bool = False


class RiskOverview(BaseModel):
    total_windows: int
    total_shipments: int
    escalated_shipments: int = 0
    monitored_shipments: int = 0
    total_value_at_risk_usd: float = 0.0
    tier_counts: Dict[str, int]
    tier_pcts: Dict[str, float]
    top_risky_shipments: List[ShipmentSummary]


class AuditRecord(BaseModel):
    assessment_timestamp: str
    window_id: str
    shipment_id: str
    container_id: str
    product_id: str
    deterministic_score: Optional[float]
    ml_score: Optional[float]
    final_score: Optional[float]
    risk_tier: str
    deterministic_rules_fired: List[str]
    ml_top_features: List[Dict[str, Any]]
    recommended_actions: List[str]
    requires_human_approval: bool


class ApprovalRequest(BaseModel):
    approval_id: str
    shipment_id: str
    window_id: Optional[str] = None
    container_id: Optional[str] = None
    action_description: str
    risk_tier: str
    urgency: str
    proposed_actions: List[str]
    justification: str
    requested_by: Optional[str] = None
    status: str
    created_at: str
    decided_at: Optional[str] = None
    decided_by: Optional[str] = None
    decision: Optional[str] = None


class ApprovalDecision(BaseModel):
    decision: str = Field(description="approved or rejected")
    decided_by: str = Field(default="operator")
