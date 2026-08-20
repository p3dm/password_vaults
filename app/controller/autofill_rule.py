"""
Controller xử lý CRUD cho bảng autofill_rules.

Dùng ORM thông qua get_session() / transaction() từ app.db.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy import select, and_

from app.db import get_session, transaction
from app.models import AutofillRule, Credential
from app.controller.validator import validate_rule_input
from app.controller.log import Log_Record as log


def add_autofill_rule(credentialId: str, rule: dict) -> str:
    ruleId = str(uuid.uuid4())
    rule = {"id": ruleId, **rule}
    validated = validate_rule_input(rule)

    try:
        with transaction() as session:
            newRule = AutofillRule(
                id=validated["id"],
                credential_id=credentialId,
                match_type=validated["match_type"],
                match_value=validated["match_value"],
                priority=validated.get("priority", 0),
                is_enabled=validated.get("is_enabled", True),
            )
            session.add(newRule)
        log.log_infor(
            event_type="add_autofill_rule",
            message=f"add_autofill_rule success: {ruleId}",
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


def update_autofill_rule(ruleId: str, rule: dict) -> str:
    try:
        with transaction() as session:
            targetRule = session.get(AutofillRule, ruleId)
            if not targetRule:
                raise ValueError(f"Không tìm thấy autofill rule: {ruleId}")
            validated = validate_rule_input(rule)
            targetRule.match_type = validated["match_type"]
            targetRule.match_value = validated["match_value"]
            targetRule.priority = validated.get("priority", 0)
            targetRule.is_enabled = validated.get("is_enabled", True)
        log.log_infor(
            event_type="update_autofill_rule",
            message=f"update_autofill_rule success: {ruleId}",
            object_id=ruleId,
        )
    except ValueError:
        raise
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"update_autofill_rule failed: {e}",
            object_id=ruleId,
        )
        raise
    return "Update successfully"


def delete_autofill_rule(ruleId: str) -> str:
    """Xóa một autofill rule theo ID."""
    try:
        with transaction() as session:
            targetRule = session.get(AutofillRule, ruleId)
            if not targetRule:
                raise ValueError(f"Không tìm thấy autofill rule: {ruleId}")
            session.delete(targetRule)
        log.log_infor(
            event_type="delete_autofill_rule",
            message=f"delete_autofill_rule success: {ruleId}",
            object_id=ruleId,
        )
    except ValueError:
        raise
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"delete_autofill_rule failed: {e}",
            object_id=ruleId,
        )
        raise
    return f"Delete successfully: {ruleId}"


@dataclass
class CandidateResult:
    credential_id: str
    title: str
    username: str
    priority: int
    favorite: bool


def find_candidates(match_type: str, match_value: str) -> list[CandidateResult]:
    """
    Tìm credential phù hợp với match_type + match_value.

    Trả danh sách CandidateResult (không chứa password).
    Dùng SQLAlchemy and_() thay vì Python `and` để tạo đúng SQL WHERE clause.
    """
    try:
        with get_session() as session:
            stmt = (
                select(
                    Credential.id,
                    Credential.title,
                    Credential.username,
                    Credential.favorite,
                    Credential.last_used_at,
                    AutofillRule.priority,
                )
                .join(AutofillRule, Credential.id == AutofillRule.credential_id)
                .where(
                    and_(
                        AutofillRule.match_type == match_type,
                        AutofillRule.match_value == match_value,
                        AutofillRule.is_enabled == True,
                    )
                )
                .order_by(AutofillRule.priority.desc())
            )
            results = session.execute(stmt).all()
    except Exception as e:
        log.log_error(
            event_type="db_error",
            message=f"find_candidates failed: {e}",
            object_id="N/A",
        )
        raise
    return [
        CandidateResult(
            credential_id=row.id,
            title=row.title,
            username=row.username,
            favorite=row.favorite,
            priority=row.priority,
        )
        for row in results
    ]