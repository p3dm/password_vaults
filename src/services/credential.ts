// src/services/credential.ts
// Credential service — autofill workflow orchestration.
// Fixes: save_password uses atomic createCredentialWithRules,
//   last_used_at update on same transaction, no password logging.

import type { AutofillContext, Candidate, CredentialSecret } from '../domain/types.js';
import { CredentialNotFoundError } from '../domain/errors.js';
import { withConnection, withTransaction } from '../db/transaction.js';
import * as credentialRepo from '../repositories/credential.js';
import * as logRepo from '../repositories/log.js';
import { findCandidates, buildMatchRequest } from './autofill-matcher.js';
import { createCredentialWithRules } from '../controllers/credential.js';

export class CredentialService {
  /** Find autofill candidates for a context. No passwords in results. */
  async findAutofillCandidates(
    context: AutofillContext
  ): Promise<Candidate[]> {
    return findCandidates(context);
  }

  /**
   * Get autofill payload (username + password) for a chosen credential.
   * Updates last_used_at atomically in the same transaction.
   */
  async getAutofillPayload(
    credentialId: string
  ): Promise<CredentialSecret> {
    try {
      return await withTransaction(async (conn) => {
        const secret = await credentialRepo.getCredentialSecret(
          conn,
          credentialId
        );
        if (!secret) {
          throw new CredentialNotFoundError(
            `Credential not found: ${credentialId}`
          );
        }
        // Update last_used_at on same transaction
        await credentialRepo.updateLastUsedAt(conn, credentialId);

        // Log without exposing payload
        await logRepo.writeInforLog(
          conn,
          'AUTOFILL_COMPLETED',
          `Autofill payload retrieved for credential: ${credentialId}`,
          credentialId
        );

        return { username: secret.username, password: secret.password };
      });
    } catch (err: any) {
      if (err instanceof CredentialNotFoundError) throw err;
      try {
        await withConnection(async (conn) => {
          await logRepo.writeErrorLog(
            conn,
            'db_error',
            `get_autofill_payload failed: ${err.message}`,
            credentialId
          );
        });
      } catch {
        // Preserve original
      }
      throw err;
    }
  }

  /**
   * Save a new credential with auto-generated rules from context.
   * Fixes: uses atomic createCredentialWithRules instead of
   *   separate inserts per rule.
   */
  async savePassword(
    credential: Record<string, any>,
    context: AutofillContext
  ): Promise<string | null> {
    try {
      const credentialId = credential.credential_id;

      // Check for duplicate
      if (credentialId) {
        const exists = await withConnection(async (conn) => {
          return credentialRepo.credentialExists(conn, credentialId);
        });
        if (exists) {
          console.log(`Credential already exists: ${credentialId}`);
          return null;
        }
      }

      // Build rules from context
      const matchRequests = buildMatchRequest(context);
      const rules = matchRequests.map(([matchType, matchValue]) => ({
        matchType,
        matchValue,
      }));

      // Atomic create — credential + all rules in one transaction
      const newId = await createCredentialWithRules(credential, rules);

      try {
        await withConnection(async (conn) => {
          await logRepo.writeInforLog(
            conn,
            'SAVE_PASSWORD',
            `Save password for credential: ${newId}`,
            newId
          );
        });
      } catch {
        // Best effort
      }

      return newId;
    } catch (err: any) {
      try {
        await withConnection(async (conn) => {
          await logRepo.writeErrorLog(
            conn,
            'db_error',
            `save_password failed: ${err.message}`,
            credential.credential_id ?? null
          );
        });
      } catch {
        // Preserve original
      }
      throw err;
    }
  }
}
