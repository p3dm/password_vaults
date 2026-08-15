from sqlalchemy import (
    CHAR,
    JSON,
    VARBINARY,
    BLOB,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Boolean,
    CheckConstraint,
    func,
)
from sqlalchemy.orm import declarative_base, relationship
 
Base = declarative_base()
 
 
class VaultMeta(Base):
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
 
    __table_args__ = (CheckConstraint("id = 1", name="ck_vault_meta_single_row"),)
 
 
class VaultItem(Base):
    __tablename__ = "vault_items"
 
    id = Column(CHAR(36), primary_key=True)
    title = Column(String(255), nullable=False)
    platform_type = Column(Enum("web", "desktop_app", "other"), nullable=False)
    platform_identifier = Column(String(255))
 
    username = Column(String(255), nullable=False)
 
    password_encrypted = Column(VARBINARY(512), nullable=False)
    password_nonce = Column(VARBINARY(32), nullable=False)
 
    totp_secret_encrypted = Column(VARBINARY(512))
    totp_secret_nonce = Column(VARBINARY(32))
 
    url = Column(String(2048))
    notes_encrypted = Column(BLOB)
    notes_nonce = Column(VARBINARY(32))
 
    tags = Column(JSON)
    favorite = Column(Boolean, nullable=False, server_default="0")
 
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_used_at = Column(DateTime, nullable=True)
 
    autofill_rules = relationship(
        "AutofillRule", back_populates="vault_item", cascade="all, delete-orphan"
    )
    password_history = relationship(
        "PasswordHistory", back_populates="vault_item", cascade="all, delete-orphan"
    )
 
 
class AutofillRule(Base):
    __tablename__ = "autofill_rules"
 
    id = Column(CHAR(36), primary_key=True)
    vault_item_id = Column(
        CHAR(36), ForeignKey("vault_items.id", ondelete="CASCADE"), nullable=False
    )
    match_type = Column(
        Enum("domain", "window_title_regex"),
        nullable=False,
    )
    match_value = Column(String(512), nullable=False)
    field_role = Column(Enum("username", "password", "otp"), nullable=False)
    priority = Column(Integer, nullable=False, server_default="0")
 
    vault_item = relationship("VaultItem", back_populates="autofill_rules")
 
 
class PasswordHistory(Base):
    __tablename__ = "password_history"
 
    id = Column(CHAR(36), primary_key=True)
    vault_item_id = Column(
        CHAR(36), ForeignKey("vault_items.id", ondelete="CASCADE"), nullable=False
    )
    password_encrypted = Column(VARBINARY(512), nullable=False)
    password_nonce = Column(VARBINARY(32), nullable=False)
    changed_at = Column(DateTime, nullable=False, server_default=func.now())
 
    vault_item = relationship("VaultItem", back_populates="password_history")
 
 
TRIGGER_SQL = """
CREATE TRIGGER trg_vault_items_password_history
AFTER UPDATE ON vault_items
FOR EACH ROW
BEGIN
    IF NOT (OLD.password_encrypted <=> NEW.password_encrypted) THEN
        INSERT INTO password_history (id, vault_item_id, password_encrypted, password_nonce, changed_at)
        VALUES (UUID(), OLD.id, OLD.password_encrypted, OLD.password_nonce, CURRENT_TIMESTAMP);
    END IF;
END
"""
 
 
def create_with_orm() -> None:
    Base.metadata.create_all(engine)  # tạo 4 bảng + index + FK
    with engine.begin() as conn:
        conn.execute(text(TRIGGER_SQL))  # trigger phải chạy riêng bằng raw SQL
    print("Đã tạo schema thành công bằng ORM")
 
 
if __name__ == "__main__":
    create_with_orm()