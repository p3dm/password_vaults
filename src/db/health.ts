// src/db/health.ts
// Database health check utilities.

import { getConnection } from './pool.js';

export interface HealthStatus {
  connected: boolean;
  version?: string;
  error?: string;
}

/** Perform a health check and return connection status and version. */
export async function checkHealth(): Promise<HealthStatus> {
  try {
    const conn = await getConnection();
    try {
      const rows = await conn.query('SELECT VERSION() AS version');
      return {
        connected: true,
        version: rows[0]?.version ?? 'unknown',
      };
    } finally {
      conn.release();
    }
  } catch (err: any) {
    return {
      connected: false,
      error: err.message ?? String(err),
    };
  }
}
