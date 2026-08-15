"""
Module quản lý kết nối database cho Password Vault.

Trách nhiệm:
- Tạo và quản lý SQLAlchemy Engine + SessionLocal duy nhất.
- Cấp/trả session an toàn qua context manager.
- Cung cấp transaction helper (auto commit/rollback).
- Không chứa business logic, không chứa SQL theo bảng cụ thể.

Quy tắc:
- Mọi INSERT/UPDATE/DELETE dùng transaction().
- Hàm đọc SELECT có thể dùng get_session().
- Query parameterized bắt buộc; không ghép chuỗi SQL bằng f-string với user input.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings

logger = logging.getLogger(__name__)

# ── Module-level state ────────────────────────────────────────
_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


# ── Lifecycle ─────────────────────────────────────────────────
def init_db(settings: Settings) -> None:
    """
    Khởi tạo engine + session factory một lần khi app startup.

    Phải gọi trước khi dùng get_session() hoặc transaction().
    Gọi lại khi đã init sẽ bị bỏ qua (idempotent).
    """
    global _engine, _SessionLocal

    if _engine is not None:
        logger.debug("Database đã được khởi tạo, bỏ qua init_db().")
        return

    _engine = create_engine(
        settings.database_url,
        echo=False,
        pool_size=settings.db_pool_size,
        max_overflow=2,
        pool_pre_ping=True,       # kiểm tra connection còn sống trước khi dùng
        pool_recycle=3600,         # recycle connection sau 1 giờ
    )

    _SessionLocal = sessionmaker(
        bind=_engine,
        autocommit=False,
        autoflush=False,
    )

    logger.info(
        "Database initialized: host=%s, db=%s, pool_size=%d",
        settings.db_host,
        settings.db_name,
        settings.db_pool_size,
    )


def close_db() -> None:
    """
    Đóng engine và giải phóng tất cả connection trong pool.

    Gọi khi app shutdown.
    """
    global _engine, _SessionLocal

    if _engine is not None:
        _engine.dispose()
        logger.info("Database engine disposed.")

    _engine = None
    _SessionLocal = None


def get_engine() -> Engine:
    """
    Trả engine hiện tại.

    Dùng khi cần truy cập engine trực tiếp (vd: Alembic, create_all).
    Raise RuntimeError nếu chưa init.
    """
    if _engine is None:
        raise RuntimeError(
            "Database chưa được khởi tạo. Gọi init_db(settings) trước."
        )
    return _engine


# ── Session context managers ──────────────────────────────────
@contextmanager
def get_session() -> Generator[Session, None, None]:
    """
    Mượn session, tự đóng khi kết thúc block.

    Dùng cho các hàm đọc (SELECT). Không auto-commit.

    Ví dụ:
        with get_session() as session:
            result = session.execute(text("SELECT 1"))
    """
    if _SessionLocal is None:
        raise RuntimeError(
            "Database chưa được khởi tạo. Gọi init_db(settings) trước."
        )

    session = _SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def transaction() -> Generator[Session, None, None]:
    """
    Yield session; commit khi thành công, rollback khi exception.

    Dùng cho mọi thay đổi INSERT/UPDATE/DELETE.

    Ví dụ:
        with transaction() as session:
            session.execute(
                text("UPDATE vault_items SET favorite = :fav WHERE id = :id"),
                {"fav": 1, "id": item_id},
            )
    """
    if _SessionLocal is None:
        raise RuntimeError(
            "Database chưa được khởi tạo. Gọi init_db(settings) trước."
        )

    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ── Health check ──────────────────────────────────────────────
def check_connection() -> bool:
    """
    Kiểm tra kết nối tới MariaDB có hoạt động không.

    Trả True nếu kết nối OK, False nếu lỗi.
    """
    try:
        with get_session() as session:
            session.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.error("Database connection check failed: %s", e)
        return False
