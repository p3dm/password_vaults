// src/controllers/credential.ts
// Credential controller — CRUD with validation, logging, and error handling.
// Fixes: separate create/update validation, proper error handling,
//   no undefined credential_id references, no detached ORM entities.

import type {
  CredentialSummary,
  CredentialRecord,
  CreateCredentialInput,
  UpdateCredentialInput,
  PasswordHistoryRecord,
} from '../domain/types.js';
import {
  validateCreateCredential,
  validateUpdateCredential,
} from '../domain/validation.js';
import { CredentialNotFoundError } from '../domain/errors.js';
import { withConnection, withTransaction } from '../db/transaction.js';
import * as credentialRepo from '../repositories/credential.js';
import * as ruleRepo from '../repositories/autofill-rule.js';
import * as logRepo from '../repositories/log.js';
import { validateCreateRule } from '../domain/validation.js';
import type { CreateRuleInput } from '../domain/types.js';

/**
 * Insert a new credential.
 * Validates input, generates UUID, and returns the new ID.
 */
export async function insertCredential(data: unknown): Promise<string> {
  const validated = validateCreateCredential(data);
  try {
    return await withTransaction(async (conn) => {
      const id = await credentialRepo.insertCredential(conn, validated);
      // Log success on same transaction connection
      await logRepo.writeInforLog(
        conn,
        'credential_created',
        `Credential created: ${validated.title}`,
        id
      );
      return id;
    });
  } catch (err: any) {
    // Best-effort error logging — preserve original error
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `insert_credential failed: ${err.message}`,
          null
        );
      });
    } catch {
      // Swallow logging errors to preserve the original
    }
    throw err;
  }
}

/**
 * Read one credential by ID (summary — no secrets).
 * Throws CredentialNotFoundError if not found.
 */
export async function readOneCredential(
  credentialId: string
): Promise<CredentialSummary> {
  return withConnection(async (conn) => {
    const result = await credentialRepo.readOneCredentialSummary(
      conn,
      credentialId
    );
    if (!result) {
      throw new CredentialNotFoundError(
        `Credential not found: ${credentialId}`
      );
    }
    return result;
  });
}

/** List all credentials (summaries — no secrets). */
export async function readAllCredentials(): Promise<CredentialSummary[]> {
  return withConnection(async (conn) => {
    return credentialRepo.readAllCredentials(conn);
  });
}

/**
 * Update credential metadata (no password).
 * Only validates and updates provided fields.
 * Fixes: separate update validation, no full create validation for PATCH.
 */
export async function updateCredentialMetadata(
  credentialId: string,
  data: unknown
): Promise<string> {
  const validated = validateUpdateCredential(data);
  try {
    await withTransaction(async (conn) => {
      // Check existence first
      const exists = await credentialRepo.credentialExists(conn, credentialId);
      if (!exists) {
        throw new CredentialNotFoundError(
          `Credential not found: ${credentialId}`
        );
      }
      await credentialRepo.updateCredentialMetadata(
        conn,
        credentialId,
        validated
      );
    });
    return `Update successfully: ${credentialId}`;
  } catch (err: any) {
    if (err instanceof CredentialNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `update_credential failed: ${err.message}`,
          credentialId
        );
      });
    } catch {
      // Preserve original error
    }
    throw err;
  }
}

/**
 * Update credential password.
 * Trigger trg_credentials_password_history will auto-save old password.
 * Fixes: empty password validated, proper not-found check.
 */
export async function updateCredentialPassword(
  credentialId: string,
  newPassword: string
): Promise<string> {
  if (!newPassword || newPassword.length === 0) {
    throw new Error('new_password cannot be empty');
  }
  try {
    await withTransaction(async (conn) => {
      const exists = await credentialRepo.credentialExists(conn, credentialId);
      if (!exists) {
        throw new CredentialNotFoundError(
          `Credential not found: ${credentialId}`
        );
      }
      await credentialRepo.updateCredentialPassword(
        conn,
        credentialId,
        newPassword
      );
    });
    return `Password updated: ${credentialId}`;
  } catch (err: any) {
    if (err instanceof CredentialNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `update_credential_password failed: ${err.message}`,
          credentialId
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}

/** Delete credential by ID (cascade deletes rules + history). */
export async function deleteCredential(credentialId: string): Promise<string> {
  try {
    const deleted = await withTransaction(async (conn) => {
      const exists = await credentialRepo.credentialExists(conn, credentialId);
      if (!exists) {
        throw new CredentialNotFoundError(
          `Credential not found: ${credentialId}`
        );
      }
      return credentialRepo.deleteCredential(conn, credentialId);
    });
    return `Delete successfully: ${credentialId}`;
  } catch (err: any) {
    if (err instanceof CredentialNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `delete_credential failed: ${err.message}`,
          credentialId
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}

/** List password history for a credential. */
export async function listPasswordHistory(
  credentialId: string
): Promise<PasswordHistoryRecord[]> {
  return withConnection(async (conn) => {
    return credentialRepo.listPasswordHistory(conn, credentialId);
  });
}

/**
 * Create credential + autofill rules atomically in one transaction.
 * Fixes: validates ALL rules before any write, uses one transaction,
 *   no is_enabled duplication, no nonexistent log.infor() call.
 */
export async function createCredentialWithRules(
  credData: unknown,
  rulesData: unknown[]
): Promise<string> {
  const validatedCred = validateCreateCredential(credData);
  // Validate ALL rules BEFORE starting the transaction
  const validatedRules: CreateRuleInput[] = rulesData.map((r) =>
    validateCreateRule(r)
  );

  try {
    return await withTransaction(async (conn) => {
      const credId = await credentialRepo.insertCredential(
        conn,
        validatedCred
      );
      for (const rule of validatedRules) {
        await ruleRepo.addAutofillRule(conn, credId, rule);
      }
      // Log on same transaction connection
      await logRepo.writeInforLog(
        conn,
        'create_credential_with_rule',
        `create_credential_with_rules success: ${validatedCred.title}`,
        credId
      );
      return credId;
    });
  } catch (err: any) {
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `create_credential_with_rules failed: ${err.message}`,
          null
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}
