# Kế hoạch module — Local Password Vault

## 1. Mục tiêu và phạm vi

Hệ thống là password vault chạy local trên máy tính, dùng **MariaDB** làm nơi lưu trữ bền vững và một desktop agent/API local để quản lý credential cũng như hỗ trợ autofill.

### Mục tiêu chính

- Lưu username ở plaintext theo yêu cầu để list/search nhanh.
- Mã hóa password, TOTP secret và notes trước khi ghi xuống MariaDB.
- Không lưu master password hoặc khóa AES vào database/file cấu hình.
- Chỉ giữ khóa session đã derive trong RAM khi vault đang unlock.
- Tách lớp DB, crypto, business logic và autofill để dễ test/thay thế.
- Cho phép app desktop, browser extension hoặc automation agent cùng gọi chung logic vault.

### Ngoài phạm vi phiên bản đầu

- Đồng bộ nhiều thiết bị qua Internet.
- Chia sẻ vault cho nhiều user.
- Recovery master password. Nếu quên master password thì dữ liệu mã hóa không thể khôi phục.
- Tự động inject password không cần thao tác/xác nhận của người dùng.

---

## 2. Kiến trúc tổng thể

```text
Desktop UI / CLI / Flask-FastAPI local API / Autofill Agent
                         |
                         v
                  vault_service.py
                  (business logic + session)
                    |              |
                    v              v
              crypto.py       vault_repo.py
                    |              |
                    |              v
                    |           db.py
                    |              |
                    v              v
             RAM: session key      MariaDB
```

### Quy tắc phụ thuộc

```text
ui/api/agent -> service -> repo -> db
                     |
                     -> crypto
matcher -> repo
```

- `crypto.py` không import `db.py`, `vault_repo.py` hay framework web.
- `db.py` không biết bảng vault nào và không biết mã hóa.
- `vault_repo.py` chỉ biết SQL/schema, không giữ master password và không decrypt.
- `vault_service.py` là cửa duy nhất để mã hóa, giải mã, unlock và lock vault.
- UI/API/agent không được query trực tiếp các cột `password_encrypted`.

---

## 3. Cấu trúc thư mục đề xuất

```text
password-vault/
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── db.py
│   ├── crypto.py
│   ├── exceptions.py
│   ├── vault_repo.py
│   ├── vault_service.py
│   ├── autofill_matcher.py
│   ├── audit_service.py                 # tùy chọn ở v1.1
│   └── api.py                            # Flask/FastAPI, nếu cần API local
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_*.sql
├── tests/
│   ├── test_crypto.py
│   ├── test_vault_repo.py
│   ├── test_vault_service.py
│   └── test_autofill_matcher.py
├── .env                                 # không commit
├── .env.example                         # commit, không có secret thật
├── .gitignore
├── requirements.txt
└── main.py
```

---

## 4. Module `config.py`

### Trách nhiệm

- Load biến môi trường từ `.env` trong local development.
- Kiểm tra biến bắt buộc khi app khởi động.
- Cung cấp một object cấu hình readonly cho các module khác.

### Biến môi trường

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=vault_user
DB_PASSWORD=change_me
DB_NAME=password_vault
DB_POOL_SIZE=5
VAULT_AUTOLOCK_MINUTES=10
LOCAL_API_HOST=127.0.0.1
LOCAL_API_PORT=8765
```

### Public API đề xuất

```python
@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    db_pool_size: int
    vault_autolock_minutes: int
    local_api_host: str
    local_api_port: int


def load_settings() -> Settings:
    """Load .env/env, validate và trả về Settings."""
```

### Quy tắc

- `.env` không được commit Git.
- Không in `db_password`, master password, session key hoặc ciphertext ra log debug.
- Không tự generate master password hay DB password trong code runtime.

---

## 5. Module `db.py`

### Trách nhiệm

- Tạo và quản lý `mariadb.ConnectionPool` duy nhất cho toàn app.
- Cấp/trả connection an toàn qua context manager.
- Cung cấp transaction helper.
- Không chứa business logic và không chứa SQL theo bảng cụ thể.

### Public API đề xuất

```python
@contextmanager
def get_connection():
    """Mượn connection từ pool, trả lại pool khi kết thúc block."""


def init_pool(settings: Settings) -> None:
    """Khởi tạo pool một lần khi app startup."""


def close_pool() -> None:
    """Đóng pool khi app shutdown."""


@contextmanager
def transaction():
    """Yield cursor; commit khi thành công, rollback khi lỗi."""
```

### Ví dụ dùng

```python
from app.db import transaction

with transaction() as cursor:
    cursor.execute(
        "UPDATE vault_items SET favorite = ? WHERE id = ?",
        (1, item_id),
    )
```

### Quy tắc transaction

- Mọi thay đổi `INSERT`, `UPDATE`, `DELETE` dùng `transaction()`.
- Hàm đọc `SELECT` có thể dùng `get_connection()` và đóng cursor sau khi fetch.
- Query parameterized bắt buộc dùng placeholder `?`; không ghép chuỗi SQL bằng f-string với input người dùng.

---

## 6. Module `crypto.py`

### Trách nhiệm

- Derive key từ master password bằng Argon2id.
- Sinh/kiểm tra verifier để xác nhận master password đúng.
- Mã hóa và giải mã field bằng AES-256-GCM.
- Sinh salt, nonce an toàn bằng `os.urandom()`.
- Hoàn toàn không gọi database.

### Thuật toán và dữ liệu

| Hạng mục | Cách dùng |
|---|---|
| KDF | Argon2id |
| KDF salt | 16 bytes ngẫu nhiên, lưu ở `vault_meta` |
| Session encryption key | 32 bytes raw key derive từ master password + `kdf_salt` |
| Mã hóa | AES-256-GCM |
| Nonce AES-GCM | 12 bytes ngẫu nhiên, mới cho mỗi lần encrypt |
| Associated Data (AAD) | `vault_item_id + field_name`, để ciphertext không thể hoán đổi field/item |
| Password verifier | Một verifier derive riêng với `verifier_salt` riêng; không dùng ciphertext làm verifier |

### Public API đề xuất

```python
@dataclass(frozen=True)
class KdfParams:
    memory_cost: int
    time_cost: int
    parallelism: int


def generate_salt(length: int = 16) -> bytes:
    pass


def derive_key(master_password: str, salt: bytes, params: KdfParams) -> bytes:
    """Trả raw 32-byte key từ Argon2id."""


def create_verifier(master_password: str, params: KdfParams) -> tuple[bytes, bytes]:
    """Trả (verifier_hash, verifier_salt)."""


def verify_master_password(
    master_password: str,
    verifier_hash: bytes,
    verifier_salt: bytes,
    params: KdfParams,
) -> bool:
    pass


def encrypt_field(
    plaintext: str,
    key: bytes,
    aad: bytes,
) -> tuple[bytes, bytes]:
    """Trả (ciphertext, nonce)."""


def decrypt_field(
    ciphertext: bytes,
    nonce: bytes,
    key: bytes,
    aad: bytes,
) -> str:
    """Ném InvalidTag nếu ciphertext/nonce/key/AAD không hợp lệ."""
```

### Quy tắc bắt buộc

- Không dùng `hash()` của Python để tạo key.
- Không dùng ECB, CBC không có MAC, hoặc Fernet key hardcode.
- Không tái sử dụng nonce với cùng AES key.
- `bytes` là immutable nên không thể bảo đảm xóa tuyệt đối key khỏi RAM bằng Python; tuy vậy phải xóa mọi reference khi lock.
- Không trả plaintext password trong exception/log.

---

## 7. Module `exceptions.py`

### Trách nhiệm

Tập trung exception nghiệp vụ để API/UI xử lý nhất quán, không expose lỗi DB/crypto thô cho frontend.

### Exception đề xuất

```python
class VaultError(Exception):
    pass

class VaultNotInitializedError(VaultError):
    pass

class VaultLockedError(VaultError):
    pass

class InvalidMasterPasswordError(VaultError):
    pass

class CredentialNotFoundError(VaultError):
    pass

class DuplicateAutofillRuleError(VaultError):
    pass

class VaultIntegrityError(VaultError):
    """Ciphertext không xác thực được hoặc record có cấu trúc sai."""
    pass
```

---

## 8. Module `vault_repo.py`

### Trách nhiệm

- CRUD trực tiếp với `vault_meta`, `vault_items`, `autofill_rules`, `password_history`.
- Nhận/trả ciphertext, nonce dưới dạng `bytes`.
- Không derive key, không encrypt/decrypt, không quản lý session unlock.
- Chạy qua `db.py`; không tự tạo connection riêng.

### Data model truyền trong module

```python
@dataclass
class EncryptedField:
    ciphertext: bytes
    nonce: bytes

@dataclass
class VaultItemRecord:
    id: str
    title: str
    platform_type: str
    platform_identifier: str | None
    username: str
    password: EncryptedField
    totp_secret: EncryptedField | None
    url: str | None
    notes: EncryptedField | None
    tags: list[str]
    favorite: bool
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
```

### Public API đề xuất

```python
# vault_meta

def get_vault_meta() -> dict | None:
    pass


def create_vault_meta(meta: dict) -> None:
    pass

# vault_items

def insert_item(record: VaultItemRecord) -> str:
    pass


def get_item_by_id(item_id: str) -> VaultItemRecord | None:
    pass


def list_item_summaries(
    platform_type: str | None = None,
    search: str | None = None,
    favorite_only: bool = False,
) -> list[dict]:
    """Chỉ trả metadata + username plaintext, không trả encrypted fields."""


def update_item_metadata(item_id: str, **metadata) -> bool:
    pass


def update_item_password(item_id: str, encrypted_password: EncryptedField) -> bool:
    """Trigger DB tự thêm password cũ vào password_history."""


def delete_item(item_id: str) -> bool:
    pass


def mark_item_used(item_id: str) -> None:
    pass

# autofill_rules

def add_autofill_rule(
    item_id: str,
    match_type: str,
    match_value: str,
    field_role: str,
    priority: int = 0,
) -> str:
    pass


def list_autofill_rules(item_id: str) -> list[dict]:
    pass


def delete_autofill_rule(rule_id: str) -> bool:
    pass


def find_item_candidates(match_type: str, match_value: str) -> list[dict]:
    """Trả id/title/username/priority; không lấy hay decrypt password."""

# history

def list_password_history(item_id: str) -> list[dict]:
    pass
```

### Query cần đảm bảo

- `tags` lưu JSON text, parse bằng `json.loads()` khi trả object.
- `username` plaintext cho phép search `LIKE ?`; phải escape `%` và `_` nếu search là literal.
- Mọi BLOB truyền thẳng dạng `bytes`; không base64 trước khi ghi MariaDB trừ khi đi qua JSON API.
- `get_item_by_id()` phải lấy đủ nonce tương ứng của từng field.

---

## 9. Module `vault_service.py`

### Trách nhiệm

Đây là **lớp nghiệp vụ trung tâm** và là nơi duy nhất được phép giữ session encryption key. UI, API và agent gọi các hàm ở đây, không gọi thẳng repo để lấy credential nhạy cảm.

### State trong memory

```python
class VaultService:
    _session_key: bytes | None
    _unlocked_at: datetime | None
    _last_activity_at: datetime | None
    _auto_lock_seconds: int
```

### Public API đề xuất

```python
class VaultService:
    def initialize(self, master_password: str) -> None:
        """Tạo meta khi vault hoàn toàn mới; lỗi nếu meta đã tồn tại."""

    def unlock(self, master_password: str) -> None:
        """Verify master password, derive và giữ session key trong RAM."""

    def lock(self) -> None:
        """Bỏ mọi reference session key và trạng thái unlock."""

    def is_unlocked(self) -> bool:
        pass

    def check_auto_lock(self) -> bool:
        """Nếu idle quá timeout thì lock; trả True nếu vừa lock."""

    def add_credential(
        self,
        title: str,
        platform_type: str,
        username: str,
        password: str,
        platform_identifier: str | None = None,
        url: str | None = None,
        notes: str | None = None,
        totp_secret: str | None = None,
        tags: list[str] | None = None,
        rules: list[dict] | None = None,
    ) -> str:
        pass

    def list_credentials(self, **filters) -> list[dict]:
        """Không yêu cầu unlock nếu chỉ trả metadata + username."""

    def get_credential(self, item_id: str, include_secrets: bool = True) -> dict:
        """Nếu include_secrets=True thì yêu cầu vault unlocked."""

    def update_credential_metadata(self, item_id: str, **metadata) -> None:
        pass

    def change_password(self, item_id: str, new_password: str) -> None:
        pass

    def delete_credential(self, item_id: str) -> None:
        pass

    def get_totp_code(self, item_id: str, now: datetime | None = None) -> str:
        """Decrypt TOTP secret khi cần, generate code; không lưu code xuống DB."""
```

### Luồng `initialize()`

```text
1. Validate master password không rỗng.
2. Kiểm tra vault_meta chưa tồn tại.
3. Tạo kdf_salt.
4. Derive session key = Argon2id(master_password, kdf_salt).
5. Tạo verifier_hash + verifier_salt riêng.
6. Ghi vault_meta qua vault_repo.create_vault_meta().
7. Giữ session key trong RAM, vault được coi là unlock.
```

### Luồng `unlock()`

```text
1. Đọc vault_meta.
2. Lấy KdfParams từ DB.
3. Verify master password bằng verifier.
4. Nếu sai: ném InvalidMasterPasswordError; không log password.
5. Nếu đúng: derive session key từ kdf_salt.
6. Set _unlocked_at và _last_activity_at.
```

### Luồng `add_credential()`

```text
1. check_auto_lock(); require vault unlocked.
2. Validate title/platform_type/username/password.
3. Sinh item_id UUID trước để dùng làm AAD.
4. Mã hóa password với AAD = f"{item_id}:password".
5. Nếu có notes/TOTP: mã hóa từng field với AAD riêng.
6. Build VaultItemRecord; username giữ plaintext.
7. Trong 1 DB transaction:
   - insert vault_items
   - insert từng autofill_rule (nếu có)
8. Cập nhật last activity.
9. Trả item_id.
```

### Luồng `get_credential()`

```text
1. check_auto_lock().
2. Repo lấy record encrypted theo item_id.
3. Nếu không tồn tại: CredentialNotFoundError.
4. Nếu chỉ xem metadata: trả ngay summary.
5. require vault unlocked.
6. Decrypt password bằng AAD đúng item_id/field_name.
7. Chỉ decrypt notes và TOTP nếu caller thật sự yêu cầu.
8. Không cache password plaintext lâu hơn request hiện tại.
9. Cập nhật last_used_at nếu đây là action autofill/copy.
```

### Validation đề xuất

| Field | Rule |
|---|---|
| `title` | 1–255 ký tự, trim whitespace |
| `platform_type` | Một trong `web`, `desktop_app`, `android_app`, `other` |
| `username` | Không rỗng; plaintext theo yêu cầu |
| `password` | Không rỗng khi tạo credential login; không log |
| `platform_identifier` | Domain, executable/window title hoặc package name tùy type |
| `url` | Nếu có, phải bắt đầu bằng `https://` hoặc `http://` |
| `tags` | List string, normalize lowercase/trim, bỏ duplicate |
| `rules` | `match_type` phải thuộc tập cho phép; reject regex quá dài/nguy hiểm |

---

## 10. Module `autofill_matcher.py`

### Trách nhiệm

- Nhận context từ desktop agent/browser extension.
- Chuẩn hóa domain, executable/window title hoặc app package.
- Tìm credential candidate theo `autofill_rules`.
- Không decrypt password trong bước tìm kiếm/gợi ý.

### Input context

```python
@dataclass(frozen=True)
class AutofillContext:
    source: str                    # "browser", "desktop", "android"
    domain: str | None = None
    process_name: str | None = None
    window_title: str | None = None
    package_name: str | None = None
```

### Public API đề xuất

```python
def normalize_domain(url_or_host: str) -> str:
    """Lowercase, bỏ port/path, xử lý www. theo policy rõ ràng."""

def find_candidates(context: AutofillContext) -> list[dict]:
    """Trả item_id/title/username/priority; tuyệt đối không trả password."""

def choose_best_candidate(candidates: list[dict]) -> dict | None:
    """Ưu tiên priority rồi last_used_at/favorite; vẫn để user xác nhận nếu >1 candidate."""
```

### Chiến lược match

| Nguồn | Rule | Ví dụ match_value |
|---|---|---|
| Browser | `domain` | `accounts.google.com` hoặc `google.com` |
| Windows desktop | `window_title_regex` | `^.*VPN Client.*$` |
| Windows desktop | `process_name` (nếu bổ sung) | `telegram.exe` |
| Android automation | `android_package` | `com.zhiliaoapp.musically` |
| UI automation | `resource_id_hint` | `com.app:id/password` |

### Quy tắc an toàn

- Browser: so khớp exact host trước; không tự coi `evil-google.com` là `google.com`.
- Regex window title: compile có timeout/giới hạn độ dài nếu regex do user nhập.
- Nếu nhiều candidate cùng điểm: trả danh sách cho UI chọn, không tự điền ngẫu nhiên.
- Chỉ sau khi user/agent xác định `item_id` mới gọi `vault_service.get_credential()`.

---

## 11. Module `autofill_agent` (adapter theo OS)

Module này nên tách theo nền tảng vì nó phụ thuộc OS, không thuộc vault core.

```text
app/autofill/
├── base.py
├── windows_agent.py
├── browser_native_host.py
└── android_uiautomator_adapter.py      # chỉ nếu tái dùng cho TikTool
```

### `base.py`

```python
class AutofillAdapter(Protocol):
    def get_context(self) -> AutofillContext:
        pass

    def fill_username(self, username: str) -> None:
        pass

    def fill_password(self, password: str) -> None:
        pass
```

### `windows_agent.py`

- Đăng ký global hotkey.
- Lấy active window/process qua Win32 API.
- Dùng UI Automation nếu app đích expose control tree.
- Fallback Auto-Type (`username -> TAB -> password`) nếu không có UI Automation.
- Không chạy trong Docker; phải là native process trên Windows.

### `browser_native_host.py`

- Giao tiếp Native Messaging stdin/stdout với browser extension.
- Nhận domain/tab context.
- Chỉ trả candidate metadata khi vault lock.
- Chỉ trả secret sau unlock và sau khi extension gửi request hợp lệ theo protocol local.

---

## 12. Module `api.py` (tùy chọn)

Chỉ cần nếu desktop UI, extension hoặc automation script cần gọi vault qua HTTP local.

### Ràng buộc triển khai

- Bind duy nhất `127.0.0.1`, không bind `0.0.0.0` mặc định.
- Tạo local API token ngẫu nhiên khi app startup; token chỉ sống trong RAM.
- Không expose endpoint bulk-export plaintext password.
- Không log request body của endpoint có master password/password.

### Endpoint tối thiểu

| Method | Path | Chức năng |
|---|---|---|
| `POST` | `/v1/vault/unlock` | Unlock vault, trả trạng thái chứ không trả key |
| `POST` | `/v1/vault/lock` | Lock và xóa session key |
| `GET` | `/v1/items` | List metadata + username |
| `POST` | `/v1/items` | Add credential |
| `GET` | `/v1/items/{id}` | Lấy metadata; secret chỉ khi có quyền/unlock |
| `PATCH` | `/v1/items/{id}` | Update metadata/password |
| `DELETE` | `/v1/items/{id}` | Xóa credential |
| `POST` | `/v1/autofill/candidates` | Tìm candidate từ domain/window context |
| `POST` | `/v1/autofill/fill-data` | Trả username/password cho item đã chọn; yêu cầu unlocked |

### HTTP status gợi ý

| Tình huống | Status |
|---|---|
| Vault chưa tạo | 409 |
| Vault locked | 423 |
| Master password sai | 401 |
| Item không tồn tại | 404 |
| Validation lỗi | 422 |
| Ciphertext integrity lỗi | 500, không trả chi tiết crypto |

---

## 13. Module `audit_service.py` (tùy chọn)

### Mục tiêu

Theo dõi action tối thiểu mà không ghi secret vào log.

### Event nên lưu

```text
VAULT_INITIALIZED
VAULT_UNLOCKED
VAULT_LOCKED
CREDENTIAL_CREATED
CREDENTIAL_UPDATED
PASSWORD_CHANGED
CREDENTIAL_DELETED
AUTOFILL_REQUESTED
AUTOFILL_COMPLETED
```

### Tuyệt đối không lưu

- Master password.
- Session key.
- Plaintext password/TOTP/notes.
- Ciphertext đầy đủ trong application log.

Nếu chỉ dùng cá nhân, audit log có thể để phase sau. Nó hữu ích hơn khi debug autofill hoặc phát hiện app tự gọi API bất thường.

---

## 14. MariaDB schema và migration

### Bảng tối thiểu

```text
vault_meta          # 1 row: KDF params, salts, verifier
vault_items         # credentials + encrypted secret fields
password_history    # password ciphertext cũ
autofill_rules      # rules để match target
```

### Kiểu dữ liệu MariaDB gợi ý

| Ý nghĩa | Kiểu |
|---|---|
| UUID | `CHAR(36)` hoặc `BINARY(16)` |
| Username/title/domain | `VARCHAR(...)` |
| Ciphertext/nonce/salt | `BLOB` hoặc `VARBINARY(...)` |
| Tags | `JSON` (nếu MariaDB version phù hợp) hoặc `TEXT` chứa JSON |
| Timestamp | `DATETIME(6)` hoặc `TIMESTAMP` |
| Platform/match type | `ENUM(...)` hoặc `VARCHAR` + validation tại service |

### Migration workflow

1. Không sửa trực tiếp file migration đã chạy trên DB.
2. Mỗi thay đổi schema tạo file mới: `002_add_process_name_rule.sql`.
3. Có bảng `schema_migrations(version, applied_at)` để ghi version đã apply.
4. `migration_runner.py` chạy các file chưa apply trong transaction nếu MariaDB cho phép cho loại DDL đó.
5. Backup DB trước migration thay đổi BLOB/crypto fields.

---

## 15. Luồng nghiệp vụ chính

### A. Khởi tạo lần đầu

```text
Desktop UI/CLI
  -> VaultService.initialize(master_password)
  -> Crypto: sinh KDF salt + derive key + verifier
  -> VaultRepo: INSERT vault_meta
  -> VaultService giữ session key trong RAM
```

### B. Thêm một credential

```text
UI/API nhận title, username, password
  -> VaultService.require_unlocked()
  -> Tạo UUID item_id
  -> Crypto.encrypt_field(password, key, AAD=item_id:password)
  -> Crypto.encrypt_field(notes/TOTP nếu có)
  -> VaultRepo.insert_item(ciphertext, nonce, username plaintext, metadata)
  -> VaultRepo.add_autofill_rule(...) nếu có
  -> commit transaction
```

### C. Gợi ý autofill

```text
Browser extension / Windows agent lấy context
  -> AutofillMatcher.find_candidates(context)
  -> VaultRepo.find_item_candidates(...)
  -> Trả danh sách title + username (không password)
  -> User chọn entry
  -> VaultService.get_credential(item_id)
  -> Crypto.decrypt_field(password, đúng AAD)
  -> Adapter điền vào app/browser
  -> VaultRepo.mark_item_used(item_id)
```

### D. Đổi password

```text
UI/API gửi password mới
  -> VaultService.require_unlocked()
  -> Crypto.encrypt_field(password mới)
  -> VaultRepo.update_item_password(...)
  -> MariaDB trigger insert ciphertext/password nonce cũ vào password_history
  -> commit
```

### E. Auto-lock

```text
Mỗi request/action hoặc background timer
  -> VaultService.check_auto_lock()
  -> Nếu now - last_activity > timeout:
       VaultService.lock()
       xóa reference session key
       agent/API từ chối request secret với VaultLockedError
```

---

## 16. Thứ tự triển khai khuyến nghị

### Phase 1 — Vault core không UI

1. Viết MariaDB schema/migration `001_initial_schema.sql`.
2. Hoàn thiện `config.py` và `db.py`, test connection MariaDB.
3. Viết `crypto.py`, test encrypt/decrypt/AAD/verifier.
4. Viết `vault_repo.py`, test CRUD encrypted blob.
5. Viết `vault_service.py`, test initialize/unlock/add/get/change/lock.

**Done criteria:** Có CLI nhỏ thêm credential, list credential và decrypt password khi vault unlocked.

### Phase 2 — Quản lý credential

1. Thêm `autofill_rules` CRUD.
2. Thêm password history.
3. Thêm filter/search metadata theo username/title/tag/platform.
4. Thêm migration runner.
5. Bổ sung unit/integration tests với MariaDB test database.

**Done criteria:** Có thể quản lý entry và rules đầy đủ, reboot app vẫn unlock/decrypt đúng với master password.

### Phase 3 — Autofill desktop/browser

1. `autofill_matcher.py` với exact domain matching.
2. Windows agent hotkey + active window detection.
3. UI confirmation chọn credential nếu nhiều candidate.
4. Native Messaging host + browser extension.
5. Auto-lock, local token, audit event cơ bản.

**Done criteria:** Browser/app desktop nhận đúng username/password chỉ sau khi vault unlock và user xác nhận.

### Phase 4 — Hardening

1. Fuzz/negative test ciphertext bị sửa, nonce sai, AAD sai.
2. Rà soát log để chắc chắn không log secret.
3. DB account quyền tối thiểu (`SELECT/INSERT/UPDATE/DELETE` đúng schema, không root).
4. Backup DB encrypted; kiểm tra restore.
5. Code signing/packaging desktop agent nếu phát hành.

---

## 17. Test plan tối thiểu

### `test_crypto.py`

- Encrypt/decrypt cùng key + nonce + AAD trả đúng plaintext.
- Sai key, nonce, AAD hoặc ciphertext bị đổi phải fail.
- Hai lần encrypt cùng plaintext phải có nonce/ciphertext khác.
- Master password đúng verify thành công; sai thất bại.

### `test_vault_repo.py`

- Insert/get BLOB không bị biến đổi byte.
- Delete `vault_items` cascade xóa rules/history.
- Update password tạo history đúng (nếu dùng trigger).
- Query candidate không trả cột password ciphertext nếu API query chỉ cần summary.

### `test_vault_service.py`

- Không thể add/get secret khi locked.
- `initialize` chạy lần hai fail.
- Unlock master password sai fail.
- Add → lock → unlock → decrypt vẫn đúng.
- Change password → current password đúng, history có ciphertext cũ.
- Auto-lock xóa trạng thái unlock.

### `test_autofill_matcher.py`

- `accounts.google.com` không match domain giả `accounts.google.com.evil.tld`.
- Nhiều candidate trả theo `priority`.
- Candidate list không chứa password.

---

## 18. Checklist an toàn trước khi dùng dữ liệu thật

- [ ] MariaDB user riêng, không dùng `root`.
- [ ] DB chỉ bind localhost nếu không cần remote access.
- [ ] `.env` trong `.gitignore`; đã kiểm tra Git history không chứa secret.
- [ ] `password_encrypted`, `notes_encrypted`, `totp_secret_encrypted` là BLOB ciphertext, không phải plaintext.
- [ ] Key derive từ master password chỉ lưu RAM khi unlocked.
- [ ] Nonce AES-GCM sinh ngẫu nhiên mới cho từng lần encrypt.
- [ ] AAD buộc ciphertext thuộc đúng `item_id` và field name.
- [ ] Không log master password, password, TOTP hoặc session key.
- [ ] App tự lock sau idle timeout.
- [ ] DB backup được tạo từ ciphertext đã mã hóa và restore thử thành công.
- [ ] Không expose API ra `0.0.0.0` nếu không có cơ chế auth/TLS thiết kế đầy đủ.

---

## 19. Quyết định thiết kế hiện tại

| Quyết định | Lý do |
|---|---|
| MariaDB | Bạn đã tạo DB/schema MariaDB và muốn một hàm truy cập DB dùng chung |
| Raw SQL repository | Ít bảng, kiểm soát rõ BLOB/ciphertext, dễ đối chiếu schema SQL hiện tại |
| Username plaintext | Theo yêu cầu; thuận tiện list/search khi vault khóa |
| Password/TOTP/notes encrypted | Giảm rủi ro DB backup/file DB bị lộ |
| Argon2id | Derive key từ master password với chi phí brute-force cao |
| AES-256-GCM + AAD | Confidentiality + integrity, ràng buộc ciphertext đúng item/field |
| Session key chỉ RAM | Không tạo file key hoặc lưu key trong MariaDB |
| Browser/desktop adapters tách core | Không để logic Windows/UI/browser làm phức tạp vault core |

---

## 20. Bước tiếp theo

Thứ tự file nên bắt đầu viết:

1. `config.py`
2. `db.py`
3. `crypto.py` + test crypto
4. MariaDB migration `001_initial_schema.sql`
5. `vault_repo.py`
6. `vault_service.py`
7. CLI test ở `main.py`
8. `autofill_matcher.py`
9. Agent desktop/browser API

Bắt đầu từ `crypto.py` và test của nó trước. Nếu crypto layer sai, toàn bộ dữ liệu đã ghi xuống DB có thể không giải mã được về sau; còn UI/API/autofill có thể bổ sung sau mà không làm thay đổi format mã hóa.
