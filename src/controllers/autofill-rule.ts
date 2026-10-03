// src/controllers/autofill-rule.ts
// Autofill rule controller — CRUD with validation.

import type {
  AutofillRuleRecord,
  Candidate,
} from '../domain/types.js';
import {
  validateCreateRule,
  validateUpdateRule,
} from '../domain/validation.js';
import { RuleNotFoundError, CredentialNotFoundError } from '../domain/errors.js';
import { withConnection, withTransaction } from '../db/transaction.js';
import * as ruleRepo from '../repositories/autofill-rule.js';
import * as credentialRepo from '../repositories/credential.js';
import * as logRepo from '../repositories/log.js';

/** Add an autofill rule to a credential. */
export async function addAutofillRule(
  credentialId: string,
  data: unknown
): Promise<string> {
  const validated = validateCreateRule(data);
  try {
    const ruleId = await withTransaction(async (conn) => {
      // Verify credential exists
      const exists = await credentialRepo.credentialExists(conn, credentialId);
      if (!exists) {
        throw new CredentialNotFoundError(
          `Credential not found: ${credentialId}`
        );
      }
      const id = await ruleRepo.addAutofillRule(conn, credentialId, validated);
      await logRepo.writeInforLog(
        conn,
        'add_autofill_rule',
        `add_autofill_rule success: ${id}`,
        credentialId
      );
      return id;
    });
    return `Successfully add autofill rule: ${ruleId}`;
  } catch (err: any) {
    if (err instanceof CredentialNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `add_autofill_rule failed: ${err.message}`,
          credentialId
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}

/** List autofill rules for a credential. */
export async function listAutofillRules(
  credentialId: string
): Promise<AutofillRuleRecord[]> {
  return withConnection(async (conn) => {
    return ruleRepo.listAutofillRules(conn, credentialId);
  });
}

/** Update an autofill rule by ID. */
export async function updateAutofillRule(
  ruleId: string,
  data: unknown
): Promise<string> {
  const validated = validateUpdateRule(data);
  try {
    await withTransaction(async (conn) => {
      const exists = await ruleRepo.ruleExists(conn, ruleId);
      if (!exists) {
        throw new RuleNotFoundError(`Autofill rule not found: ${ruleId}`);
      }
      await ruleRepo.updateAutofillRule(conn, ruleId, validated);
      await logRepo.writeInforLog(
        conn,
        'update_autofill_rule',
        `update_autofill_rule success: ${ruleId}`,
        ruleId
      );
    });
    return 'Update successfully';
  } catch (err: any) {
    if (err instanceof RuleNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `update_autofill_rule failed: ${err.message}`,
          ruleId
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}

/** Delete an autofill rule by ID. */
export async function deleteAutofillRule(ruleId: string): Promise<string> {
  try {
    await withTransaction(async (conn) => {
      const exists = await ruleRepo.ruleExists(conn, ruleId);
      if (!exists) {
        throw new RuleNotFoundError(`Autofill rule not found: ${ruleId}`);
      }
      await ruleRepo.deleteAutofillRule(conn, ruleId);
      await logRepo.writeInforLog(
        conn,
        'delete_autofill_rule',
        `delete_autofill_rule success: ${ruleId}`,
        ruleId
      );
    });
    return `Delete successfully: ${ruleId}`;
  } catch (err: any) {
    if (err instanceof RuleNotFoundError) throw err;
    try {
      await withConnection(async (conn) => {
        await logRepo.writeErrorLog(
          conn,
          'db_error',
          `delete_autofill_rule failed: ${err.message}`,
          ruleId
        );
      });
    } catch {
      // Preserve original
    }
    throw err;
  }
}

/** Find candidates by exact match_type + match_value. */
export async function findCandidates(
  matchType: string,
  matchValue: string
): Promise<Candidate[]> {
  return withConnection(async (conn) => {
    return ruleRepo.findCandidatesByExact(conn, matchType, matchValue);
  });
}
