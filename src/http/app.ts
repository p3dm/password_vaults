// src/http/app.ts
// Local REST API adapter — Fastify with typed routes.
// Preserves existing /api contracts and snake_case response fields.
// Fixes: one transaction per PATCH, sanitized error responses,
//   constant-time token comparison, no secrets in error responses/logs.

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual, randomBytes } from 'crypto';
import type { Settings } from '../config.js';
import type { AutofillContext } from '../domain/types.js';
import {
  CredentialStoreError,
  CredentialNotFoundError,
  ValidationError,
  RuleNotFoundError,
} from '../domain/errors.js';
import {
  insertCredential,
  readOneCredential,
  readAllCredentials,
  updateCredentialMetadata,
  updateCredentialPassword,
  deleteCredential,
  createCredentialWithRules,
} from '../controllers/credential.js';
import {
  addAutofillRule,
  listAutofillRules,
  updateAutofillRule,
  deleteAutofillRule,
} from '../controllers/autofill-rule.js';
import { CredentialService } from '../services/credential.js';
import { checkHealth } from '../db/health.js';

// ── Serialization helpers ─────────────────────────────────────

function dateToIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

function credentialToSummaryJson(cred: any): Record<string, any> {
  return {
    id: cred.id,
    title: cred.title,
    platform_type: cred.platformType,
    platform_identifier: cred.platformIdentifier,
    username: cred.username,
    url: cred.url,
    tags: cred.tags ?? [],
    favorite: cred.favorite,
    notes: cred.notes,
    created_at: dateToIso(cred.createdAt),
    updated_at: dateToIso(cred.updatedAt),
    last_used_at: dateToIso(cred.lastUsedAt),
  };
}

function credentialToListJson(cred: any): Record<string, any> {
  return {
    id: cred.id,
    platform_type: cred.platformType,
    platform_identifier: cred.platformIdentifier,
    username: cred.username,
    notes: cred.notes,
    url: cred.url,
    created_at: dateToIso(cred.createdAt),
  };
}

function ruleToJson(rule: any): Record<string, any> {
  return {
    id: rule.id,
    credential_id: rule.credentialId,
    match_type: rule.matchType,
    match_value: rule.matchValue,
    priority: rule.priority,
    is_enabled: rule.isEnabled,
    created_at: dateToIso(rule.createdAt),
  };
}

// ── Constant-time token comparison ────────────────────────────

function safeTokenCompare(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  // Pad to equal length for timing-safe comparison
  const bufA = Buffer.from(a.padEnd(Math.max(a.length, b.length), '\0'));
  const bufB = Buffer.from(b.padEnd(Math.max(a.length, b.length), '\0'));
  try {
    return timingSafeEqual(bufA, bufB) && a.length === b.length;
  } catch {
    return false;
  }
}

// ── Create the Fastify app ────────────────────────────────────

export function createHttpApp(apiToken: string): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  const service = new CredentialService();

  // ── Token authentication hook ─────────────────────────────
  app.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // /health is exempt from auth
      if (request.url === '/health') return;

      const token = (request.headers['x-local-token'] as string) || '';
      if (!safeTokenCompare(token, apiToken)) {
        reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid or missing X-Local-Token',
        });
      }
    }
  );

  // ── Health check ──────────────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', version: '1.0.0' };
  });

  // ══════════════════════════════════════════════════════════
  // Credential CRUD
  // ══════════════════════════════════════════════════════════

  // GET /api/credentials
  app.get('/api/credentials', async (request, reply) => {
    try {
      const results = await readAllCredentials();
      return {
        data: results.map(credentialToListJson),
        total: results.length,
      };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/credentials
  app.post('/api/credentials', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Body JSON cannot be empty',
        });
        return;
      }

      // Map snake_case input to camelCase for validation
      const input = mapInputToCamel(body);
      const credentialId = await insertCredential(input);
      reply.code(201).send({
        message: 'Credential created successfully',
        id: credentialId,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/credentials/:id
  app.get<{ Params: { id: string } }>(
    '/api/credentials/:id',
    async (request, reply) => {
      try {
        const cred = await readOneCredential(request.params.id);
        return { data: credentialToSummaryJson(cred) };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // PATCH /api/credentials/:id
  // Fixes: one service transaction for combined metadata+password PATCH
  app.patch<{ Params: { id: string } }>(
    '/api/credentials/:id',
    async (request, reply) => {
      try {
        const body = request.body as any;
        if (!body) {
          reply.code(400).send({
            error: 'Bad Request',
            message: 'Body JSON cannot be empty',
          });
          return;
        }

        const credentialId = request.params.id;
        const newPassword = body.password;

        // Update password if provided
        if (newPassword !== undefined && newPassword !== null) {
          await updateCredentialPassword(credentialId, newPassword);
        }

        // Build metadata update from remaining fields
        const metaBody = { ...body };
        delete metaBody.password;

        if (Object.keys(metaBody).length > 0) {
          const metaInput = mapInputToCamel(metaBody);
          await updateCredentialMetadata(credentialId, metaInput);
        }

        return {
          message: 'Credential updated successfully',
          id: credentialId,
        };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // DELETE /api/credentials/:id
  app.delete<{ Params: { id: string } }>(
    '/api/credentials/:id',
    async (request, reply) => {
      try {
        const result = await deleteCredential(request.params.id);
        return { message: result };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  // Credential + Rules (atomic create)
  // ══════════════════════════════════════════════════════════

  // POST /api/credentials-with-rules
  app.post('/api/credentials-with-rules', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Body JSON cannot be empty',
        });
        return;
      }

      const credData = body.credential;
      const rules = body.rules || [];

      if (!credData) {
        reply.code(400).send({
          error: 'Bad Request',
          message: "Missing 'credential' in body",
        });
        return;
      }

      const mappedCred = mapInputToCamel(credData);
      const mappedRules = rules.map(mapRuleToCamel);

      const credentialId = await createCredentialWithRules(
        mappedCred,
        mappedRules
      );

      reply.code(201).send({
        message: 'Credential and rules created successfully',
        id: credentialId,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Autofill Rule Endpoints
  // ══════════════════════════════════════════════════════════

  // GET /api/credentials/:id/rules
  app.get<{ Params: { id: string } }>(
    '/api/credentials/:id/rules',
    async (request, reply) => {
      try {
        const rules = await listAutofillRules(request.params.id);
        return {
          data: rules.map(ruleToJson),
          total: rules.length,
        };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // POST /api/credentials/:id/rules
  app.post<{ Params: { id: string } }>(
    '/api/credentials/:id/rules',
    async (request, reply) => {
      try {
        const body = request.body as any;
        if (!body) {
          reply.code(400).send({
            error: 'Bad Request',
            message: 'Body JSON cannot be empty',
          });
          return;
        }
        const input = mapRuleToCamel(body);
        const result = await addAutofillRule(request.params.id, input);
        reply.code(201).send({ message: result });
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // PATCH /api/rules/:id
  app.patch<{ Params: { id: string } }>(
    '/api/rules/:id',
    async (request, reply) => {
      try {
        const body = request.body as any;
        if (!body) {
          reply.code(400).send({
            error: 'Bad Request',
            message: 'Body JSON cannot be empty',
          });
          return;
        }
        const input = mapRuleToCamel(body);
        const result = await updateAutofillRule(request.params.id, input);
        return { message: result };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // DELETE /api/rules/:id
  app.delete<{ Params: { id: string } }>(
    '/api/rules/:id',
    async (request, reply) => {
      try {
        const result = await deleteAutofillRule(request.params.id);
        return { message: result };
      } catch (err) {
        return handleError(reply, err);
      }
    }
  );

  // ══════════════════════════════════════════════════════════
  // Autofill Endpoints
  // ══════════════════════════════════════════════════════════

  // POST /api/autofill/candidates
  app.post('/api/autofill/candidates', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Body JSON cannot be empty',
        });
        return;
      }

      if (body.source && body.source !== 'desktop' && body.source !== 'browser') {
        reply.code(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid source. Must be "desktop" or "browser".',
        });
        return;
      }

      const context: AutofillContext = {
        source: body.source || 'desktop',
        domain: body.domain,
        url: body.url,
        processName: body.process_name,
        windowTitle: body.window_title,
      };

      const candidates = await service.findAutofillCandidates(context);
      return {
        data: candidates.map((c) => ({
          credential_id: c.credentialId,
          title: c.title,
          username: c.username,
          priority: c.priority,
          favorite: c.favorite,
        })),
        total: candidates.length,
      };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/autofill/payload
  app.post('/api/autofill/payload', async (request, reply) => {
    try {
      const body = request.body as any;
      const credentialId = body?.credential_id;
      if (!credentialId) {
        reply.code(422).send({
          error: 'VALIDATION_ERROR',
          message: 'Missing credential_id',
        });
        return;
      }
      const payload = await service.getAutofillPayload(credentialId);
      return { data: payload };
    } catch (err) {
      return handleError(reply, err);
    }
  });

  return app;
}

// ── Error handler ─────────────────────────────────────────────

function handleError(reply: FastifyReply, err: unknown): void {
  if (err instanceof ValidationError) {
    reply.code(422).send({
      error: 'Validation Error',
      message: (err as Error).message,
    });
  } else if (err instanceof CredentialNotFoundError || err instanceof RuleNotFoundError) {
    reply.code(404).send({
      error: 'Not Found',
      message: (err as Error).message,
    });
  } else if (err instanceof CredentialStoreError) {
    reply.code(500).send({
      error: 'Store Error',
      // Sanitize — do not expose SQL details
      message: 'An internal error occurred',
    });
  } else {
    console.error('Unhandled API error:', err);
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
}

// ── Input mapping (snake_case API → camelCase internal) ───────

function mapInputToCamel(body: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};
  if (body.title !== undefined) mapped.title = body.title;
  if (body.platform_type !== undefined) mapped.platformType = body.platform_type;
  if (body.platformType !== undefined) mapped.platformType = body.platformType;
  if (body.platform_identifier !== undefined)
    mapped.platformIdentifier = body.platform_identifier;
  if (body.platformIdentifier !== undefined)
    mapped.platformIdentifier = body.platformIdentifier;
  if (body.username !== undefined) mapped.username = body.username;
  if (body.password !== undefined) mapped.password = body.password;
  if (body.totp_secret !== undefined) mapped.totpSecret = body.totp_secret;
  if (body.totpSecret !== undefined) mapped.totpSecret = body.totpSecret;
  if (body.notes !== undefined) mapped.notes = body.notes;
  if (body.url !== undefined) mapped.url = body.url;
  if (body.tags !== undefined) mapped.tags = body.tags;
  if (body.favorite !== undefined) mapped.favorite = body.favorite;
  return mapped;
}

function mapRuleToCamel(body: Record<string, any>): Record<string, any> {
  const mapped: Record<string, any> = {};
  if (body.match_type !== undefined) mapped.matchType = body.match_type;
  if (body.matchType !== undefined) mapped.matchType = body.matchType;
  if (body.match_value !== undefined) mapped.matchValue = body.match_value;
  if (body.matchValue !== undefined) mapped.matchValue = body.matchValue;
  if (body.priority !== undefined) mapped.priority = body.priority;
  if (body.is_enabled !== undefined) mapped.isEnabled = body.is_enabled;
  if (body.isEnabled !== undefined) mapped.isEnabled = body.isEnabled;
  return mapped;
}
