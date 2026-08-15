-- ============================================================
-- LOCAL PASSWORD VAULT SCHEMA (MySQL / MariaDB version)
--
-- Nguyên tắc:
--   - No master password, hash password only
--   - Each sensitive field (username, password, totp, notes) is encrypted
--     with AES-256-GCM, with nonce for each field.
--   - vault_meta only saves KDF (Argon2id) parameters + verifier hash.
--
-- Yêu cầu: MySQL 8.0.16+ hoặc MariaDB 10.2.7+ (để CHECK constraint
-- được enforce thật sự, chứ không chỉ parse rồi bỏ qua).
-- Storage engine: InnoDB (bắt buộc để foreign key hoạt động).
-- ============================================================

SET NAMES utf8mb4;
SET default_storage_engine = InnoDB;

-- ------------------------------------------------------------
-- 1. vault_meta: thông tin derive key, chỉ có 1 row duy nhất
-- ------------------------------------------------------------
CREATE TABLE vault_meta (
    id              TINYINT UNSIGNED NOT NULL PRIMARY KEY CHECK (id = 1), -- ép chỉ 1 row
    kdf_algorithm   VARCHAR(32)  NOT NULL DEFAULT 'argon2id',
    kdf_salt        VARBINARY(64)  NOT NULL,        -- salt cho Argon2id
    kdf_memory_cost INT UNSIGNED NOT NULL,           -- KiB, ví dụ 65536
    kdf_time_cost   INT UNSIGNED NOT NULL,           -- số iteration, ví dụ 3
    kdf_parallelism INT UNSIGNED NOT NULL,           -- số thread, ví dụ 4
    verifier_hash   VARBINARY(256) NOT NULL,         -- dùng để check master password đúng
    verifier_salt   VARBINARY(64)  NOT NULL,
    schema_version  INT UNSIGNED NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. vault_items: bảng chính lưu credential
-- ------------------------------------------------------------
CREATE TABLE vault_items (
    id                      CHAR(36) NOT NULL PRIMARY KEY,   -- UUID dạng text
    title                   VARCHAR(255) NOT NULL,           -- tên gợi nhớ, VD "TikTok - device03"
    platform_type           ENUM('web', 'desktop_app', 'other') NOT NULL,
    platform_identifier     VARCHAR(255),                    -- domain / window title

    username                VARCHAR(255) NOT NULL,

    password_encrypted      VARBINARY(512) NOT NULL,
    password_nonce          VARBINARY(32)  NOT NULL,

    totp_secret_encrypted   VARBINARY(512),                  -- NULL if no 2FA
    totp_secret_nonce       VARBINARY(32),

    url                     VARCHAR(2048),                   -- URL full if platform_type = 'web'
    notes_encrypted         BLOB,
    notes_nonce             VARBINARY(32),

    tags                    JSON,                            -- VD '["tiktool","test"]'
    favorite                TINYINT(1) NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),

    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
    last_used_at            DATETIME NULL
) ENGINE=InnoDB;

CREATE INDEX idx_vault_items_platform ON vault_items(platform_type, platform_identifier);
CREATE INDEX idx_vault_items_favorite ON vault_items(favorite);
CREATE INDEX idx_vault_items_username ON vault_items(username);

-- ------------------------------------------------------------
-- 3. autofill_rules: quy tắc match để agent biết điền vào đâu
--    (1 vault_item có thể có nhiều rule, VD vừa match domain
--     vừa match android package)
-- ------------------------------------------------------------
CREATE TABLE autofill_rules (
    id              CHAR(36) NOT NULL PRIMARY KEY,   -- UUID
    vault_item_id   CHAR(36) NOT NULL,
    match_type      ENUM('domain', 'window_title_regex', 'android_package', 'resource_id_hint') NOT NULL,
    match_value     VARCHAR(512) NOT NULL,            -- VD: "tiktok.com", "com.zhiliaoapp.musically", regex title
    field_role      ENUM('username', 'password', 'otp') NOT NULL,
    priority        INT NOT NULL DEFAULT 0,           -- rule ưu tiên cao hơn match trước

    CONSTRAINT fk_autofill_rules_vault_item
        FOREIGN KEY (vault_item_id) REFERENCES vault_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_autofill_rules_match ON autofill_rules(match_type, match_value(191));

-- ------------------------------------------------------------
-- 4. password_history
-- ------------------------------------------------------------
CREATE TABLE password_history (
    id                  CHAR(36) NOT NULL PRIMARY KEY,   -- UUID
    vault_item_id       CHAR(36) NOT NULL,
    password_encrypted  VARBINARY(512) NOT NULL,
    password_nonce      VARBINARY(32)  NOT NULL,
    changed_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_password_history_vault_item
        FOREIGN KEY (vault_item_id) REFERENCES vault_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_password_history_item ON password_history(vault_item_id);

-- ------------------------------------------------------------
-- 5. updated_at của vault_items đã tự động cập nhật nhờ
--    "ON UPDATE CURRENT_TIMESTAMP" ở cột updated_at bên trên,
--    nên không cần trigger riêng như bản SQLite.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 6. Trigger tự lưu password cũ vào history trước khi ghi đè
--    password mới, để không mất log khi update
-- ------------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_vault_items_password_history
AFTER UPDATE ON vault_items
FOR EACH ROW
BEGIN
    IF NOT (OLD.password_encrypted <=> NEW.password_encrypted) THEN
        INSERT INTO password_history (id, vault_item_id, password_encrypted, password_nonce, changed_at)
        VALUES (UUID(), OLD.id, OLD.password_encrypted, OLD.password_nonce, CURRENT_TIMESTAMP);
    END IF;
END$$

DELIMITER ;