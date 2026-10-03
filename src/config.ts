// src/config.ts
// Application configuration — preserve existing DB/API environment names.

import { config as dotenvConfig } from 'dotenv';
import { join, resolve } from 'path';

// Load .env from project root
dotenvConfig({ path: resolve(__dirname, '..', '.env') });

export interface Settings {
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbUser: string;
  readonly dbPassword: string;
  readonly dbName: string;
  readonly dbPoolSize: number;

  readonly vaultAutolockMinutes: number;

  readonly localApiHost: string;
  readonly localApiPort: number;
  readonly localApiToken: string;
}

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Required environment variable '${key}' is not set. Check .env or environment variables.`
    );
  }
  return value;
}

function envInt(key: string, defaultValue?: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(
      `Environment variable '${key}' is not set and has no default.`
    );
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable '${key}' must be an integer, got: '${raw}'`
    );
  }
  return parsed;
}

export function loadSettings(): Settings {
  return Object.freeze({
    dbHost: requireEnv('DB_HOST'),
    dbPort: envInt('DB_PORT', 3306),
    dbUser: requireEnv('DB_USER'),
    dbPassword: requireEnv('DB_PASSWORD'),
    dbName: requireEnv('DB_NAME'),
    dbPoolSize: envInt('DB_POOL_SIZE', 5),
    vaultAutolockMinutes: envInt('VAULT_AUTOLOCK_MINUTES', 10),
    localApiHost: (process.env.LOCAL_API_HOST ?? '127.0.0.1').trim(),
    localApiPort: envInt('LOCAL_API_PORT', 8765),
    localApiToken: (process.env.LOCAL_API_TOKEN ?? '').trim(),
  });
}

/** Redacted representation for logging — never shows dbPassword or token. */
export function settingsToString(s: Settings): string {
  return (
    `Settings(dbHost=${s.dbHost}, dbPort=${s.dbPort}, ` +
    `dbUser=${s.dbUser}, dbPassword='***', ` +
    `dbName=${s.dbName}, dbPoolSize=${s.dbPoolSize}, ` +
    `vaultAutolockMinutes=${s.vaultAutolockMinutes}, ` +
    `localApiHost=${s.localApiHost}, localApiPort=${s.localApiPort})`
  );
}
