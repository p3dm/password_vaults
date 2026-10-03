// src/db/pool.ts
// MariaDB connection pool — one pool owned by Electron main.
// Uses official mariadb Node.js connector with parameterized SQL.

import mariadb, { type Pool, type PoolConnection } from 'mariadb';
import type { Settings } from '../config.js';

let pool: Pool | null = null;

/**
 * Initialize the connection pool. Call once at app startup.
 * Idempotent — skips if already initialized.
 */
export function initPool(settings: Settings): void {
  if (pool) return;

  pool = mariadb.createPool({
    host: settings.dbHost,
    port: settings.dbPort,
    user: settings.dbUser,
    password: settings.dbPassword,
    database: settings.dbName,
    connectionLimit: settings.dbPoolSize,
    // MariaDB JSON type: ensure parsed values
    insertIdAsNumber: true,
    bigIntAsNumber: true,
    // Timezone handling: preserve stored values
    timezone: 'local',
  });

  console.log(
    `Database pool initialized: host=${settings.dbHost}, db=${settings.dbName}, pool_size=${settings.dbPoolSize}`
  );
}

/** Get the active pool. Throws if not initialized. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool(settings) first.');
  }
  return pool;
}

/** Get a single connection from the pool. Caller must release. */
export async function getConnection(): Promise<PoolConnection> {
  return getPool().getConnection();
}

/** Close the pool and release all connections. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database pool closed.');
  }
}

/** Health check — verify connectivity with SELECT 1. */
export async function checkConnection(): Promise<boolean> {
  try {
    const conn = await getConnection();
    try {
      await conn.query('SELECT 1');
      return true;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Database connection check failed:', err);
    return false;
  }
}
