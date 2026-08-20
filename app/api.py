"""
Local REST API cho Password Vault — Flask.

Ràng buộc:
- Bind 127.0.0.1 only (không expose ra LAN/Internet).
- Header X-Local-Token bắt buộc cho mọi request.
- Không log request/response body chứa password.
- Password chỉ trả ở endpoint autofill payload (POST /v1/autofill/payload).

Endpoint:
    GET    /v1/credentials              — List/search credential (không password)
    POST   /v1/credentials              — Tạo credential mới
    GET    /v1/credentials/<id>         — Xem metadata (không password)
    PATCH  /v1/credentials/<id>         — Update metadata/password
    DELETE /v1/credentials/<id>         — Xóa credential
    POST   /v1/credentials-with-rules   — Tạo credential + autofill rules
    POST   /v1/autofill/candidates      — Tìm candidate (không password)
    POST   /v1/autofill/payload         — Lấy username+password để autofill
"""

from __future__ import annotations

import logging

from flask import Blueprint, request, jsonify

from app.controller.credential import (
    insert_credential,
    read_one_credential,
    read_all_credential,
    update_credential_metadata,
    update_credential_password,
    delete_credential,
    create_credential_with_rules,
)
from app.controller.autofill_rule import (
    add_autofill_rule,
    list_autofill_rules,
    update_autofill_rule,
    delete_autofill_rule,
)
from app.credential_service import CredentialService
from app.autofill_matcher import AutofillContext
from app.exceptions import (
    CredentialStoreError,
    CredentialNotFoundError,
    ValidationError,
)

logger = logging.getLogger(__name__)

# ── Blueprint ─────────────────────────────────────────────────
# url_prefix='/api' được đặt khi register ở app.py
# Token authentication được xử lý ở app-level (app.py)

api_bp = Blueprint("api", __name__)


# ── Error handlers ────────────────────────────────────────────

@api_bp.errorhandler(ValidationError)
def _handle_validation_error(e):
    return jsonify({"error": "Validation Error", "message": str(e)}), 422


@api_bp.errorhandler(CredentialNotFoundError)
def _handle_not_found(e):
    return jsonify({"error": "Not Found", "message": str(e)}), 404


@api_bp.errorhandler(CredentialStoreError)
def _handle_store_error(e):
    return jsonify({"error": "Store Error", "message": str(e)}), 500


@api_bp.errorhandler(ValueError)
def _handle_value_error(e):
    return jsonify({"error": "Bad Request", "message": str(e)}), 400


@api_bp.errorhandler(Exception)
def _handle_generic_error(e):
    logger.error("Unhandled error: %s", e, exc_info=True)
    return jsonify({"error": "Internal Server Error", "message": "Đã xảy ra lỗi không mong muốn"}), 500


# ── Helper: Serialize credential ORM object ───────────────────

def _credential_to_summary(cred) -> dict:
    """Chuyển Credential ORM object thành dict summary (KHÔNG có password)."""
    return {
        "id": cred.id,
        "title": cred.title,
        "platform_type": cred.platform_type,
        "platform_identifier": cred.platform_identifier,
        "username": cred.username,
        "url": cred.url,
        "tags": cred.tags or [],
        "favorite": cred.favorite,
        "notes": cred.notes,
        "created_at": cred.created_at.isoformat() if cred.created_at else None,
        "updated_at": cred.updated_at.isoformat() if cred.updated_at else None,
        "last_used_at": cred.last_used_at.isoformat() if cred.last_used_at else None,
    }


def _rule_to_dict(rule) -> dict:
    """Chuyển AutofillRule ORM object thành dict."""
    return {
        "id": rule.id,
        "credential_id": rule.credential_id,
        "match_type": rule.match_type,
        "match_value": rule.match_value,
        "priority": rule.priority,
        "is_enabled": rule.is_enabled,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


# ══════════════════════════════════════════════════════════════
# Credential CRUD Endpoints
# ══════════════════════════════════════════════════════════════


@api_bp.route("/credentials", methods=["GET"])
def list_credentials():
    """
    GET /v1/credentials
    List tất cả credential (summary, KHÔNG password).
    """
    results = read_all_credential()
    return jsonify({
        "data": [
            {
                "id": r.id,
                "platform_type": r.platform_type,
                "platform_identifier": r.platform_identifier,
                "username": r.username,
                "notes": r.notes,
                "url": r.url,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in results
        ],
        "total": len(results),
    })


@api_bp.route("/credentials", methods=["POST"])
def create_credential():
    """
    POST /v1/credentials
    Tạo credential mới.

    Body JSON:
    {
        "title": "Riot Games",
        "platform_type": "desktop_app",
        "username": "myuser",
        "password": "mypass",
        "platform_identifier": "Riot Client.exe",   // optional
        "url": "https://example.com",                // optional
        "tags": ["game", "riot"],                     // optional
        "favorite": false,                            // optional
        "notes": "Account chính",                     // optional
        "totp_secret": null                           // optional
    }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    credential_id = insert_credential(body)

    logger.info("Credential created via API: %s", credential_id)
    return jsonify({
        "message": "Credential created successfully",
        "id": credential_id,
    }), 201


@api_bp.route("/credentials/<credential_id>", methods=["GET"])
def get_credential(credential_id: str):
    """
    GET /v1/credentials/<id>
    Xem metadata credential (KHÔNG password).
    """
    cred = read_one_credential(credential_id)
    return jsonify({"data": _credential_to_summary(cred)})


@api_bp.route("/credentials/<credential_id>", methods=["PATCH"])
def update_credential(credential_id: str):
    """
    PATCH /v1/credentials/<id>
    Update metadata và/hoặc password.

    Body JSON (gửi field cần update):
    {
        "title": "New Title",
        "password": "new_password"    // optional, nếu có sẽ đổi password
    }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    # Nếu có password mới → update password riêng
    new_password = body.pop("password", None)
    if new_password:
        update_credential_password(credential_id, new_password)

    # Update metadata nếu còn field
    if body:
        # Cần lấy credential hiện tại để merge với data cũ
        current = read_one_credential(credential_id)
        merged = {
            "title": body.get("title", current.title),
            "platform_type": body.get("platform_type", current.platform_type),
            "platform_identifier": body.get("platform_identifier", current.platform_identifier),
            "username": body.get("username", current.username),
            "password": current.password,  # giữ password hiện tại cho validator
            "totp_secret": body.get("totp_secret", current.totp_secret),
            "notes": body.get("notes", current.notes),
            "url": body.get("url", current.url),
            "tags": body.get("tags", current.tags),
            "favorite": body.get("favorite", current.favorite),
        }
        update_credential_metadata(credential_id, merged)

    logger.info("Credential updated via API: %s", credential_id)
    return jsonify({"message": "Credential updated successfully", "id": credential_id})


@api_bp.route("/credentials/<credential_id>", methods=["DELETE"])
def remove_credential(credential_id: str):
    """
    DELETE /v1/credentials/<id>
    Xóa credential (cascade xóa rules + history).
    """
    result = delete_credential(credential_id)
    logger.info("Credential deleted via API: %s", credential_id)
    return jsonify({"message": result})


# ══════════════════════════════════════════════════════════════
# Credential + Rules (atomic create)
# ══════════════════════════════════════════════════════════════


@api_bp.route("/credentials-with-rules", methods=["POST"])
def create_credential_with_rules_endpoint():
    """
    POST /v1/credentials-with-rules
    Tạo credential + autofill rules trong 1 transaction.

    Body JSON:
    {
        "credential": {
            "title": "Riot Games",
            "platform_type": "desktop_app",
            "username": "myuser",
            "password": "mypass"
        },
        "rules": [
            {
                "match_type": "process_name",
                "match_value": "RiotClientUx.exe",
                "priority": 10
            },
            {
                "match_type": "window_title_regex",
                "match_value": ".*Riot Client.*",
                "priority": 5
            }
        ]
    }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    cred_data = body.get("credential")
    rules = body.get("rules", [])

    if not cred_data:
        return jsonify({"error": "Bad Request", "message": "Thiếu 'credential' trong body"}), 400

    credential_id = create_credential_with_rules(cred_data, rules)

    logger.info("Credential with rules created via API: %s", credential_id)
    return jsonify({
        "message": "Credential and rules created successfully",
        "id": credential_id,
    }), 201


# ══════════════════════════════════════════════════════════════
# Autofill Rule Endpoints
# ══════════════════════════════════════════════════════════════


@api_bp.route("/credentials/<credential_id>/rules", methods=["GET"])
def get_rules(credential_id: str):
    """GET /v1/credentials/<id>/rules — List autofill rules cho 1 credential."""
    rules = list_autofill_rules(credential_id)
    return jsonify({
        "data": [_rule_to_dict(r) for r in rules],
        "total": len(rules),
    })


@api_bp.route("/credentials/<credential_id>/rules", methods=["POST"])
def create_rule(credential_id: str):
    """
    POST /v1/credentials/<id>/rules — Thêm autofill rule.

    Body JSON:
    {
        "match_type": "process_name",
        "match_value": "RiotClientUx.exe",
        "priority": 10
    }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    result = add_autofill_rule(credential_id, body)
    logger.info("Rule added via API for credential: %s", credential_id)
    return jsonify({"message": result}), 201


@api_bp.route("/rules/<rule_id>", methods=["PATCH"])
def modify_rule(rule_id: str):
    """PATCH /v1/rules/<id> — Update autofill rule."""
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    result = update_autofill_rule(rule_id, body)
    return jsonify({"message": result})


@api_bp.route("/rules/<rule_id>", methods=["DELETE"])
def remove_rule(rule_id: str):
    """DELETE /v1/rules/<id> — Xóa autofill rule."""
    result = delete_autofill_rule(rule_id)
    return jsonify({"message": result})


# ══════════════════════════════════════════════════════════════
# Autofill Endpoints
# ══════════════════════════════════════════════════════════════


@api_bp.route("/autofill/candidates", methods=["POST"])
def find_autofill_candidates():
    """
    POST /v1/autofill/candidates
    Tìm credential candidate phù hợp (KHÔNG password).

    Body JSON:
    {
        "source": "desktop",
        "process_name": "RiotClientUx.exe",
        "window_title": "Riot Client"
    }
    """
    body = request.get_json(force=True)
    if not body:
        return jsonify({"error": "Bad Request", "message": "Body JSON không được rỗng"}), 400

    context = AutofillContext(
        source=body.get("source", "desktop"),
        domain=body.get("domain"),
        url=body.get("url"),
        process_name=body.get("process_name"),
        window_title=body.get("window_title"),
    )

    service = CredentialService()
    candidates = service.find_autofill_candidates(context)

    return jsonify({
        "data": [
            {
                "credential_id": c.credential_id,
                "title": c.title,
                "username": c.username,
                "priority": c.priority,
                "favorite": c.favorite,
            }
            for c in candidates
        ],
        "total": len(candidates),
    })


@api_bp.route("/autofill/payload", methods=["POST"])
def get_autofill_payload():
    """
    POST /v1/autofill/payload
    Lấy username + password để autofill (CHỈ cho credential đã chọn).

    Body JSON:
    {
        "credential_id": "uuid-string"
    }

    ⚠️ Response CÓ CHỨA password — chỉ dùng cho local authenticated caller.
    """
    body = request.get_json(force=True)
    credential_id = body.get("credential_id")
    if not credential_id:
        return jsonify({"error": "Bad Request", "message": "Thiếu credential_id"}), 400

    service = CredentialService()
    payload = service.get_autofill_payload(credential_id)

    return jsonify({"data": payload})
