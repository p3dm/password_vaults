"""
Script test nhanh: config + db connection + tạo tables.

Chạy: python test_db_setup.py
"""

from sqlalchemy import text

from app.config import load_settings
from app.db import init_db, check_connection, get_session, get_engine, close_db
from app.models import Base, TRIGGER_PASSWORD_HISTORY_SQL


def main():
    # 1. Load settings
    settings = load_settings()
    print(f"[OK] Settings loaded: {settings}")
    print()

    # 2. Init database
    init_db(settings)
    print("[OK] Database initialized")

    # 3. Check connection
    ok = check_connection()
    print(f"[{'OK' if ok else 'FAIL'}] Connection check: {ok}")
    if not ok:
        print("Không thể kết nối MariaDB. Kiểm tra .env và MariaDB service.")
        return

    # 4. MariaDB version
    with get_session() as session:
        version = session.execute(text("SELECT VERSION()")).scalar()
        print(f"[OK] MariaDB version: {version}")

    # 5. Tạo tables nếu chưa có
    engine = get_engine()
    Base.metadata.create_all(engine)
    print("[OK] Tables created (or already exist)")

    # 6. Tạo trigger (bỏ qua nếu đã tồn tại)
    try:
        with engine.begin() as conn:
            conn.execute(text(TRIGGER_PASSWORD_HISTORY_SQL))
        print("[OK] Trigger created")
    except Exception as e:
        if "already exists" in str(e).lower() or "Trigger does not exist" in str(e):
            print("[OK] Trigger already exists, skipped")
        else:
            print(f"[WARN] Trigger creation: {e}")

    # 7. Liệt kê tables
    with get_session() as session:
        result = session.execute(text("SHOW TABLES"))
        tables = [row[0] for row in result]
        print(f"[OK] Tables in database: {tables}")

    # 8. Kiểm tra cấu trúc vault_meta
    with get_session() as session:
        result = session.execute(text("DESCRIBE vault_meta"))
        print("\n--- vault_meta columns ---")
        for row in result:
            print(f"  {row[0]:25s} {row[1]}")

    # 9. Kiểm tra cấu trúc vault_items
    with get_session() as session:
        result = session.execute(text("DESCRIBE vault_items"))
        print("\n--- vault_items columns ---")
        for row in result:
            print(f"  {row[0]:25s} {row[1]}")

    # Cleanup
    close_db()
    print("\n[OK] All tests passed! Database setup complete.")


if __name__ == "__main__":
    main()
