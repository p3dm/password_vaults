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

CREATE TABLE IF NOT EXISTS error_logs(
    id CHAR(36) NOT NULL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    object_id CHAR(36),
    message TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_error_logs_event (event_type, object_id)
)ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS infor_logs(
    id CHAR(36) NOT NULL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    object_id CHAR(36),
    message TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_infor_logs_event (event_type, object_id)
)ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;