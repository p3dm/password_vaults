"""
Credential Service — lớp nghiệp vụ trung tâm.

Trách nhiệm:
- Cung cấp autofill payload (username/password) chỉ khi user đã chọn credential.
- Delegate tìm candidate tới autofill_matcher.
- Cập nhật last_used_at khi credential được dùng để autofill.
- Không log password, không cache payload dài hạn.
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select

from app.db import get_session, transaction
from app.models import Credential
from app.exceptions import CredentialNotFoundError
from app.autofill_matcher import AutofillContext, find_candidates as matcher_find
from app.controller.log import Log_Record as log

logger = logging.getLogger(__name__)


class CredentialService:
    """Thin service layer cho autofill workflow."""

    @staticmethod
    def find_autofill_candidates(context: AutofillContext) -> list:
        """
        Tìm candidate phù hợp với context (domain/process/window).

        Delegate hoàn toàn tới autofill_matcher.
        Kết quả không chứa password.
        """
        return matcher_find(context)

    @staticmethod
    def get_autofill_payload(credential_id: str) -> dict:
        """
        Lấy username + password của credential đã được user chọn.

        Luồng:
        1. SELECT credential theo ID (include password).
        2. Nếu không tồn tại → raise CredentialNotFoundError.
        3. Cập nhật last_used_at.
        4. Trả payload dict {username, password} — KHÔNG trả notes/history.
        5. Không log payload.
        """
        try:
            with transaction() as session:
                credential = session.get(Credential, credential_id)
                if not credential:
                    raise CredentialNotFoundError(
                        f"Không tìm thấy credential: {credential_id}"
                    )

                # Lấy payload trước khi session đóng
                payload = {
                    "username": credential.username,
                    "password": credential.password,
                }

                # Cập nhật last_used_at
                credential.last_used_at = datetime.now()

            log.log_infor(
                event_type="AUTOFILL_COMPLETED",
                message=f"Autofill payload retrieved for credential: {credential_id}",
                object_id=credential_id,
            )

            return payload

        except CredentialNotFoundError:
            raise
        except Exception as exc:
            log.log_error(
                event_type="db_error",
                message=f"get_autofill_payload failed: {exc}",
                object_id=credential_id,
            )
            raise
