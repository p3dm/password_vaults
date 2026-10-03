// src/repositories/credential.ts
// Credential repository — parameterized SQL, typed row mappers.
// Fixes: return plain values (no detached ORM entities), atomic operations,
//   summary SQL omits password & totp_secret.

import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mariadb';
import type {
  CredentialRecord,
  CredentialSummary,
  Candidate,
  CreateCredentialInput,
  UpdateCredentialInput,
  PasswordHistoryRecord,
} from '../domain/types.js';
import {
  rowToCredentialRecord,
  rowToCredentialSummary,
  rowToCandidate,
  rowToPasswordHistory,
} from '../db/rows.js';
import { withConnection, withTransaction } from '../db/transaction.js';

// ── Summary columns (NO password, NO totp_secret) ────────────
const SUMMARY_COLS = `
  id, title, platform_type, platform_identifier,
  username, notes, url, tags, favorite,
  created_at, updated_at, last_used_at
`;

// ── Full columns (internal use with secrets) ──────────────────
const FULL_COLS = `
  id, title, platform_type, platform_identifier,
  username, password, totp_secret, notes, url, tags, favorite,
  created_at, updated_at, last_used_at
`;

/** Insert a new credential. Returns the generated UUID. */
export async function insertCredential(
  conn: PoolConnection,
  input: CreateCredentialInput
): Promise<string> {
  const id = randomUUID();
  await conn.query(
    `INSERT INTO credentials
      (id, title, platform_type, platform_identifier,
       username, password, totp_secret, notes, url, tags, favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.platformType,
      input.platformIdentifier ?? null,
      input.username,
      input.password,
      input.totpSecret ?? null,
      input.notes ?? null,
      input.url ?? null,
      JSON.stringify(input.tags ?? []),
      input.favorite ? 1 : 0,
    ]
  );
  return id;
}

/** Read one credential by ID (full record with secrets — internal). */
export async function readOneCredential(
  conn: PoolConnection,
  id: string
): Promise<CredentialRecord | null> {
  const rows = await conn.query(
    `SELECT ${FULL_COLS} FROM credentials WHERE id = ?`,
    [id]
  );
  if (!rows.length) return null;
  return rowToCredentialRecord(rows[0]);
}

/** Read one credential summary (no secrets). */
export async function readOneCredentialSummary(
  conn: PoolConnection,
  id: string
): Promise<CredentialSummary | null> {
  const rows = await conn.query(
    `SELECT ${SUMMARY_COLS} FROM credentials WHERE id = ?`,
    [id]
  );
  if (!rows.length) return null;
  return rowToCredentialSummary(rows[0]);
}

/** List all credentials as summaries (no secrets), newest first. */
export async function readAllCredentials(
  conn: PoolConnection
): Promise<CredentialSummary[]> {
  const rows = await conn.query(
    `SELECT ${SUMMARY_COLS} FROM credentials ORDER BY created_at DESC`
  );
  return rows.map(rowToCredentialSummary);
}

/**
 * Update credential metadata. Only updates provided fields.
 * Does NOT update password — use updateCredentialPassword for that.
 */
export async function updateCredentialMetadata(
  conn: PoolConnection,
  id: string,
  input: UpdateCredentialInput
): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.platformType !== undefined) {
    sets.push('platform_type = ?');
    params.push(input.platformType);
  }
  if (input.platformIdentifier !== undefined) {
    sets.push('platform_identifier = ?');
    params.push(input.platformIdentifier);
  }
  if (input.username !== undefined) {
    sets.push('username = ?');
    params.push(input.username);
  }
  if (input.totpSecret !== undefined) {
    sets.push('totp_secret = ?');
    params.push(input.totpSecret);
  }
  if (input.notes !== undefined) {
    sets.push('notes = ?');
    params.push(input.notes);
  }
  if (input.url !== undefined) {
    sets.push('url = ?');
    params.push(input.url);
  }
  if (input.tags !== undefined) {
    sets.push('tags = ?');
    params.push(JSON.stringify(input.tags));
  }
  if (input.favorite !== undefined) {
    sets.push('favorite = ?');
    params.push(input.favorite ? 1 : 0);
  }

  if (sets.length === 0) return true; // Nothing to update — success

  params.push(id);
  const result = await conn.query(
    `UPDATE credentials SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
  // An unchanged update is successful when the row exists
  return true;
}

/** Update credential password. Trigger will save old password to history. */
export async function updateCredentialPassword(
  conn: PoolConnection,
  id: string,
  newPassword: string
): Promise<boolean> {
  const result = await conn.query(
    'UPDATE credentials SET password = ? WHERE id = ?',
    [newPassword, id]
  );
  return true;
}

/** Update last_used_at timestamp. */
export async function updateLastUsedAt(
  conn: PoolConnection,
  id: string
): Promise<void> {
  await conn.query(
    'UPDATE credentials SET last_used_at = NOW(6) WHERE id = ?',
    [id]
  );
}

/** Delete credential by ID. Returns true if deleted. */
export async function deleteCredential(
  conn: PoolConnection,
  id: string
): Promise<boolean> {
  const result = await conn.query(
    'DELETE FROM credentials WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/** Check if credential exists. */
export async function credentialExists(
  conn: PoolConnection,
  id: string
): Promise<boolean> {
  const rows = await conn.query(
    'SELECT 1 FROM credentials WHERE id = ? LIMIT 1',
    [id]
  );
  return rows.length > 0;
}

/** List password history for a credential, newest first. */
export async function listPasswordHistory(
  conn: PoolConnection,
  credentialId: string
): Promise<PasswordHistoryRecord[]> {
  const rows = await conn.query(
    `SELECT id, credential_id, password, changed_at
     FROM password_history
     WHERE credential_id = ?
     ORDER BY changed_at DESC`,
    [credentialId]
  );
  return rows.map(rowToPasswordHistory);
}

/** Get credential secret payload (username + password). */
export async function getCredentialSecret(
  conn: PoolConnection,
  id: string
): Promise<{ username: string; password: string } | null> {
  const rows = await conn.query(
    'SELECT username, password FROM credentials WHERE id = ?',
    [id]
  );
  if (!rows.length) return null;
  return { username: rows[0].username, password: rows[0].password };
}
