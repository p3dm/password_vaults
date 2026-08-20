"""
Controller xử lý ghi/đọc error_logs.

Dùng ORM thông qua get_session() / transaction() từ app.db.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select

from app.db import get_session, transaction
from app.models import ErrorLog, InforLog


class Log_Record:
    """CRUD helper for table error_logs."""
    @staticmethod
    def log_error(event_type: str, message: str, object_id: str) -> str:
        """
        Log a new error record to DB.

        Args:
            event_type: Event type, vd: 'auth_failed', 'db_error'.
            message:    Message.
            object_id:  UUID of object.

        Returns:
            String: id (UUID string) of created error record.
        """
        new_id = str(uuid.uuid4())
        with transaction() as session:
            log = ErrorLog(
                id=new_id,
                event_type=event_type,
                object_id=object_id,
                message=message,
            )
            session.add(log)
        return f"Error logged: {new_id}"

    @staticmethod
    def get_by_id(log_id: str) -> Optional[ErrorLog]:
        """Collect log by id. Return None if not found."""
        with get_session() as session:
            return session.get(ErrorLog, log_id)

    @staticmethod
    def list_by_event(event_type: str, limit: int = 50) -> list[ErrorLog]:
        """Collect list of newest logs by event type"""
        with get_session() as session:
            stmt = (
                select(ErrorLog)
                .where(ErrorLog.event_type == event_type)
                .order_by(ErrorLog.created_at.desc())
                .limit(limit)
            )
            return session.scalars(stmt).all()

    @staticmethod
    def list_by_object(object_id: str, limit: int = 50) -> list[ErrorLog]:
        """Collect list of newest logs by object id"""
        with get_session() as session:
            stmt = (
                select(ErrorLog)
                .where(ErrorLog.object_id == object_id)
                .order_by(ErrorLog.created_at.desc())
                .limit(limit)
            )
            return session.scalars(stmt).all()

    @staticmethod
    def delete(log_id: str) -> bool:
        """Xoá một record. Trả True nếu xoá thành công, False nếu không tìm thấy."""
        with transaction() as session:
            log = session.get(ErrorLog, log_id)
            if log is None:
                return False
            session.delete(log)
        return True

    @staticmethod
    def log_infor(event_type: str, message: str, object_id: str) -> str:
        new_id = str(uuid.uuid4())
        with transaction() as session:
            log = InforLog(
                id=new_id,
                event_type=event_type,
                object_id=object_id,
                message=message,
            )
            session.add(log)
        return f"Error logged: {new_id}"