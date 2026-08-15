"""
Exception nghiệp vụ cho Password Vault.

Tập trung exception để API/UI xử lý nhất quán,
không expose lỗi DB/crypto thô cho frontend.
"""


class VaultError(Exception):
    """Base exception cho tất cả lỗi vault."""
    pass


class VaultNotInitializedError(VaultError):
    """Vault chưa được khởi tạo (chưa có vault_meta)."""
    pass


class VaultLockedError(VaultError):
    """Vault đang bị khóa, cần unlock trước khi truy cập secret."""
    pass


class InvalidMasterPasswordError(VaultError):
    """Master password không đúng."""
    pass


class CredentialNotFoundError(VaultError):
    """Credential với ID chỉ định không tồn tại."""
    pass


class DuplicateAutofillRuleError(VaultError):
    """Autofill rule đã tồn tại cho item + match_type + match_value."""
    pass


class VaultIntegrityError(VaultError):
    """Ciphertext không xác thực được hoặc record có cấu trúc sai."""
    pass
