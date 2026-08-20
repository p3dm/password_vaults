"""
Exception nghiệp vụ cho Credential Store (plaintext).

Tập trung exception để API/UI xử lý nhất quán,
không expose lỗi DB thô cho frontend.
"""


class CredentialStoreError(Exception):
    """Base exception cho tất cả lỗi credential store."""
    pass


# Backward compatibility alias
VaultError = CredentialStoreError


class CredentialNotFoundError(CredentialStoreError):
    """Credential với ID chỉ định không tồn tại."""
    pass


class ValidationError(CredentialStoreError):
    """Dữ liệu đầu vào không hợp lệ."""
    pass


class DuplicateAutofillRuleError(CredentialStoreError):
    """Autofill rule đã tồn tại cho item + match_type + match_value."""
    pass


class LocalApiUnauthorizedError(CredentialStoreError):
    """Request tới local API không có token hợp lệ."""
    pass
