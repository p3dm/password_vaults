"""
Controller xử lý CRUD cho bảng credentials.

Dùng ORM thông qua get_session() / transaction() từ app.db.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy import select

from app.db import get_session, transaction
from app.models import AutofillRule, Credential, PasswordHistory
from app.controller.validator import validate_credential, validate_rule_input
from app.controller.log import Log_Record as log


@dataclass
class CredentialRecord:
    id: str
    title: str
    platform_type: str
    platform_identifier: str | None
    username: str
    password: str
    totp_secret: str | None
    notes: str | None
    url: str | None
    tags: list[str]
    favorite: bool
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None


def insert_credential(data: dict) -> str:
    """
    Thêm một credential mới vào database.

    Args:
        data: dict chứa các trường của credential, gồm:
              title, platform_type, username, password,
              và các trường tuỳ chọn: platform_identifier,
              totp_secret, notes, url, tags, favorite.

    Returns:
        str: id (UUID string) của credential vừa được tạo.

    Raises:
        ValidationError: Nếu dữ liệu đầu vào không hợp lệ.
        Exception:       Nếu có lỗi khi ghi vào database (đã rollback).
    """
    # Gán id mới trước khi validate để log_error có thể ghi object_id
    newId = str(uuid.uuid4())
    data = {"id": new_id, **data}

    # Validate và chuẩn hoá dữ liệu đầu vào
    validated = validate_credential(data)

    try:
        with transaction() as session:
            credential = Credential(
                id=newId,
                title=validated["title"],
                platform_type=validated["platform_type"],
                platform_identifier=validated.get("platform_identifier"),
                username=validated["username"],
                password=validated["password"],
                totp_secret=validated.get("totp_secret"),
                notes=validated.get("notes"),
                url=validated.get("url"),
                tags=validated.get("tags", []),
                favorite=bool(validated.get("favorite", False)),
            )
            session.add(credential)
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"insert_credential failed: {exc}",
            object_id=new_id,
        )
        raise
    return new_id

def update_credential_metadata(credentialId: str, data: dict)  -> str:
    validated = validate_credential({**data, "id": credentialId})
    try:
        with transaction() as session:
            credential = session.get(Credential, credentialId)
            if not credential:
                raise ValueError(f"Không tìm thấy credential với id: {credentialId}")
            
            credential.title = validated["title"]
            credential.platform_type = validated["platform_type"]
            credential.platform_identifier = validated.get("platform_identifier")
            credential.username = validated["username"]
            credential.totp_secret = validated.get("totp_secret")
            credential.notes = validated.get("notes")
            credential.url = validated.get("url")
            credential.tags = validated.get("tags", [])
            credential.favorite = bool(validated.get("favorite", False))

    except ValueError:
        raise
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"update_credential failed: {exc}",
            object_id=credential_id,
        )
        raise
    return f"Update successfully: {credentialId}"

def update_credential_password(credentialId: str, new_password: str) -> str:
    """
    Đổi password.
    Trigger trg_credentials_password_history sẽ tự động lưu
    password CŨ vào bảng password_history trước khi UPDATE.
    """
    if not new_password or not new_password.strip():
        raise ValueError("new_password không được rỗng")
    try:
        with transaction() as session:
            credential = session.get(Credential, credentialId)
            if not credential:
                raise ValueError(f"Không tìm thấy credential: {credentialId}")
            # Gán password mới → SQLAlchemy UPDATE → trigger tự chạy
            credential.password = new_password
    except ValueError:
        raise
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"update_credential_password failed: {exc}",
            object_id=credentialId,
        )
        raise
    return f"Password updated: {credentialId}"

def read_one_credential(credentialId: str) -> dict:
    try:
        with transaction() as session:
            results = session.scalars(
                select(Credential).where(Credential.id == credentialId)
            ).first()
            if not results:
                raise ValueError(f"Không tìm thấy credential với id: {credentialId}")
    except ValueError:
        raise
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"read_one_credential failed: {exc}",
            object_id=credentialId,
        )
        raise
    
    return results

class CredentailQuery:
    id: str
    platform_type: str | None
    platform_identifier: str | None
    username: str 
    password: str
    notes: str
    url: str | None
    created_at: datetime
    

def read_all_credential() -> list[CredentailQuery]:
    try:
        with get_session() as session:
            results = session.scalars(
                select(Credential)
                .order_by(Credential.created_at.desc())
            ).all()
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"read_all_credential failed: {exc}",
        )
        raise

    return [ CredentailQuery(
        id = result.id,
        platform_type = result.platform_type,
        platform_identifier = result.platform_identifier,
        username = result.username,
        password = result.password,
        notes = result.notes,
        url = result.url,
        created_at = result.created_at,
        )for result in results
    ]

def delete_credential(credentialId : str) -> str:
    try:
        with transaction() as session:
            targetCredential = session.get(Credential, credentialId)
            if not targetCredential:
                raise ValueError(f"Không tìm thấy credential với id: {credentialId}")
            session.delete(targetCredential)

    except ValueError:
        raise
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"delete_credential failed: {exc}",
            object_id=credentialId,
        )
        raise
    return f"Delete successfully: {credentialId}"

def list_password_history(credentialId: str) -> list[PasswordHistory]:
    """Xem lịch sử password cũ của 1 credential, mới nhất trước."""
    try:
        with get_session() as session:
            return session.scalars(
                select(PasswordHistory)
                .where(PasswordHistory.credential_id == credentialId)
                .order_by(PasswordHistory.changed_at.desc())
            ).all()
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"list_password_history failed: {exc}",
            object_id=credentialId,
        )
        raise


def create_credential_with_rules(data: dict, rules: list[dict]) -> str:
    """Tạo credential + rules trong 1 transaction duy nhất."""
    newId = str(uuid.uuid4())
    validated = validate_credential({"id": newId, **data})
    try:
        with transaction() as session:
            credential = Credential(
                id=newId,
                title=validated["title"],
                platform_type=validated["platform_type"],
                platform_identifier=validated.get("platform_identifier"),
                username=validated["username"],
                password=validated["password"],
                totp_secret=validated.get("totp_secret"),
                notes=validated.get("notes"),
                url=validated.get("url"),
                tags=validated.get("tags", []),
                favorite=bool(validated.get("favorite", False)),
            )
            session.add(credential)
            for rule in rules:
                validated_rule = validate_rule_input({**rule, "id": str(uuid.uuid4())})
                session.add(AutofillRule(
                    credential_id=newId,
                    **validated_rule,
                    is_enabled=True
                ))
            log.infor(
                event_type = "create credential with rule",
                message = f"create_credential_with_rules success: {credential.title}",
                object_id = newId
            )
    except Exception as exc:
        log.log_error(
            event_type="db_error",
            message=f"create_credential_with_rules failed: {exc}",
            object_id=newId,
        )
        raise
    return newId    