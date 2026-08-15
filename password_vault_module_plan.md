# Kế hoạch module — Local Autofill Credential Store (Plaintext)

> **Phạm vi thiết kế:** Hệ thống này lưu username và password ở dạng plaintext trong MariaDB để phục vụ autofill và quản lý credential cục bộ trên một máy.
>
> **Cảnh báo:** Không có lớp mã hóa ở application/database. Bất kỳ ai, process nào hoặc backup nào có quyền đọc database đều có thể đọc trực tiếp toàn bộ username/password. Thiết kế này chỉ phù hợp dữ liệu test, tài khoản automation không quan trọng, hoặc môi trường local được kiểm soát nghiêm ngặt. Không dùng cho ngân hàng, email chính, ví tiền số, production secrets, API key quan trọng hoặc dữ liệu cá nhân nhạy cảm.

---

## 1. Mục tiêu và phạm vi

Hệ thống là credential store local chạy trên máy tính, dùng **MariaDB** để lưu và tra cứu nhanh thông tin đăng nhập cho desktop autofill agent, browser extension hoặc automation script.

### Mục tiêu chính

- Lưu `username` và `password` nguyên văn (plaintext) để thao tác autofill nhanh.
- Lưu thông tin nền tảng, URL/domain, executable/window title và rule autofill.
- Hỗ trợ CRUD credential, tìm kiếm theo title/username/platform/tag.
- Hỗ trợ password history nếu bạn muốn rollback password cũ.
- Tách rõ tầng truy cập database, repository, service và adapter autofill.
- Không có `crypto.py`, master password, vault unlock/lock, session key, KDF hay nonce.

### Ngoài phạm vi

- Mã hóa password trong DB hoặc trên đường truyền.
- Master password và cơ chế unlock vault.
- Đồng bộ Internet/multi-device.
- Multi-user và chia sẻ credential.
- Recovery, access control phức tạp, audit compliance.

---

## 2. Rủi ro và giới hạn

Vì password lưu plaintext, các tình huống sau làm lộ toàn bộ credential:

- Người khác đăng nhập được vào MariaDB bằng user có quyền đọc bảng.
- Malware hoặc process chạy cùng user đọc `.env`, source code, dump/backup DB hoặc gọi local API.
- Bạn export database, copy volume Docker hoặc backup sang cloud/USB không bảo vệ.
- Máy bị mất, bị remote-control, hoặc bị truy cập bởi người có quyền admin/root.
- Endpoint API local bị bind sai sang LAN/Internet hoặc không có token xác thực.

### Biện pháp tối thiểu vẫn nên có

- MariaDB bind `127.0.0.1` nếu không cần máy khác truy cập.
- Dùng user MariaDB riêng, quyền tối thiểu; không dùng `root` trong app.
- `.env` phải nằm trong `.gitignore`; không commit password DB.
- Docker volume/database dump/backup phải được bảo vệ bởi quyền file/ổ đĩa mã hóa (BitLocker/LUKS) nếu có dữ liệu thật.
- API local chỉ bind `127.0.0.1` và dùng local token ngẫu nhiên theo phiên.
- Không log password hoặc request body chứa password.
- Chỉ autofill sau hotkey hoặc hành động rõ ràng của user, không tự động điền âm thầm.

---

## 3. Kiến trúc tổng thể

```text
Desktop UI / CLI / Local API / Browser Extension / Autofill Agent
                              |
                              v
                      credential_service.py
                         |              |
                         v              v
               credential_repo.py      validator.py
                         |
                         v
                       db.py
                         |
                         v
                      MariaDB
```

### Quy tắc phụ thuộc

```text
UI/API/Agent -> credential_service -> credential_repo -> db
                         |
                         -> validator
matcher -> credential_repo
```

- `db.py` chỉ quản lý connection pool/transaction.
- `credential_repo.py` chỉ chứa SQL CRUD theo schema.
- `credential_service.py` là nơi áp dụng validation và workflow nghiệp vụ.
- `autofill_matcher.py` tìm candidate; không tự gửi phím hay điền password.
- Adapter theo OS/browser là nơi thực thi action autofill.

---

## 4. Cấu trúc thư mục đề xuất

```text
password-store/
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── db.py
│   ├── exceptions.py
│   ├── validator.py
│   ├── credential_repo.py
│   ├── credential_service.py
│   ├── autofill_matcher.py
│   ├── audit_service.py                 # optional
│   ├── api.py                            # optional Flask/FastAPI local API
│   └── autofill/
│       ├── base.py
│       ├── windows_agent.py
│       └── browser_native_host.py
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_*.sql
├── tests/
│   ├── test_validator.py
│   ├── test_credential_repo.py
│   ├── test_credential_service.py
│   └── test_autofill_matcher.py
├── .env
├── .env.example
├── .gitignore
├── requirements.txt
└── main.py
```

---

## 5. Schema MariaDB mới

Schema này thay thế schema vault có cột `*_encrypted`, `*_nonce`, `vault_meta`, `kdf_*`, `verifier_*`.

### 5.1 Bảng `credentials`

```sql
CREATE TABLE IF NOT EXISTS credentials (
    id                  CHAR(36) NOT NULL PRIMARY KEY,

    title               VARCHAR(255) NOT NULL,
    platform_type       ENUM('web', 'desktop_app', 'android_app', 'other') NOT NULL,
    platform_identifier VARCHAR(512) NULL,

    username            VARCHAR(512) NOT NULL,
    password            TEXT NOT NULL,
    totp_secret         VARCHAR(512) NULL,
    notes               TEXT NULL,

    url                 VARCHAR(2048) NULL,
    tags                JSON NULL,
    favorite            BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                        ON UPDATE CURRENT_TIMESTAMP(6),
    last_used_at        DATETIME(6) NULL,

    INDEX idx_credentials_platform (platform_type, platform_identifier),
    INDEX idx_credentials_username (username),
    INDEX idx_credentials_title (title),
    INDEX idx_credentials_favorite (favorite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 Bảng `autofill_rules`

Một credential có thể có nhiều điều kiện match: domain cho web, executable/window title cho desktop app hoặc package name cho Android.

```sql
CREATE TABLE IF NOT EXISTS autofill_rules (
    id                CHAR(36) NOT NULL PRIMARY KEY,
    credential_id     CHAR(36) NOT NULL,

    match_type        ENUM(
                          'domain',
                          'exact_url',
                          'process_name',
                          'window_title_regex',
                          'android_package',
                          'resource_id_hint'
                      ) NOT NULL,
    match_value       VARCHAR(2048) NOT NULL,
    priority          INT NOT NULL DEFAULT 0,
    is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,

    created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                      ON UPDATE CURRENT_TIMESTAMP(6),

    CONSTRAINT fk_autofill_rules_credential
        FOREIGN KEY (credential_id)
        REFERENCES credentials(id)
        ON DELETE CASCADE,

    INDEX idx_autofill_rules_match (match_type, match_value),
    INDEX idx_autofill_rules_credential (credential_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.3 Bảng `password_history` (tùy chọn)

Nếu không cần rollback password, bỏ cả bảng và trigger này.

```sql
CREATE TABLE IF NOT EXISTS password_history (
    id                CHAR(36) NOT NULL PRIMARY KEY,
    credential_id     CHAR(36) NOT NULL,
    password          TEXT NOT NULL,
    changed_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT fk_password_history_credential
        FOREIGN KEY (credential_id)
        REFERENCES credentials(id)
        ON DELETE CASCADE,

    INDEX idx_password_history_credential (credential_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.4 Trigger lưu password cũ (tùy chọn)

```sql
DELIMITER //

CREATE TRIGGER trg_credentials_password_history
BEFORE UPDATE ON credentials
FOR EACH ROW
BEGIN
    IF NOT (OLD.password <=> NEW.password) THEN
        INSERT INTO password_history (id, credential_id, password, changed_at)
        VALUES (UUID(), OLD.id, OLD.password, CURRENT_TIMESTAMP(6));
    END IF;
END//

DELIMITER ;
```

### 5.5 Bảng migration (khuyến nghị)

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version           VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Ghi chú schema

- Password là `TEXT` plaintext; **không có** `password_encrypted`, `password_nonce`.
- `totp_secret` và `notes` cũng plaintext theo yêu cầu bỏ crypto; có thể bỏ hai cột nếu không cần.
- UUID được tạo ở Python bằng `str(uuid.uuid4())`; không nên phụ thuộc trigger để tạo ID chính.
- `JSON` cho `tags` phù hợp nếu MariaDB của bạn hỗ trợ JSON. Nếu muốn tương thích tối đa, dùng `TEXT` chứa JSON array.
- Với web, dùng `autofill_rules.match_type = 'domain'` để match host; `url` chỉ là metadata/hiển thị.

---

## 6. Module `config.py`

### Trách nhiệm

- Load cấu hình từ OS environment/.env.
- Validate DB config và local API config.
- Không chứa credential app hardcode.

### Biến môi trường

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=credential_store_user
DB_PASSWORD=change_me
DB_NAME=credential_store
DB_POOL_SIZE=5
LOCAL_API_HOST=127.0.0.1
LOCAL_API_PORT=8765
LOCAL_API_TOKEN=generate_a_long_random_value
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
    local_api_host: str
    local_api_port: int
    local_api_token: str


def load_settings() -> Settings:
    pass
```

---

## 7. Module `db.py`

### Trách nhiệm

- Tạo `mariadb.ConnectionPool` singleton.
- Cấp connection qua context manager.
- Commit/rollback transaction.
- Không biết tên bảng và không chứa logic credential.

### Public API đề xuất

```python
from contextlib import contextmanager


def init_pool(settings: Settings) -> None:
    pass


@contextmanager
def get_connection():
    """Yield MariaDB connection; close() sẽ trả về pool."""
    pass


@contextmanager
def transaction(dictionary: bool = False):
    """Yield cursor, commit nếu thành công và rollback nếu có exception."""
    pass


def close_pool() -> None:
    pass
```

### Quy tắc

- Luôn parameterize SQL bằng placeholder `?` của MariaDB Connector/Python.
- Không đưa password vào SQL string bằng f-string/format.
- `transaction()` dùng cho create/update/delete và insert rule đi kèm credential.

---

## 8. Module `exceptions.py`

```python
class CredentialStoreError(Exception):
    pass

class CredentialNotFoundError(CredentialStoreError):
    pass

class ValidationError(CredentialStoreError):
    pass

class DuplicateRuleError(CredentialStoreError):
    pass

class LocalApiUnauthorizedError(CredentialStoreError):
    pass
```

Không cần các exception liên quan crypto như `VaultLockedError`, `InvalidMasterPasswordError` hoặc `VaultIntegrityError` vì phiên bản này không có vault encryption/unlock.

---

## 9. Module `validator.py`

### Trách nhiệm

- Validate và normalize input trước khi ghi DB.
- Không query DB, không tự lưu dữ liệu.

### Public API đề xuất

```python
VALID_PLATFORM_TYPES = {'web', 'desktop_app', 'android_app', 'other'}
VALID_MATCH_TYPES = {
    'domain', 'exact_url', 'process_name',
    'window_title_regex', 'android_package', 'resource_id_hint',
}


def validate_credential_input(data: dict) -> dict:
    """Trim/normalize, raise ValidationError nếu input không hợp lệ."""


def validate_rule_input(rule: dict) -> dict:
    pass


def normalize_domain(value: str) -> str:
    """Lấy lowercase hostname, không tự match suffix nguy hiểm."""


def normalize_tags(tags: list[str] | None) -> list[str]:
    pass
```

### Rule validation

| Field | Quy tắc |
|---|---|
| `title` | 1–255 ký tự sau trim |
| `platform_type` | `web`, `desktop_app`, `android_app`, `other` |
| `username` | Không rỗng, tối đa 512 ký tự |
| `password` | Không rỗng khi tạo/update password; không log |
| `url` | Nếu có, `http://` hoặc `https://` |
| `tags` | List string, lowercase/trim/bỏ duplicate |
| `match_type` | Nằm trong tập cho phép |
| `window_title_regex` | Giới hạn độ dài; chỉ compile để kiểm tra syntax, không execute trên input không kiểm soát nếu chưa có timeout |

---

## 10. Module `credential_repo.py`

### Trách nhiệm

- CRUD với bảng `credentials`, `autofill_rules`, `password_history`.
- Trả password plaintext **chỉ ở các hàm explicit cần secret**.
- Không có logic autofill UI, không gửi phím/clipboard.

### Data model gợi ý

```python
@dataclass
class CredentialRecord:
    id: str
    title: str
    platform_type: str
    platform_identifier: str | None
    username: str
    password: str
    totp_secret: str | None
    notes: str | None
    url: str | None
    tags: list[str]
    favorite: bool
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
```

### Public API đề xuất

```python
# credentials

def insert_credential(record: CredentialRecord) -> str:
    pass


def get_credential_by_id(item_id: str, include_password: bool = False) -> dict | None:
    """Mặc định không select password/totp/notes để giảm exposure không cần thiết."""


def list_credential_summaries(
    platform_type: str | None = None,
    search: str | None = None,
    favorite_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    pass


def update_credential_metadata(item_id: str, data: dict) -> bool:
    pass


def update_credential_password(item_id: str, new_password: str) -> bool:
    """Trigger sẽ lưu password cũ vào password_history nếu trigger được bật."""


def delete_credential(item_id: str) -> bool:
    pass


def mark_credential_used(item_id: str) -> None:
    pass

# autofill rules

def add_autofill_rule(credential_id: str, rule: dict) -> str:
    pass


def list_autofill_rules(credential_id: str) -> list[dict]:
    pass


def update_autofill_rule(rule_id: str, rule: dict) -> bool:
    pass


def delete_autofill_rule(rule_id: str) -> bool:
    pass


def find_candidates(match_type: str, match_value: str) -> list[dict]:
    """Trả id/title/username/priority/favorite/last_used_at, không select password."""

# password history optional

def list_password_history(credential_id: str) -> list[dict]:
    pass
```

### Phân tách query summary và secret

```python
# Dùng cho list/search/autofill suggestion.
SELECT id, title, platform_type, platform_identifier, username,
       url, tags, favorite, last_used_at
FROM credentials
...

# Chỉ dùng khi chuẩn bị điền password sau khi đã chọn item.
SELECT id, username, password, totp_secret
FROM credentials
WHERE id = ?
```

Dù DB là plaintext, vẫn tách query như vậy để password không bị load nhầm vào memory/log/response khi không cần.

---

## 11. Module `credential_service.py`

### Trách nhiệm

Là lớp nghiệp vụ trung tâm. Module này không cần crypto/session key, nhưng cần kiểm soát workflow và hạn chế lúc password plaintext được đưa ra ngoài.

### Public API đề xuất

```python
class CredentialService:
    def create_credential(self, data: dict, rules: list[dict] | None = None) -> str:
        """Validate -> tạo UUID -> insert credential + rules trong 1 transaction."""

    def list_credentials(self, **filters) -> list[dict]:
        """Chỉ trả summary, không password."""

    def get_credential_summary(self, credential_id: str) -> dict:
        pass

    def get_autofill_payload(self, credential_id: str) -> dict:
        """Trả username/password chỉ sau khi caller đã chọn credential cụ thể."""

    def update_credential(self, credential_id: str, data: dict) -> None:
        """Update metadata và/hoặc password."""

    def delete_credential(self, credential_id: str) -> None:
        pass

    def add_rule(self, credential_id: str, rule: dict) -> str:
        pass

    def find_autofill_candidates(self, context: AutofillContext) -> list[dict]:
        pass
```

### Luồng `create_credential()`

```text
1. validate_credential_input(data).
2. Tạo credential_id bằng uuid.uuid4().
3. Build CredentialRecord; password giữ nguyên plaintext.
4. Begin transaction.
5. INSERT credentials.
6. Validate và INSERT từng autofill_rule.
7. Commit; nếu một rule lỗi thì rollback cả credential và rule.
8. Trả credential_id.
```

### Luồng `get_autofill_payload()`

```text
1. Lấy credential theo id với include_password=True.
2. Nếu không tồn tại: CredentialNotFoundError.
3. Lấy đúng field cần dùng: username, password, optional totp_secret.
4. Cập nhật last_used_at.
5. Trả payload cho adapter nội bộ.
6. Không ghi payload vào log, không cache dài hạn, không trả toàn bộ notes/history.
```

### Luồng `update_credential()`

```text
1. Validate các field được phép update.
2. Nếu password thay đổi: gọi update_credential_password(); trigger history (nếu có) chạy tự động.
3. Update metadata/title/username/url/tags/favorite ở query riêng hoặc cùng transaction.
4. Không trả password trong response update.
```

---

## 12. Module `autofill_matcher.py`

### Trách nhiệm

- Chuẩn hóa context của browser/app.
- Tìm rule phù hợp và trả candidate metadata.
- Quyết định thứ tự gợi ý; không tự điền password.

### Data model

```python
@dataclass(frozen=True)
class AutofillContext:
    source: str                  # browser | desktop | android
    domain: str | None = None
    url: str | None = None
    process_name: str | None = None
    window_title: str | None = None
    package_name: str | None = None
```

### Public API đề xuất

```python
def build_match_requests(context: AutofillContext) -> list[tuple[str, str]]:
    """VD browser: [('exact_url', url), ('domain', normalized_domain)]."""

def find_candidates(context: AutofillContext) -> list[dict]:
    pass

def rank_candidates(candidates: list[dict]) -> list[dict]:
    """priority giảm dần -> favorite -> last_used_at mới nhất."""
```

### Quy tắc matching

| Nguồn | Match type ưu tiên | Ví dụ |
|---|---|---|
| Browser | `exact_url`, rồi `domain` | `https://accounts.example.com/login`, `accounts.example.com` |
| Desktop app | `process_name`, rồi `window_title_regex` | `telegram.exe`, `^.*Telegram.*$` |
| Android automation | `android_package` | `com.zhiliaoapp.musically` |
| UI automation | `resource_id_hint` | `com.example:id/password` |

### Ràng buộc an toàn

- Không match domain bằng `endswith()` tùy tiện; `google.com.evil.tld` không được match `google.com`.
- Nếu có nhiều credential phù hợp, UI phải hiển thị danh sách để người dùng chọn; không tự chọn bừa chỉ dựa vào username.
- Candidate response không có `password`.

---

## 13. Module `autofill` adapters

```text
app/autofill/
├── base.py
├── windows_agent.py
└── browser_native_host.py
```

### `base.py`

```python
class AutofillAdapter(Protocol):
    def get_context(self) -> AutofillContext:
        pass

    def fill(self, username: str, password: str) -> None:
        pass
```

### `windows_agent.py`

Trách nhiệm:

- Đăng ký global hotkey, ví dụ `Ctrl+Alt+A`.
- Lấy active window/process qua Win32 API.
- Gọi `CredentialService.find_autofill_candidates()`.
- Hiển thị popup chọn credential nếu có nhiều candidate.
- Sau chọn: gọi `get_autofill_payload()` và dùng UI Automation/Auto-Type để điền.
- Xóa reference payload sau khi action hoàn tất.

### `browser_native_host.py`

Trách nhiệm:

- Giao tiếp với browser extension qua Native Messaging (stdin/stdout).
- Nhận URL/domain hiện tại từ extension.
- Trả candidate list không chứa password.
- Chỉ trả autofill payload cho credential ID mà user đã chọn.
- Không in protocol payload chứa password ra stdout debug/log ngoài kênh Native Messaging.

---

## 14. Module `api.py` (tùy chọn)

Chỉ dùng nếu UI/agent nằm process khác hoặc bạn muốn automation script gọi qua HTTP local.

### Ràng buộc

- Bind `127.0.0.1`, không dùng `0.0.0.0` mặc định.
- Header token bắt buộc: `X-Local-Token`.
- Token lấy từ environment/OS credential store, không hardcode trong source.
- Không ghi request/response body có password vào access log.

### Endpoint tối thiểu

| Method | Path | Mục đích | Có password trong response? |
|---|---|---|---|
| `GET` | `/v1/credentials` | List/search summary | Không |
| `POST` | `/v1/credentials` | Tạo credential | Chỉ nhận request, không echo lại |
| `GET` | `/v1/credentials/{id}` | Xem metadata | Không |
| `PATCH` | `/v1/credentials/{id}` | Update metadata/password | Không echo password |
| `DELETE` | `/v1/credentials/{id}` | Xóa credential | Không |
| `POST` | `/v1/autofill/candidates` | Tìm candidate | Không |
| `POST` | `/v1/autofill/payload` | Lấy username/password của item được chọn | Có, chỉ local authenticated caller |

---

## 15. Module `audit_service.py` (optional)

Dù không cần crypto, audit tối thiểu vẫn hữu ích để debug việc autofill.

### Chỉ nên ghi event metadata

```text
CREDENTIAL_CREATED
CREDENTIAL_UPDATED
CREDENTIAL_DELETED
PASSWORD_CHANGED
AUTOFILL_CANDIDATES_REQUESTED
AUTOFILL_COMPLETED
```

### Không bao giờ ghi

- Password.
- TOTP secret.
- Notes nếu có thông tin nhạy cảm.
- `DB_PASSWORD`, `LOCAL_API_TOKEN`.
- Request body của endpoint create/update/autofill payload.

---

## 16. Luồng nghiệp vụ chính

### A. Tạo credential

```text
UI/API
  -> CredentialService.create_credential(data, rules)
  -> Validator validate/normalize
  -> CredentialRepo INSERT credentials (username/password plaintext)
  -> CredentialRepo INSERT autofill_rules
  -> MariaDB commit
```

### B. Hiển thị danh sách credential

```text
UI/API
  -> CredentialService.list_credentials()
  -> CredentialRepo list_credential_summaries()
  -> trả title/platform/username/tags/favorite
  -> không SELECT password
```

### C. Autofill browser/app desktop

```text
Agent/extension lấy domain hoặc active window
  -> AutofillMatcher.find_candidates(context)
  -> CredentialRepo.find_candidates()
  -> trả title + username, không password
  -> user chọn credential
  -> CredentialService.get_autofill_payload(credential_id)
  -> SELECT username + password
  -> adapter fill vào app/browser
  -> CredentialRepo.mark_credential_used()
```

### D. Đổi password

```text
UI/API
  -> CredentialService.update_credential(... password mới ...)
  -> CredentialRepo.update_credential_password()
  -> MariaDB trigger lưu password cũ vào password_history (optional)
  -> commit
```

### E. Xóa credential

```text
UI/API
  -> CredentialService.delete_credential(id)
  -> CredentialRepo.delete_credential(id)
  -> FK CASCADE xóa autofill_rules và password_history
```

---

## 17. Thứ tự triển khai

### Phase 1 — Database access và CRUD

1. Viết `migrations/001_initial_schema.sql` bằng schema ở mục 5.
2. Viết `config.py`, `.env.example`, `.gitignore`.
3. Viết `db.py`, test MariaDB connection pool.
4. Viết `validator.py`.
5. Viết `credential_repo.py` với create/list/get/update/delete.
6. Viết `credential_service.py`.
7. Tạo CLI test ở `main.py`.

**Done criteria:** Tạo credential, list không lộ password, lấy password theo ID, update/delete hoạt động trên MariaDB.

### Phase 2 — Autofill matching

1. Viết `autofill_matcher.py` domain/process matching.
2. CRUD `autofill_rules`.
3. Ranking theo priority/favorite/last_used_at.
4. Test domain giả và nhiều candidate.

**Done criteria:** Domain/window context trả đúng candidate, không có password trong candidate list.

### Phase 3 — Desktop/browser integration

1. Windows global hotkey + active window detector.
2. Popup UI chọn credential.
3. Auto-Type/UI Automation adapter.
4. Browser extension + Native Messaging host.
5. Optional local API cho automation script.

**Done criteria:** User nhấn hotkey/chọn entry, hệ thống chỉ lấy password ngay trước khi điền và không log password.

### Phase 4 — Operational hardening

1. MariaDB user riêng, quyền tối thiểu.
2. Backup/restore và policy không upload dump plaintext lên cloud.
3. Docker volume ownership/permission nếu DB chạy Docker.
4. Kiểm tra `.env`, logs, Git history không chứa secret.
5. Tắt/không publish local API khi không dùng.

---

## 18. Test plan tối thiểu

### `test_validator.py`

- Title/username/password rỗng bị từ chối.
- Platform type sai bị từ chối.
- Domain normalize đúng.
- Tags trim, lowercase, bỏ duplicate.

### `test_credential_repo.py`

- Insert rồi get có username/password đúng.
- Summary query không chứa key `password`.
- Update password hoạt động.
- Delete credential cascade delete rules/history.
- Parameterized query không lỗi với username chứa quote/ký tự Unicode.

### `test_credential_service.py`

- Create credential + rules là atomic: rule invalid thì không có credential mới.
- `get_autofill_payload()` chỉ trả username/password/totp cần thiết.
- `list_credentials()` không lộ password.
- Update metadata không làm mất password.

### `test_autofill_matcher.py`

- `google.com.evil.tld` không match rule `google.com`.
- Exact URL ưu tiên hơn domain.
- Nhiều candidate được sort theo priority/favorite/last_used_at.
- Candidate list không bao giờ có password.

---

## 19. Checklist trước khi dùng

- [ ] Đã hiểu password nằm plaintext trong MariaDB.
- [ ] Chỉ dùng tài khoản test/automation hoặc dữ liệu không quan trọng.
- [ ] MariaDB không expose Internet và app DB user không phải `root`.
- [ ] `.env` nằm trong `.gitignore`.
- [ ] Không có password trong terminal output, exception trace, app log hoặc analytics.
- [ ] Local API bind `127.0.0.1` và có token nếu được bật.
- [ ] Backup/Docker volume không tự sync lên cloud public.
- [ ] Autofill yêu cầu user action rõ ràng (hotkey/chọn entry).
- [ ] Summary/candidate APIs không trả password.
- [ ] Password chỉ được query tại bước chuẩn bị fill hoặc màn hình xem chi tiết có chủ đích.

---

## 20. So sánh với plan cũ

| Thành phần | Plan cũ (encrypted vault) | Plan mới (plaintext store) |
|---|---|---|
| `crypto.py` | Có Argon2id, AES-GCM, nonce, AAD | Bỏ hoàn toàn |
| `vault_meta` | Có KDF salt/verifier | Bỏ hoàn toàn |
| Master password | Có unlock/lock | Bỏ hoàn toàn |
| Password trong DB | Ciphertext BLOB | `TEXT` plaintext |
| TOTP/notes | Encrypted | Plaintext nếu giữ cột |
| `vault_service.py` | Quản lý session key | Đổi tên `credential_service.py`, chỉ business logic |
| Autofill | Cần vault unlocked | Query DB trực tiếp khi user chọn credential |
| Rủi ro DB dump | Không đọc được password nếu không có master password | Đọc được toàn bộ password |

---

## 21. Bước tiếp theo

Nên thực hiện theo thứ tự:

1. Tạo MariaDB database và user quyền tối thiểu.
2. Lưu schema ở mục 5 thành `migrations/001_initial_schema.sql`.
3. Hoàn thiện `config.py` + `db.py` để chạy migration từ Python hoặc MariaDB CLI.
4. Viết `validator.py`.
5. Viết `credential_repo.py` với query summary khác query secret.
6. Viết `credential_service.py`.
7. Tạo CLI test CRUD trước khi làm UI/autofill agent.

Điểm quan trọng trong phiên bản plaintext: dù không mã hóa, vẫn giữ nguyên kỷ luật module — đặc biệt tách `list_credential_summaries()` khỏi `get_autofill_payload()` — để password không bị select/serialize/log ngoài ý muốn.