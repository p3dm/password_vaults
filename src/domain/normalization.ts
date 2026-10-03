// src/domain/normalization.ts
// Normalization functions for autofill rules, domain matching, and tags.
// Pure, deterministic, side-effect free.

/** Normalize tags: trim, lowercase, deduplicate, filter empty. */
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

/** Normalize domain using URL parsing and hostname extraction. */
export function normalizeDomain(value: string): string {
  let cleaned = value.trim().toLowerCase();
  if (!cleaned) return '';
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

/** Normalize process name to lowercase basename without directory path. */
export function normalizeProcessName(value: string): string {
  const basename = value.split(/[/\\]/).pop() || value;
  return basename.trim().toLowerCase();
}

/** Escape string for literal regex matching (e.g. captured window titles). */
export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
