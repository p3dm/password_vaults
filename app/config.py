"""
Module cấu hình tập trung cho Password Vault.

Trách nhiệm:
- Load biến môi trường từ .env trong local development.
- Kiểm tra biến bắt buộc khi app khởi động.
- Cung cấp một object cấu hình frozen (readonly) cho các module khác.

Quy tắc:
- Không in db_password, master password, session key ra log.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


# ── Tìm và load .env một lần ─────────────────────────────────
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


# ── Settings dataclass ────────────────────────────────────────
@dataclass(frozen=True)
class Settings:
    """Cấu hình readonly cho toàn bộ app."""

    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    db_pool_size: int

    vault_autolock_minutes: int

    local_api_host: str
    local_api_port: int

    @property
    def database_url(self) -> str:
        """Trả SQLAlchemy connection string cho MariaDB."""
        return (
            f"mariadb+mariadbconnector://"
            f"{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    def __repr__(self) -> str:
        """Ẩn db_password khi repr/log để không lộ secret."""
        return (
            f"Settings(db_host={self.db_host!r}, db_port={self.db_port}, "
            f"db_user={self.db_user!r}, db_password='***', "
            f"db_name={self.db_name!r}, db_pool_size={self.db_pool_size}, "
            f"vault_autolock_minutes={self.vault_autolock_minutes}, "
            f"local_api_host={self.local_api_host!r}, "
            f"local_api_port={self.local_api_port})"
        )


# ── Helpers ───────────────────────────────────────────────────
def _require_env(key: str) -> str:
    """Lấy biến môi trường bắt buộc; raise nếu thiếu."""
    value = os.getenv(key)
    if value is None or value.strip() == "":
        raise ValueError(
            f"Biến môi trường bắt buộc '{key}' chưa được đặt. "
            f"Kiểm tra file .env hoặc environment variables."
        )
    return value.strip()


def _env_int(key: str, default: int | None = None) -> int:
    """Lấy biến môi trường dạng int, có thể có default."""
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        if default is not None:
            return default
        raise ValueError(f"Biến môi trường '{key}' chưa được đặt và không có default.")
    try:
        return int(raw.strip())
    except ValueError:
        raise ValueError(f"Biến môi trường '{key}' phải là số nguyên, nhận được: {raw!r}")


# ── Public API ────────────────────────────────────────────────
def load_settings() -> Settings:
    """
    Load .env / environment variables, validate và trả về Settings.

    Raise ValueError nếu thiếu biến bắt buộc hoặc giá trị không hợp lệ.
    """
    return Settings(
        db_host=_require_env("DB_HOST"),
        db_port=_env_int("DB_PORT", default=3306),
        db_user=_require_env("DB_USER"),
        db_password=_require_env("DB_PASSWORD"),
        db_name=_require_env("DB_NAME"),
        db_pool_size=_env_int("DB_POOL_SIZE", default=5),
        vault_autolock_minutes=_env_int("VAULT_AUTOLOCK_MINUTES", default=10),
        local_api_host=os.getenv("LOCAL_API_HOST", "127.0.0.1").strip(),
        local_api_port=_env_int("LOCAL_API_PORT", default=8765),
    )
