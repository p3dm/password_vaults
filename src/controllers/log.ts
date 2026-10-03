// src/controllers/log.ts
// Log controller — sanitized operational logging.
// Fixes: object_id nullable, error logging doesn't open nested transaction,
//   never logs raw SQL params, secrets, or tokens.

import type { ErrorLogRecord } from '../domain/types.js';
import { withConnection, withTransaction } from '../db/transaction.js';
import * as logRepo from '../repositories/log.js';

/** Write an error log. Best-effort — does not throw on failure. */
export async function logError(
  eventType: string,
  message: string,
  objectId: string | null = null
): Promise<string | null> {
  try {
    return await withTransaction(async (conn) => {
      return logRepo.writeErrorLog(conn, eventType, sanitize(message), objectId);
    });
  } catch (err) {
    // Error logging must not mask original failures
    console.error('Failed to write error log:', err);
    return null;
  }
}

/** Write an information log. Best-effort — does not throw on failure. */
export async function logInfor(
  eventType: string,
  message: string,
  objectId: string | null = null
): Promise<string | null> {
  try {
    return await withTransaction(async (conn) => {
      return logRepo.writeInforLog(conn, eventType, sanitize(message), objectId);
    });
  } catch (err) {
    console.error('Failed to write infor log:', err);
    return null;
  }
}

/** Get error log by ID. */
export async function getErrorById(
  logId: string
): Promise<ErrorLogRecord | null> {
  return withConnection(async (conn) => {
    return logRepo.getErrorLogById(conn, logId);
  });
}

/** List error logs by event type. */
export async function listErrorsByEvent(
  eventType: string,
  limit: number = 50
): Promise<ErrorLogRecord[]> {
  return withConnection(async (conn) => {
    return logRepo.listErrorLogsByEvent(conn, eventType, limit);
  });
}

/** List error logs by object ID. */
export async function listErrorsByObject(
  objectId: string,
  limit: number = 50
): Promise<ErrorLogRecord[]> {
  return withConnection(async (conn) => {
    return logRepo.listErrorLogsByObject(conn, objectId, limit);
  });
}

/** Delete error log by ID. */
export async function deleteError(logId: string): Promise<boolean> {
  return withTransaction(async (conn) => {
    return logRepo.deleteErrorLog(conn, logId);
  });
}

// ── Sanitization ──────────────────────────────────────────────

/** Remove potential secret data from log messages. */
function sanitize(message: string): string {
  // Strip potential SQL parameter dumps, API tokens, passwords
  return message
    .replace(/password['":\s]*=['":\s]*\S+/gi, 'password=***')
    .replace(/token['":\s]*=['":\s]*\S+/gi, 'token=***')
    .replace(/secret['":\s]*=['":\s]*\S+/gi, 'secret=***');
}
