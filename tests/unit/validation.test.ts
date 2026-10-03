import { describe, it, expect } from 'vitest';
import {
  validateCreateCredential,
  validateUpdateCredential,
  validateCreateRule,
  validateUpdateRule,
} from '../../src/domain/validation.js';
import {
  normalizeDomain,
  normalizeProcessName,
  normalizeTags,
  escapeRegexLiteral,
} from '../../src/domain/normalization.js';
import { ValidationError } from '../../src/domain/errors.js';

describe('Domain Validation & Normalization', () => {
  describe('validateCreateCredential', () => {
    it('validates a valid credential input and preserves password whitespace', () => {
      const input = {
        title: '  GitHub Account  ',
        platformType: 'web',
        platformIdentifier: 'https://github.com',
        username: 'user@example.com',
        password: '  secret password with spaces  ',
        tags: ['Dev', ' work ', 'dev'],
      };

      const result = validateCreateCredential(input);
      expect(result.title).toBe('GitHub Account');
      expect(result.platformType).toBe('web');
      // Password must preserve exact spaces
      expect(result.password).toBe('  secret password with spaces  ');
      // Tags normalized: trimmed, lowercase, deduplicated
      expect(result.tags).toEqual(['dev', 'work']);
    });

    it('rejects empty title, missing password, or invalid platformType', () => {
      expect(() =>
        validateCreateCredential({
          title: '',
          platformType: 'web',
          username: 'u',
          password: 'p',
        })
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateCredential({
          title: 'Title',
          platformType: 'invalid_type',
          username: 'u',
          password: 'p',
        })
      ).toThrow(ValidationError);

      expect(() =>
        validateCreateCredential({
          title: 'Title',
          platformType: 'web',
          username: 'u',
          password: '',
        })
      ).toThrow(ValidationError);
    });
  });

  describe('validateUpdateCredential', () => {
    it('allows partial updates with only present fields', () => {
      const update = validateUpdateCredential({
        title: 'New Title',
        isFavorite: true,
      });

      expect(update.title).toBe('New Title');
      expect(update.isFavorite).toBe(true);
      expect(update.password).toBeUndefined();
      expect(update.username).toBeUndefined();
    });

    it('rejects empty password on update', () => {
      expect(() =>
        validateUpdateCredential({
          password: '',
        })
      ).toThrow(ValidationError);
    });

    it('allows clearing nullable fields with null', () => {
      const update = validateUpdateCredential({
        notes: null,
        totpSecret: null,
      });
      expect(update.notes).toBeNull();
      expect(update.totpSecret).toBeNull();
    });
  });

  describe('validateCreateRule & validateUpdateRule', () => {
    it('validates autofill rule input and enforces valid match types', () => {
      const rule = validateCreateRule({
        credentialId: 'c1234567-0000-0000-0000-000000000000',
        matchType: 'domain',
        matchValue: 'github.com',
        priority: 10,
        isEnabled: true,
      });

      expect(rule.matchType).toBe('domain');
      expect(rule.priority).toBe(10);
      expect(rule.isEnabled).toBe(true);
    });

    it('rejects regex patterns exceeding maximum length', () => {
      const longPattern = 'a'.repeat(600);
      expect(() =>
        validateCreateRule({
          credentialId: 'c1234567-0000-0000-0000-000000000000',
          matchType: 'window_title_regex',
          matchValue: longPattern,
        })
      ).toThrow(ValidationError);
    });
  });

  describe('Normalization helpers', () => {
    it('normalizes domains accurately from various URL formats', () => {
      expect(normalizeDomain('https://login.example.com/path?query=1')).toBe('login.example.com');
      expect(normalizeDomain('http://sub.domain.co.uk:8080/')).toBe('sub.domain.co.uk');
      expect(normalizeDomain('example.org')).toBe('example.org');
      expect(normalizeDomain('  MY-SITE.COM  ')).toBe('my-site.com');
    });

    it('normalizes process names to clean basenames', () => {
      expect(normalizeProcessName('C:\\Program Files\\App\\target.exe')).toBe('target.exe');
      expect(normalizeProcessName('/usr/bin/firefox')).toBe('firefox');
      expect(normalizeProcessName('Chrome.EXE')).toBe('chrome.exe');
    });

    it('normalizes and deduplicates tags', () => {
      expect(normalizeTags([' Personal ', 'WORK', 'personal', 'Finance'])).toEqual([
        'personal',
        'work',
        'finance',
      ]);
      expect(normalizeTags(null)).toEqual([]);
    });

    it('escapes regex special characters safely', () => {
      const literal = 'Sign In - Google Chrome (Incognito) [v1.0]';
      const escaped = escapeRegexLiteral(literal);
      expect(escaped).toBe('Sign In - Google Chrome \\(Incognito\\) \\[v1\\.0\\]');
      expect(new RegExp(escaped).test(literal)).toBe(true);
    });
  });
});
