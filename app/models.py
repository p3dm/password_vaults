"""
SQLAlchemy ORM models cho Credential Store (plaintext).

Bảng:
- credentials:       username/password/totp_secret/notes ở plaintext
- autofill_rules:    rules để match target app/browser
- password_history:  lịch sử password cũ (tùy chọn, tự thêm qua trigger)
"""

from sqlalchemy import (
    JSON,
    CHAR,
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── credentials ───────────────────────────────────────────────
class Credential(Base):
    """
    Bảng chính lưu thông tin đăng nhập.

    username và password đều ở dạng plaintext.
    """

    __tablename__ = "credentials"

    id = Column(CHAR(36), primary_key=True)
    title = Column(String(255), nullable=False)
    platform_type = Column(
        Enum("web", "desktop_app", "android_app", "other", name="platform_type_enum"),
        nullable=False,
    )
    platform_identifier = Column(String(512), nullable=True)

    username = Column(String(512), nullable=False)
    password = Column(Text, nullable=False)
    totp_secret = Column(String(512), nullable=True)
    notes = Column(Text, nullable=True)

    url = Column(String(2048), nullable=True)
    tags = Column(JSON, nullable=True)
    favorite = Column(Boolean, nullable=False, default=False)

    created_at = Column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    last_used_at = Column(DateTime(timezone=False), nullable=True)

    autofill_rules = relationship(
        "AutofillRule", back_populates="credential", cascade="all, delete-orphan"
    )
    password_history = relationship(
        "PasswordHistory", back_populates="credential", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_credentials_platform", "platform_type", "platform_identifier"),
        Index("idx_credentials_username", "username"),
        Index("idx_credentials_title", "title"),
        Index("idx_credentials_favorite", "favorite"),
    )


# ── autofill_rules ────────────────────────────────────────────
class AutofillRule(Base):
    """Quy tắc match để agent biết điền credential vào đâu."""

    __tablename__ = "autofill_rules"

    id = Column(CHAR(36), primary_key=True)
    credential_id = Column(
        CHAR(36),
        ForeignKey("credentials.id", ondelete="CASCADE"),
        nullable=False,
    )
    match_type = Column(
        Enum(
            "domain",
            "exact_url",
            "process_name",
            "window_title_regex",
            "android_package",
            "resource_id_hint",
            name="match_type_enum",
        ),
        nullable=False,
    )
    match_value = Column(String(2048), nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    is_enabled = Column(Boolean, nullable=False, default=True)

    created_at = Column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    credential = relationship("Credential", back_populates="autofill_rules")

    __table_args__ = (
        Index("idx_autofill_rules_match", "match_type", "match_value", mysql_length={"match_value": 255}),
        Index("idx_autofill_rules_credential", "credential_id"),
    )


# ── password_history ──────────────────────────────────────────
class PasswordHistory(Base):
    """
    Lịch sử password cũ (plaintext).

    Record được tạo tự động bởi trigger khi password thay đổi.
    """

    __tablename__ = "password_history"

    id = Column(CHAR(36), primary_key=True)
    credential_id = Column(
        CHAR(36),
        ForeignKey("credentials.id", ondelete="CASCADE"),
        nullable=False,
    )
    password = Column(Text, nullable=False)
    changed_at = Column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    credential = relationship("Credential", back_populates="password_history")

    __table_args__ = (
        Index("idx_password_history_credential", "credential_id", "changed_at"),
    )


# ── error_logs ────────────────────────────────────────────────
class ErrorLog(Base):
    """Ghi lại các sự kiện lỗi/audit trong hệ thống."""

    __tablename__ = "error_logs"

    id = Column(CHAR(36), primary_key=True)
    event_type = Column(String(64), nullable=False)
    object_id = Column(CHAR(36), nullable=True)
    message = Column(Text, nullable=False)
    created_at = Column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_error_logs_event", "event_type", "object_id"),
    )


class InforLog(Base):
    __tablename__ = "infor_logs"

    id = Column(CHAR(36), primary_key=True)
    event_type = Column(String(64), nullable=False)
    object_id = Column(CHAR(36), nullable=True)
    message = Column(Text, nullable=False)
    created_at = Column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_infor_logs_event", "event_type", "object_id"),
    )

# ── Trigger SQL (chạy riêng sau khi tạo tables) ───────────────
TRIGGER_PASSWORD_HISTORY_SQL = """\
CREATE TRIGGER IF NOT EXISTS trg_credentials_password_history
BEFORE UPDATE ON credentials
FOR EACH ROW
BEGIN
    IF NOT (OLD.password <=> NEW.password) THEN
        INSERT INTO password_history (id, credential_id, password, changed_at)
        VALUES (UUID(), OLD.id, OLD.password, CURRENT_TIMESTAMP(6));
    END IF;
END
"""
