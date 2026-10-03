// src/repositories/log.ts
// Log repository — error_logs and infor_logs CRUD.

import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mariadb';
import type { ErrorLogRecord, InforLogRecord } from '../domain/types.js';
import { rowToErrorLog, rowToInforLog } from '../db/rows.js';

// ── Error Logs ────────────────────────────────────────────────

/** Write an error log entry. */
export async function writeErrorLog(
  conn: PoolConnection,
  eventType: string,
  message: string,
  objectId: string | null = null
): Promise<string> {
  const id = randomUUID();
  await conn.query(
    `INSERT INTO error_logs (id, event_type, object_id, message)
     VALUES (?, ?, ?, ?)`,
    [id, eventType, objectId, message]
  );
  return id;
}

/** Get error log by ID. */
export async function getErrorLogById(
  conn: PoolConnection,
  logId: string
): Promise<ErrorLogRecord | null> {
  const rows = await conn.query(
    `SELECT id, event_type, object_id, message, created_at
     FROM error_logs WHERE id = ?`,
    [logId]
  );
  if (!rows.length) return null;
  return rowToErrorLog(rows[0]);
}

/** List error logs by event type, newest first. */
export async function listErrorLogsByEvent(
  conn: PoolConnection,
  eventType: string,
  limit: number = 50
): Promise<ErrorLogRecord[]> {
  const rows = await conn.query(
    `SELECT id, event_type, object_id, message, created_at
     FROM error_logs
     WHERE event_type = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [eventType, limit]
  );
  return rows.map(rowToErrorLog);
}

/** List error logs by object ID, newest first. */
export async function listErrorLogsByObject(
  conn: PoolConnection,
  objectId: string,
  limit: number = 50
): Promise<ErrorLogRecord[]> {
  const rows = await conn.query(
    `SELECT id, event_type, object_id, message, created_at
     FROM error_logs
     WHERE object_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [objectId, limit]
  );
  return rows.map(rowToErrorLog);
}

/** Delete error log by ID. Returns true if deleted. */
export async function deleteErrorLog(
  conn: PoolConnection,
  logId: string
): Promise<boolean> {
  const result = await conn.query(
    'DELETE FROM error_logs WHERE id = ?',
    [logId]
  );
  return result.affectedRows > 0;
}

// ── Information Logs ──────────────────────────────────────────

/** Write an information log entry. */
export async function writeInforLog(
  conn: PoolConnection,
  eventType: string,
  message: string,
  objectId: string | null = null
): Promise<string> {
  const id = randomUUID();
  await conn.query(
    `INSERT INTO infor_logs (id, event_type, object_id, message)
     VALUES (?, ?, ?, ?)`,
    [id, eventType, objectId, message]
  );
  return id;
}
