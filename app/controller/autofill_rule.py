

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
    return f"Successfully add autofill rule: {ruleId}"

def list_autofill_rules(credentialId: str) -> list[AutofillRule]:
    try:
        with get_session() as session:
            results = session.scalars(
                select(AutofillRule)
                .where(AutofillRule.credential_id == credentialId)
            ).all()
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"list_autofill_rules failed: {e}",
            object_id=credentialId,
        )
        raise
    return results

def upadte_autofill_rule(ruleId: str, rule: dict) -> str:
    try:
        with transaction() as session:
            targetRule = session.get(AutofillRule, ruleId)
            validated = validate_rule_input(rule)
            targetRule.match_type = validated["match_type"]
            targetRule.match_value = validated["match_value"]
            targetRule.priority = validated["priority"]
            targetRule.is_enabled = validated["is_enabled"]
        log.log_infor(
            event_type="update_autofill_rule",
            message=f"update_autofill_rule success: {targetRule}",
            object_id=ruleId,
        )
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"update_autofill_rule failed: {e}",
            object_id=ruleId,
        )
        raise
    return "Update successfully"

@dataclass
class CandidateResult:
    credential_id: str 
    title: str 
    username: str 
    priority: int 
    favorite: bool 

def find_candidates(match_type: str, match_value: str) -> list[dict]:
    try:
        with get_session() as session:
            results = session.scalars(
                select(Credential.id,
                    Credential.title,  
                    Credential.username,
                    Credential.favorite,
                    Credential.last_used_at,
                    AutofillRule.priority
                )
                .join(AutofillRule, Credential.id == AutofillRule.credential_id)
                .where(AutofillRule.match_type == match_type and AutofillRule.match_value == match_value and AutofillRule.is_enabled == True)
                .order_by(AutofillRule.priority.desc())
            ).all()
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"find_candidates failed: {e}",
            object_id="N/A"
        )
        raise
    return [CandidateResult(
        credential_id=result.id,
        title=result.title,
        username=result.username,
        favorite=result.favorite,
        priority=result.priority,
    )for result in results]