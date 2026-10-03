// src/domain/validation.ts
// Pure validation functions — no DB queries, no side effects.
// Fixes: validators are pure, strictly typed, consistent with verified schema.

import { z } from 'zod';
import type {
  CreateCredentialInput,
  UpdateCredentialInput,
  CreateRuleInput,
  UpdateRuleInput,
  PlatformType,
  MatchType,
} from './types.js';
import { ValidationError } from './errors.js';

// ── Valid enum values matching MariaDB schema ─────────────────

const VALID_PLATFORM_TYPES: readonly PlatformType[] = [
  'web',
  'desktop_app',
  'android_app',
  'other',
] as const;

const VALID_MATCH_TYPES: readonly MatchType[] = [
  'domain',
  'exact_url',
  'process_name',
  'window_title_regex',
  'android_package',
  'resource_id_hint',
] as const;

const MAX_REGEX_LENGTH = 512;

// ── Zod schemas ───────────────────────────────────────────────

const platformTypeSchema = z.enum(
  VALID_PLATFORM_TYPES as unknown as [string, ...string[]]
);

const matchTypeSchema = z.enum(
  VALID_MATCH_TYPES as unknown as [string, ...string[]]
);

const tagsSchema = z
  .array(z.string())
  .optional()
  .default([])
  .transform((tags) => normalizeTags(tags));

const createCredentialSchema = z.object({
  title: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: 'title: not valid' })
    .refine((v) => v.length <= 255, { message: 'title: too long' }),
  platformType: platformTypeSchema,
  platformIdentifier: z
    .string()
    .max(512)
    .nullable()
    .optional()
    .default(null),
  username: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: 'username: not valid' })
    .refine((v) => v.length <= 512, { message: 'username: too long' }),
  // Preserve password bytes including spaces — do not trim
  password: z
    .string()
    .refine((v) => v.length > 0, { message: 'password: not valid' }),
  totpSecret: z
    .string()
    .transform((v) => v.trim())
    .nullable()
    .optional()
    .default(null),
  notes: z
    .string()
    .transform((v) => v.trim())
    .nullable()
    .optional()
    .default(null),
  url: z
    .string()
    .transform((v) => v.trim() || null)
    .nullable()
    .optional()
    .default(null)
    .refine(
      (v) => !v || v.startsWith('http://') || v.startsWith('https://'),
      { message: 'url must start with http:// or https://' }
    ),
  tags: tagsSchema,
  // Strict boolean — no JS truthiness coercion
  favorite: z.boolean().optional().default(false),
});

const updateCredentialSchema = z.object({
  title: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: 'title: not valid' })
    .refine((v) => v.length <= 255, { message: 'title: too long' })
    .optional(),
  platformType: platformTypeSchema.optional(),
  platformIdentifier: z.string().max(512).nullable().optional(),
  username: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: 'username: not valid' })
    .refine((v) => v.length <= 512, { message: 'username: too long' })
    .optional(),
  totpSecret: z.string().transform((v) => v.trim()).nullable().optional(),
  notes: z.string().transform((v) => v.trim()).nullable().optional(),
  url: z
    .string()
    .transform((v) => v.trim() || null)
    .nullable()
    .optional()
    .refine(
      (v) => v === undefined || !v || v.startsWith('http://') || v.startsWith('https://'),
      { message: 'url must start with http:// or https://' }
    ),
  tags: tagsSchema.optional(),
  favorite: z.boolean().optional(),
});

const createRuleSchema = z
  .object({
    matchType: matchTypeSchema,
    matchValue: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, { message: 'match_value: not valid' })
      .refine((v) => v.length <= 2048, { message: 'match_value: too long' }),
    priority: z.number().int().optional().default(0),
    isEnabled: z.boolean().optional().default(true),
  })
  .refine(
    (data) => {
      if (data.matchType === 'window_title_regex') {
        if (data.matchValue.length > MAX_REGEX_LENGTH) return false;
        try {
          new RegExp(data.matchValue);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: 'match_value: invalid or too long regex',
    }
  );

const updateRuleSchema = createRuleSchema;

// ── Public validation functions ───────────────────────────────

export function validateCreateCredential(
  data: unknown
): CreateCredentialInput {
  const result = createCredentialSchema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data as CreateCredentialInput;
}

export function validateUpdateCredential(
  data: unknown
): UpdateCredentialInput {
  const result = updateCredentialSchema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data as UpdateCredentialInput;
}

export function validateCreateRule(data: unknown): CreateRuleInput {
  const result = createRuleSchema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data as CreateRuleInput;
}

export function validateUpdateRule(data: unknown): UpdateRuleInput {
  const result = updateRuleSchema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    throw new ValidationError(messages);
  }
  return result.data as UpdateRuleInput;
}

// ── Normalization helpers ─────────────────────────────────────

/** Normalize tags: trim, lowercase, deduplicate */
export function normalizeTags(tags: string[] | null | undefined): string[] {
  if (!tags || !Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = String(tag).trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/** Normalize domain using URL parsing and hostname extraction */
export function normalizeDomain(value: string): string {
  let cleaned = value.trim().toLowerCase();
  if (!cleaned.includes('://')) {
    cleaned = 'https://' + cleaned;
  }
  try {
    const url = new URL(cleaned);
    return url.hostname || cleaned;
  } catch {
    return cleaned;
  }
}

/** Normalize process name to lowercase basename */
export function normalizeProcessName(value: string): string {
  // Extract basename and normalize to lowercase
  const basename = value.split(/[/\\]/).pop() || value;
  return basename.trim().toLowerCase();
}
