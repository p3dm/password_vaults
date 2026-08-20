"""
Module validation và normalization cho credential và autofill rule input.

Trách nhiệm:
- Validate và normalize input trước khi ghi DB.
- Không query DB, không tự lưu dữ liệu.
"""

import re
from urllib.parse import urlparse
from app.exceptions import ValidationError
from app.controller.log import Log_Record as log

VALID_PLATFORM_TYPES = {"web", "desktop_app", "other"}

VALID_MATCH_TYPES = {
    "domain",
    "exact_url",
    "process_name",
    "window_title_regex",
}

MAX_REGEX_LENGTH = 512


def validate_credential(data: dict) -> dict:
    errors = []

    # title
    title = str(data.get("title", "")).strip()
    if not title:
        errors.append("title: not valid")
    elif len(title) > 255:
        errors.append("title: too long")

    # platform type validation
    platform_type = str(data.get("platform_type", "")).strip()
    if platform_type not in VALID_PLATFORM_TYPES:
        errors.append("platform_type: not valid")

    # username validation
    username = str(data.get("username", "")).strip()
    if not username:
        errors.append("username: not valid")
    elif len(username) > 512:
        errors.append("username: too long")

    # password validation
    password = str(data.get("password", ""))
    if not password:
        errors.append("password: not valid")

    # url validation
    url = str(data.get("url", "") or "").strip() or None
    if url and not (url.startswith("http://") or url.startswith("https://")):
        errors.append("url must start with http:// or https://")

    if errors:
        log.log_error(
            event_type="validation_error",
            message="; ".join(errors),
            object_id=str(data.get("id")),
        )
        raise ValidationError("; ".join(errors))

    return {
        **data,
        "title": title,
        "username": username,
        "url": url,
        "tags": normalize_tags(data.get("tags")),
        "totp_secret": str(data["totp_secret"]).strip() if data.get("totp_secret") else None,
        "notes": str(data["notes"]).strip() if data.get("notes") else None,
    }


def validate_rule_input(rule: dict) -> dict:
    """
    Validate autofill rule input.

    Trả dict đã validate nếu hợp lệ, raise ValidationError nếu không.
    """
    errors = []

    match_type = str(rule.get("match_type", "")).strip()
    if match_type not in VALID_MATCH_TYPES:
        errors.append("match_type: not valid")

    match_value = str(rule.get("match_value", "")).strip()
    if not match_value:
        errors.append("match_value: not valid")
    elif len(match_value) > 2048:
        errors.append("match_value: too long")

    if match_type == "window_title_regex":
        if len(match_value) > MAX_REGEX_LENGTH:
            errors.append("match_value: too long for regex")
        else:
            try:
                re.compile(match_value)
            except re.error as e:
                errors.append(f"match_value: invalid regex — {e}")

    if errors:
        log.log_error(
            event_type="validation_error",
            message="; ".join(errors),
            object_id=str(rule.get("id", "N/A")),
        )
        raise ValidationError("; ".join(errors))

    return {
        "id": rule.get("id"),
        "match_type": match_type,
        "match_value": match_value,
        "priority": int(rule.get("priority", 0)),
        "is_enabled": bool(rule.get("is_enabled", True)),
    }


def normalize_domain(value: str) -> str:
    value = value.strip().lower()
    if "://" not in value:
        value = "https://" + value

    parsed = urlparse(value)
    return parsed.hostname or value


def normalize_tags(tags: list | None) -> list[str]:
    if not tags:
        return []
    seen = set()
    result = []
    for tag in tags:
        normalized = str(tag).strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result