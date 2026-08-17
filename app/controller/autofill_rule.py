

from __future__ import annotations
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from app.db import get_session, transaction
from app.models import Credential
from controller.validator import validate_credential
from controller.log_error import Log_Record as log


def add_autofill_rule(credentialId: str, rule: dict) -> str:
    ruleId = str(uuid.uuid4())
    rule = {"id":ruleId, **rule}
    validated = validate_rule_input(rule)
    
    try:
        with transaction() as session:
           newRule = AutoFillRule(
                id=validated["id"],
                credential_id=credentialId,
                match_type=validated["match_type"],
                match_value=validated["match_value"],
                priority=validated["priority"],
                is_enabled=validated["is_enabled"],
           )
        session.add(newRule)
        log.log_infor(
            event_type="add_autofill_rule",
            message=f"add_autofill_rule success: {newRule}",
            object_id=credentialId,
        )
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"add_autofill_rule failed: {e}",
            object_id=credentialId,
        )
        raise
    return ruleId

