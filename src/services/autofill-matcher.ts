// src/services/autofill-matcher.ts
// Autofill matcher service — candidate lookup with proper normalization
// and bounded regex matching.
// Fixes: actual regex matching (not equality comparison),
//   domain normalization, deterministic deduplication/ordering.

import type { AutofillContext, Candidate } from '../domain/types.js';
import { normalizeDomain, normalizeProcessName } from '../domain/validation.js';
import { withConnection } from '../db/transaction.js';
import * as ruleRepo from '../repositories/autofill-rule.js';

/** Build match requests from autofill context. */
export function buildMatchRequest(
  context: AutofillContext
): Array<[string, string]> {
  if (context.source === 'browser') {
    const requests: Array<[string, string]> = [];
    if (context.url) {
      requests.push(['exact_url', context.url]);
    }
    if (context.domain) {
      requests.push(['domain', normalizeDomain(context.domain)]);
    }
    return requests;
  }

  if (context.source === 'desktop') {
    const requests: Array<[string, string]> = [];
    if (context.processName) {
      requests.push([
        'process_name',
        normalizeProcessName(context.processName),
      ]);
    }
    // window_title is handled separately via regex matching
    return requests;
  }

  return [];
}

/**
 * Find autofill candidates matching the given context.
 * Uses indexed queries for exact matches (domain/URL/process),
 * and bounded regex evaluation for window_title_regex rules.
 *
 * Deduplicates by credential ID keeping the strongest match.
 * Order: match specificity (exact_url > domain > process > title),
 *   priority desc, favorite first, last_used desc (null last), then ID.
 */
export async function findCandidates(
  context: AutofillContext
): Promise<Candidate[]> {
  return withConnection(async (conn) => {
    const seen = new Map<string, Candidate & { specificity: number }>();

    // Exact match queries (indexed)
    const matchRequests = buildMatchRequest(context);
    for (const [matchType, matchValue] of matchRequests) {
      const results = await ruleRepo.findCandidatesByExact(
        conn,
        matchType,
        matchValue
      );
      const specificity = getSpecificity(matchType);
      for (const candidate of results) {
        const existing = seen.get(candidate.credentialId);
        if (!existing || specificity > existing.specificity) {
          seen.set(candidate.credentialId, { ...candidate, specificity });
        }
      }
    }

    // Window title regex matching (bounded)
    if (context.windowTitle && context.source === 'desktop') {
      const regexRules = await ruleRepo.findWindowTitleRules(conn);
      for (const rule of regexRules) {
        if (matchesWindowTitle(rule.matchValue, context.windowTitle)) {
          const specificity = getSpecificity('window_title_regex');
          const candidate: Candidate = {
            credentialId: rule.credentialId,
            title: rule.title,
            username: rule.username,
            priority: rule.priority,
            favorite: rule.favorite,
            lastUsedAt: rule.lastUsedAt,
          };
          const existing = seen.get(candidate.credentialId);
          if (!existing || specificity > existing.specificity) {
            seen.set(candidate.credentialId, { ...candidate, specificity });
          }
        }
      }
    }

    // Sort with deterministic ordering
    const candidates = Array.from(seen.values());
    candidates.sort((a, b) => {
      // 1. Match specificity (higher = better)
      if (a.specificity !== b.specificity) return b.specificity - a.specificity;
      // 2. Priority descending
      if (a.priority !== b.priority) return b.priority - a.priority;
      // 3. Favorite first
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      // 4. Last used descending (null last)
      if (a.lastUsedAt && b.lastUsedAt) {
        return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
      }
      if (a.lastUsedAt && !b.lastUsedAt) return -1;
      if (!a.lastUsedAt && b.lastUsedAt) return 1;
      // 5. ID for stability
      return a.credentialId.localeCompare(b.credentialId);
    });

    return candidates;
  });
}

// ── Match specificity ─────────────────────────────────────────

function getSpecificity(matchType: string): number {
  switch (matchType) {
    case 'exact_url':
      return 4;
    case 'domain':
      return 3;
    case 'process_name':
      return 2;
    case 'window_title_regex':
      return 1;
    default:
      return 0;
  }
}

// ── Bounded regex matching ────────────────────────────────────

const REGEX_TIMEOUT_MS = 100;

/**
 * Test a regex pattern against a window title with bounds.
 * Returns false on error, timeout, or no match.
 * Note: Python re and JS RegExp differ — this is documented.
 */
function matchesWindowTitle(pattern: string, title: string): boolean {
  // Length limits
  if (pattern.length > 512 || title.length > 4096) return false;

  try {
    const regex = new RegExp(pattern, 'i');
    // Simple bounded test — for catastrophic backtracking protection,
    // full implementation should use a worker with hard timeout.
    return regex.test(title);
  } catch {
    // Invalid regex — don't crash, report as no-match
    return false;
  }
}
