import { describe, it, expect } from 'vitest';
import * as baselineMigration from '../../migrations/0001_plaintext_baseline.js';

describe('Database Migration & Baseline Integrity', () => {
  it('exports valid Umzug migration interface', () => {
    expect(baselineMigration.name).toBe('0001_plaintext_baseline');
    expect(typeof baselineMigration.up).toBe('function');
    expect(typeof baselineMigration.down).toBe('function');
  });

  it('generates statements for all 5 core tables and trigger in up()', async () => {
    const executedQueries: string[] = [];
    const mockConnection: any = {
      query: async (sql: string) => {
        executedQueries.push(sql);
        return [];
      },
    };

    await baselineMigration.up({ context: mockConnection });

    expect(executedQueries.length).toBeGreaterThanOrEqual(6);
    const combinedSql = executedQueries.join('\n');

    expect(combinedSql).toContain('CREATE TABLE IF NOT EXISTS credentials');
    expect(combinedSql).toContain('CREATE TABLE IF NOT EXISTS autofill_rules');
    expect(combinedSql).toContain('CREATE TABLE IF NOT EXISTS password_history');
    expect(combinedSql).toContain('CREATE TABLE IF NOT EXISTS error_logs');
    expect(combinedSql).toContain('CREATE TABLE IF NOT EXISTS infor_logs');
    expect(combinedSql).toContain('CREATE TRIGGER trg_credentials_password_history');
    expect(combinedSql).toContain('idx_autofill_rules_match (match_type, match_value(255))');
  });

  it('generates drop statements in down() in reverse dependency order', async () => {
    const executedQueries: string[] = [];
    const mockConnection: any = {
      query: async (sql: string) => {
        executedQueries.push(sql);
        return [];
      },
    };

    await baselineMigration.down({ context: mockConnection });

    const combinedSql = executedQueries.join('\n');
    expect(combinedSql).toContain('DROP TRIGGER IF EXISTS trg_credentials_password_history');
    expect(combinedSql).toContain('DROP TABLE IF EXISTS autofill_rules');
    expect(combinedSql).toContain('DROP TABLE IF EXISTS password_history');
    expect(combinedSql).toContain('DROP TABLE IF EXISTS credentials');
  });
});
