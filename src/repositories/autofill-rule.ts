// src/repositories/autofill-rule.ts
// Autofill rule repository — parameterized SQL, typed row mappers.

import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mariadb';
import type {
  AutofillRuleRecord,
  Candidate,
  CreateRuleInput,
  UpdateRuleInput,
} from '../domain/types.js';
import { rowToAutofillRule, rowToCandidate } from '../db/rows.js';

/** Add an autofill rule. Returns the generated UUID. */
export async function addAutofillRule(
  conn: PoolConnection,
  credentialId: string,
  input: CreateRuleInput
): Promise<string> {
  const id = randomUUID();
  await conn.query(
    `INSERT INTO autofill_rules
      (id, credential_id, match_type, match_value, priority, is_enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      credentialId,
      input.matchType,
      input.matchValue,
      input.priority ?? 0,
      input.isEnabled !== false ? 1 : 0,
    ]
  );
  return id;
}

/** List autofill rules for a credential. */
export async function listAutofillRules(
  conn: PoolConnection,
  credentialId: string
): Promise<AutofillRuleRecord[]> {
  const rows = await conn.query(
    `SELECT id, credential_id, match_type, match_value,
            priority, is_enabled, created_at, updated_at
     FROM autofill_rules
     WHERE credential_id = ?
     ORDER BY priority DESC`,
    [credentialId]
  );
  return rows.map(rowToAutofillRule);
}

/** Update an autofill rule by ID. */
export async function updateAutofillRule(
  conn: PoolConnection,
  ruleId: string,
  input: UpdateRuleInput
): Promise<boolean> {
  const result = await conn.query(
    `UPDATE autofill_rules
     SET match_type = ?, match_value = ?, priority = ?, is_enabled = ?
     WHERE id = ?`,
    [
      input.matchType,
      input.matchValue,
      input.priority ?? 0,
      input.isEnabled !== false ? 1 : 0,
      ruleId,
    ]
  );
  return true;
}

/** Delete an autofill rule by ID. Returns true if deleted. */
export async function deleteAutofillRule(
  conn: PoolConnection,
  ruleId: string
): Promise<boolean> {
  const result = await conn.query(
    'DELETE FROM autofill_rules WHERE id = ?',
    [ruleId]
  );
  return result.affectedRows > 0;
}

/** Check if a rule exists. */
export async function ruleExists(
  conn: PoolConnection,
  ruleId: string
): Promise<boolean> {
  const rows = await conn.query(
    'SELECT 1 FROM autofill_rules WHERE id = ? LIMIT 1',
    [ruleId]
  );
  return rows.length > 0;
}

/** Get a single rule by ID. */
export async function getAutofillRule(
  conn: PoolConnection,
  ruleId: string
): Promise<AutofillRuleRecord | null> {
  const rows = await conn.query(
    `SELECT id, credential_id, match_type, match_value,
            priority, is_enabled, created_at, updated_at
     FROM autofill_rules WHERE id = ?`,
    [ruleId]
  );
  if (!rows.length) return null;
  return rowToAutofillRule(rows[0]);
}

/**
 * Find candidates by exact match_type + match_value.
 * Returns credential metadata (no password) with rule priority.
 * Deduplication and ranking are handled by the service/matcher.
 */
export async function findCandidatesByExact(
  conn: PoolConnection,
  matchType: string,
  matchValue: string
): Promise<Candidate[]> {
  const rows = await conn.query(
    `SELECT c.id, c.title, c.username, c.favorite, c.last_used_at,
            r.priority
     FROM credentials c
     JOIN autofill_rules r ON c.id = r.credential_id
     WHERE r.match_type = ?
       AND r.match_value = ?
       AND r.is_enabled = 1
     ORDER BY r.priority DESC`,
    [matchType, matchValue]
  );
  return rows.map(rowToCandidate);
}

/**
 * Find window_title_regex candidates — fetches all enabled regex rules
 * for evaluation by the matcher service (with bounded regex in a worker).
 */
export async function findWindowTitleRules(
  conn: PoolConnection
): Promise<Array<{ credentialId: string; matchValue: string; priority: number; title: string; username: string; favorite: boolean; lastUsedAt: Date | null }>> {
  const rows = await conn.query(
    `SELECT c.id AS credential_id, c.title, c.username, c.favorite, c.last_used_at,
            r.match_value, r.priority
     FROM credentials c
     JOIN autofill_rules r ON c.id = r.credential_id
     WHERE r.match_type = 'window_title_regex'
       AND r.is_enabled = 1`
  );
  return rows.map((row: any) => ({
    credentialId: row.credential_id,
    matchValue: row.match_value,
    priority: row.priority ?? 0,
    title: row.title,
    username: row.username,
    favorite: row.favorite === 1 || row.favorite === true,
    lastUsedAt: row.last_used_at ?? null,
  }));
}
