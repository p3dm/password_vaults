// src/db/transaction.ts
// Transaction helper — explicit connection passing, auto commit/rollback.

import type { PoolConnection } from 'mariadb';
import { getConnection } from './pool.js';

/**
 * Execute a function within a transaction on a single connection.
 * Commits on success, rolls back on error.
 * The connection is always released back to the pool.
 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      // Preserve the original error; log rollback failure
      console.error('Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Execute a read-only operation with a connection.
 * No transaction — connection is released after use.
 */
export async function withConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}
