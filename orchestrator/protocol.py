"""
Agent communication protocol
Phase 2 + Phase 4D.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict


# AgentResult

class AgentResult(TypedDict):
    agent_name: str               
    tool: str                     
    tool_input: Dict[str, Any]    
    tool_result: Dict[str, Any]   
    success: bool                 
    confidence: float             
    reasoning: str                
    retry_count: int              
    needs_escalation: bool        
    escalation_reason: Optional[str]
    wave: int                     


# AgentMessage

class AgentMessageType(str, Enum):
    TASK_DISPATCH          = "task_dispatch"       # go run this
    RESULT_REPORT          = "result_report"       # here's what I found
    ESCALATION             = "escalation"          # this needs attention
    RETRY_REQUEST          = "retry_request"       # retrying with new input
    WAVE_COMPLETE          = "wave_complete"       # wave N done, merging
    MEMORY_READ            = "memory_read"         # reading history
    MEMORY_WRITE           = "memory_write"        # persisting outcome
    REPEAT_ESCALATION      = "repeat_escalation"   # 3B auto-escalation fired


def make_message(
    sender: str,
    recipient: str,
    message_type: AgentMessageType,
    payload: Dict[str, Any],
    confidence: float = 1.0,
    reasoning: str = "",
) -> Dict[str, Any]:
    # Create a serialisable agent message dict.
    return {
        "sender":       sender,
        "recipient":    recipient,
        "message_type": message_type.value,
        "payload":      payload,
        "confidence":   round(confidence, 4),
        "reasoning":    reasoning,
        "timestamp":    datetime.now(timezone.utc).isoformat(),
    }
