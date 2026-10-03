// src/db/rows.ts
// Row mappers — convert MariaDB result rows to typed domain objects.
// Handle JSON type (string vs parsed), BOOLEAN/TINYINT, and Date mapping.

import type {
  CredentialRecord,
  CredentialSummary,
  Candidate,
  AutofillRuleRecord,
  PasswordHistoryRecord,
  ErrorLogRecord,
  InforLogRecord,
  PlatformType,
  MatchType,
} from '../domain/types.js';

/** Parse JSON tags field — handles string, parsed array, or null */
function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Parse BOOLEAN/TINYINT to proper boolean */
function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return value === 1 || value === '1' || value === true;
}

/** Parse date field — avoid mutating timezone-naive legacy values */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return new Date();
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

// ── Credential mappers ────────────────────────────────────────

export function rowToCredentialRecord(row: any): CredentialRecord {
  return {
    id: row.id,
    title: row.title,
    platformType: row.platform_type as PlatformType,
    platformIdentifier: row.platform_identifier ?? null,
    username: row.username,
    password: row.password,
    totpSecret: row.totp_secret ?? null,
    notes: row.notes ?? null,
    url: row.url ?? null,
    tags: parseTags(row.tags),
    favorite: toBool(row.favorite),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lastUsedAt: toDateOrNull(row.last_used_at),
  };
}

export function rowToCredentialSummary(row: any): CredentialSummary {
  return {
    id: row.id,
    title: row.title,
    platformType: row.platform_type as PlatformType,
    platformIdentifier: row.platform_identifier ?? null,
    username: row.username,
    notes: row.notes ?? null,
    url: row.url ?? null,
    tags: parseTags(row.tags),
    favorite: toBool(row.favorite),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lastUsedAt: toDateOrNull(row.last_used_at),
  };
}

export function rowToCandidate(row: any): Candidate {
  return {
    credentialId: row.id ?? row.credential_id,
    title: row.title,
    username: row.username,
    priority: row.priority ?? 0,
    favorite: toBool(row.favorite),
    lastUsedAt: toDateOrNull(row.last_used_at),
  };
}

// ── Rule mapper ───────────────────────────────────────────────

export function rowToAutofillRule(row: any): AutofillRuleRecord {
  return {
    id: row.id,
    credentialId: row.credential_id,
    matchType: row.match_type as MatchType,
    matchValue: row.match_value,
    priority: row.priority ?? 0,
    isEnabled: toBool(row.is_enabled),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

// ── History mapper ────────────────────────────────────────────

export function rowToPasswordHistory(row: any): PasswordHistoryRecord {
  return {
    id: row.id,
    credentialId: row.credential_id,
    password: row.password,
    changedAt: toDate(row.changed_at),
  };
}

// ── Log mappers ───────────────────────────────────────────────

export function rowToErrorLog(row: any): ErrorLogRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    objectId: row.object_id ?? null,
    message: row.message,
    createdAt: toDate(row.created_at),
  };
}

export function rowToInforLog(row: any): InforLogRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    objectId: row.object_id ?? null,
    message: row.message,
    createdAt: toDate(row.created_at),
  };
}
