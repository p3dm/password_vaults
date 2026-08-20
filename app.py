"""
Password Vault Agent — Entry point.

Luồng khởi động:
1. Load settings từ .env
2. Cấu hình logging
3. Init database connection pool
4. Kiểm tra DB connection (health check)
5. Khởi tạo WindowsAdapter và đăng ký hotkey
6. Tạo Flask app, đăng ký blueprint, khởi chạy API server (background thread)
7. Giữ chương trình chạy (main loop)
8. Cleanup khi thoát (Ctrl+C)
"""

from __future__ import annotations

import logging
import os
import secrets
import signal
import sys
import threading
import time

from flask import Flask, request, jsonify

from app.config import load_settings
from app.db import init_db, close_db, check_connection
from app.autofill.windows_agent import WindowsAdapter
from app.api import api_bp


# ── Logging setup ─────────────────────────────────────────────

def _setup_logging() -> None:
    """Cấu hình logging cho toàn bộ ứng dụng."""
    log_format = (
        "%(asctime)s │ %(levelname)-8s │ %(name)-30s │ %(message)s"
    )
    logging.basicConfig(
        level=logging.INFO,
        format=log_format,
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )
    # Giảm noise từ thư viện bên ngoài
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("keyboard").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


logger = logging.getLogger(__name__)


# ── Banner ────────────────────────────────────────────────────

BANNER = r"""
  ╔══════════════════════════════════════════╗
  ║     🔐  Password Vault Agent  🔐        ║
  ║     Local Autofill Credential Store      ║
  ╚══════════════════════════════════════════╝
"""


# ── Flask app factory ─────────────────────────────────────────

def create_flask_app() -> Flask:
    """
    Tạo Flask app, đăng ký blueprint với prefix /v1,
    thiết lập token authentication và health check.
    """
    flask_app = Flask(__name__)
    flask_app.config["JSON_SORT_KEYS"] = False

    # ── Token management ──────────────────────────────────
    api_token = os.getenv("LOCAL_API_TOKEN", "").strip()
    if not api_token:
        api_token = secrets.token_urlsafe(32)
        logger.warning(
            "LOCAL_API_TOKEN chưa được đặt trong .env. "
            "Token tạm thời cho phiên này: %s",
            api_token,
        )
    flask_app.config["LOCAL_API_TOKEN"] = api_token

    # ── Token authentication middleware ────────────────────
    @flask_app.before_request
    def _check_token():
        """Kiểm tra X-Local-Token trên mọi request (trừ /health)."""
        if request.path == "/health":
            return None
        token = request.headers.get("X-Local-Token", "")
        if not secrets.compare_digest(token, flask_app.config["LOCAL_API_TOKEN"]):
            return jsonify({
                "error": "Unauthorized",
                "message": "Invalid or missing X-Local-Token",
            }), 401

    # ── Health check (app-level, không qua blueprint) ─────
    @flask_app.route("/health", methods=["GET"])
    def health_check():
        """GET /health — không cần token."""
        return jsonify({"status": "ok"})

    # ── Đăng ký blueprint với prefix / ──────────────────
    flask_app.register_blueprint(api_bp, url_prefix="/api")

    return flask_app


# ── Main ──────────────────────────────────────────────────────

def main() -> None:
    """Entry point — khởi động Password Vault Agent."""

    _setup_logging()
    print(BANNER)

    # 1. Load settings
    logger.info("Loading settings...")
    try:
        settings = load_settings()
        logger.info("Settings loaded: %s", settings)
    except ValueError as e:
        logger.critical("Lỗi cấu hình: %s", e)
        sys.exit(1)

    # 2. Init database
    logger.info("Initializing database connection pool...")
    try:
        init_db(settings)
    except Exception as e:
        logger.critical("Không thể khởi tạo database: %s", e)
        sys.exit(1)

    # 3. Health check
    logger.info("Checking database connection...")
    if not check_connection():
        logger.critical(
            "Không thể kết nối database! "
            "Kiểm tra DB_HOST, DB_PORT, DB_USER, DB_PASSWORD trong .env"
        )
        close_db()
        sys.exit(1)
    logger.info("Database connection OK ✓")

    # 4. Khởi tạo Windows agent
    agent = WindowsAdapter()
    agent.start()
    logger.info("Hotkey listener started ✓")

    # 5. Tạo Flask app và khởi chạy API server trong background thread
    flask_app = create_flask_app()
    api_host = settings.local_api_host
    api_port = settings.local_api_port

    def _run_server():
        logger.info("Starting API server on %s:%d", api_host, api_port)
        logger.info("API Token: %s", flask_app.config["LOCAL_API_TOKEN"])
        flask_app.run(host=api_host, port=api_port, debug=False, use_reloader=False)

    api_thread = threading.Thread(
        target=_run_server,
        daemon=True,
        name="api-server",
    )
    api_thread.start()
    logger.info("API server started on %s:%d ✓", api_host, api_port)

    # 6. Xử lý tín hiệu thoát
    shutdown_event = False

    def _signal_handler(sig, frame):
        nonlocal shutdown_event
        if not shutdown_event:
            shutdown_event = True
            print()  # newline sau ^C
            logger.info("Shutting down...")
            agent.stop()
            close_db()
            logger.info("Goodbye! 👋")
            sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    # 7. Main loop — giữ chương trình sống
    print(f"  ✓ Agent đang chạy. Nhấn Ctrl+Alt+A để autofill.")
    print(f"  ✓ API server: http://{api_host}:{api_port}/api/")
    print(f"  ✓ Nhấn Ctrl+C để thoát.\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        _signal_handler(None, None)


if __name__ == "__main__":
    main()
