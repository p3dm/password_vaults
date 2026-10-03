// src/domain/types.ts
// Domain types and DTOs — no passwords in summary/candidate projections.

/** Platform type enum matching MariaDB ENUM values */
export type PlatformType = 'web' | 'desktop_app' | 'android_app' | 'other';

/** Match type enum matching MariaDB ENUM values */
export type MatchType =
  | 'domain'
  | 'exact_url'
  | 'process_name'
  | 'window_title_regex'
  | 'android_package'
  | 'resource_id_hint';

/** Full credential record (internal use — contains secrets) */
export interface CredentialRecord {
  id: string;
  title: string;
  platformType: PlatformType;
  platformIdentifier: string | null;
  username: string;
  password: string;
  totpSecret: string | null;
  notes: string | null;
  url: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

/** Credential summary — NO password, NO totp_secret */
export interface CredentialSummary {
  id: string;
  title: string;
  platformType: PlatformType;
  platformIdentifier: string | null;
  username: string;
  notes: string | null;
  url: string | null;
  tags: string[];
  favorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}

/** Secret payload for autofill — only username + password */
export interface CredentialSecret {
  username: string;
  password: string;
}

/** Autofill candidate — no password, no totp_secret */
export interface Candidate {
  credentialId: string;
  title: string;
  username: string;
  priority: number;
  favorite: boolean;
  lastUsedAt: Date | null;
}

/** Autofill rule record */
export interface AutofillRuleRecord {
  id: string;
  credentialId: string;
  matchType: MatchType;
  matchValue: string;
  priority: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Password history record */
export interface PasswordHistoryRecord {
  id: string;
  credentialId: string;
  password: string;
  changedAt: Date;
}

/** Error log record */
export interface ErrorLogRecord {
  id: string;
  eventType: string;
  objectId: string | null;
  message: string;
  createdAt: Date;
}

/** Information log record */
export interface InforLogRecord {
  id: string;
  eventType: string;
  objectId: string | null;
  message: string;
  createdAt: Date;
}

/** Create credential input */
export interface CreateCredentialInput {
  title: string;
  platformType: PlatformType;
  platformIdentifier?: string | null;
  username: string;
  password: string;
  totpSecret?: string | null;
  notes?: string | null;
  url?: string | null;
  tags?: string[];
  favorite?: boolean;
}

/** Update credential metadata input (partial) */
export interface UpdateCredentialInput {
  title?: string;
  platformType?: PlatformType;
  platformIdentifier?: string | null;
  username?: string;
  password?: string;
  totpSecret?: string | null;
  notes?: string | null;
  url?: string | null;
  tags?: string[];
  favorite?: boolean;
}

/** Create autofill rule input */
export interface CreateRuleInput {
  matchType: MatchType;
  matchValue: string;
  priority?: number;
  isEnabled?: boolean;
}

/** Update autofill rule input */
export interface UpdateRuleInput {
  matchType: MatchType;
  matchValue: string;
  priority?: number;
  isEnabled?: boolean;
}

/** Autofill context for matching */
export interface AutofillContext {
  source: 'browser' | 'desktop';
  domain?: string;
  url?: string;
  processName?: string;
  windowTitle?: string;
}
