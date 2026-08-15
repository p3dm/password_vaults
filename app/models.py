"""
SQLAlchemy ORM models cho Password Vault.

Các bảng:
- vault_meta:       KDF params, salts, verifier (chỉ 1 row)
- vault_items:      credentials + encrypted secret fields
- autofill_rules:   rules để match target (domain, window title, ...)
- password_history: password ciphertext cũ (tự lưu qua trigger)

Quy tắc:
- username là plaintext để hỗ trợ search/list nhanh.
- password, totp_secret, notes đều là ciphertext (VARBINARY/BLOB).
- Mỗi encrypted field có nonce riêng.
"""

from sqlalchemy import (
    BLOB,
    CHAR,
    JSON,
    VARBINARY,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.orm import DeclarativeBase, relationship


# ── Base ──────────────────────────────────────────────────────
class Base(DeclarativeBase):
    """Base class cho tất cả ORM models."""
    pass


# ── vault_meta ────────────────────────────────────────────────
class VaultMeta(Base):
    """
    Thông tin derive key, chỉ có 1 row duy nhất (id = 1).

    Lưu KDF params (Argon2id), salt, và verifier hash
    để xác nhận master password đúng khi unlock.
    """

    __tablename__ = "vault_meta"

    id = Column(SmallInteger, primary_key=True, autoincrement=False)
    kdf_algorithm = Column(String(32), nullable=False, server_default="argon2id")
    kdf_salt = Column(VARBINARY(64), nullable=False)
    kdf_memory_cost = Column(Integer, nullable=False)
    kdf_time_cost = Column(Integer, nullable=False)
    kdf_parallelism = Column(Integer, nullable=False)
    verifier_hash = Column(VARBINARY(256), nullable=False)
    verifier_salt = Column(VARBINARY(64), nullable=False)
    schema_version = Column(Integer, nullable=False, server_default="1")
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_vault_meta_single_row"),
    )


# ── vault_items ───────────────────────────────────────────────
class VaultItem(Base):
    """
    Bảng chính lưu credential.

    - username: plaintext để search/list
    - password_encrypted, totp_secret_encrypted, notes_encrypted: ciphertext AES-256-GCM
    - Mỗi encrypted field đi kèm _nonce riêng
    """

    __tablename__ = "vault_items"

    id = Column(CHAR(36), primary_key=True)
    title = Column(String(255), nullable=False)
    platform_type = Column(
        Enum("web", "desktop_app", "other", name="platform_type_enum"),
        nullable=False,
    )
    platform_identifier = Column(String(255))

    # Username: plaintext theo yêu cầu
    username = Column(String(255), nullable=False)

    # Password: encrypted
    password_encrypted = Column(VARBINARY(512), nullable=False)
    password_nonce = Column(VARBINARY(32), nullable=False)

    # TOTP secret: encrypted (optional)
    totp_secret_encrypted = Column(VARBINARY(512))
    totp_secret_nonce = Column(VARBINARY(32))

    # URL + Notes
    url = Column(String(2048))
    notes_encrypted = Column(BLOB)
    notes_nonce = Column(VARBINARY(32))

    # Metadata
    tags = Column(JSON)
    favorite = Column(Boolean, nullable=False, server_default="0")

    # Timestamps
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_used_at = Column(DateTime, nullable=True)

    # Relationships
    autofill_rules = relationship(
        "AutofillRule", back_populates="vault_item", cascade="all, delete-orphan"
    )
    password_history = relationship(
        "PasswordHistory", back_populates="vault_item", cascade="all, delete-orphan"
    )


# ── autofill_rules ────────────────────────────────────────────
class AutofillRule(Base):
    """
    Quy tắc match để agent biết điền credential vào đâu.

    Một vault_item có thể có nhiều rule (vd: vừa match domain vừa match window title).
    """

    __tablename__ = "autofill_rules"

    id = Column(CHAR(36), primary_key=True)
    vault_item_id = Column(
        CHAR(36),
        ForeignKey("vault_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    match_type = Column(
        Enum(
            "domain",
            "window_title_regex",
            "android_package",
            "resource_id_hint",
            name="match_type_enum",
        ),
        nullable=False,
    )
    match_value = Column(String(512), nullable=False)
    field_role = Column(
        Enum("username", "password", "otp", name="field_role_enum"),
        nullable=False,
    )
    priority = Column(Integer, nullable=False, server_default="0")

    vault_item = relationship("VaultItem", back_populates="autofill_rules")


# ── password_history ──────────────────────────────────────────
class PasswordHistory(Base):
    """
    Lịch sử password cũ (ciphertext).

    Record được tạo tự động bởi MariaDB trigger khi password thay đổi.
    """

    __tablename__ = "password_history"

    id = Column(CHAR(36), primary_key=True)
    vault_item_id = Column(
        CHAR(36),
        ForeignKey("vault_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    password_encrypted = Column(VARBINARY(512), nullable=False)
    password_nonce = Column(VARBINARY(32), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())

    vault_item = relationship("VaultItem", back_populates="password_history")


# ── Trigger SQL (chạy riêng bằng raw SQL sau khi tạo tables) ─
TRIGGER_PASSWORD_HISTORY_SQL = """\
CREATE TRIGGER IF NOT EXISTS trg_vault_items_password_history
AFTER UPDATE ON vault_items
FOR EACH ROW
BEGIN
    IF NOT (OLD.password_encrypted <=> NEW.password_encrypted) THEN
        INSERT INTO password_history (id, vault_item_id, password_encrypted, password_nonce, changed_at)
        VALUES (UUID(), OLD.id, OLD.password_encrypted, OLD.password_nonce, CURRENT_TIMESTAMP);
    END IF;
END
"""
