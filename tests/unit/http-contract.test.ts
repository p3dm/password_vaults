import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHttpApp } from '../../src/http/app.js';

describe('HTTP API Contract Tests', () => {
  const TEST_TOKEN = 'secret-test-token-12345';
  const app = createHttpApp(TEST_TOKEN);

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns health status without requiring authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('version');
    });
  });

  describe('Authentication Boundary', () => {
    it('returns 401 when X-Local-Token is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/credentials',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('returns 401 when X-Local-Token is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/credentials',
        headers: {
          'X-Local-Token': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('Autofill Candidate Lookup Validation', () => {
    it('validates candidate lookup body requires valid source', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/autofill/candidates',
        headers: {
          'X-Local-Token': TEST_TOKEN,
        },
        payload: {
          source: 'invalid_source',
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('validates payload lookup requires credential_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/autofill/payload',
        headers: {
          'X-Local-Token': TEST_TOKEN,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('VALIDATION_ERROR');
    });
  });
});
