import { describe, it, expect } from 'vitest';
import { buildMatchRequest } from '../../src/services/autofill-matcher.js';
import { BoundedRegexEvaluator } from '../../src/workers/regex-worker.js';

describe('Autofill Matcher & Worker Safety', () => {
  describe('buildMatchRequest', () => {
    it('builds domain and exact_url match requests for browser context', () => {
      const requests = buildMatchRequest({
        source: 'browser',
        url: 'https://auth.github.com/login',
        domain: 'auth.github.com',
      });

      expect(requests).toEqual([
        ['exact_url', 'https://auth.github.com/login'],
        ['domain', 'auth.github.com'],
      ]);
    });

    it('builds process_name match request for desktop context', () => {
      const requests = buildMatchRequest({
        source: 'desktop',
        processName: 'C:\\Windows\\System32\\notepad.exe',
        windowTitle: 'Untitled - Notepad',
      });

      expect(requests).toEqual([['process_name', 'notepad.exe']]);
    });

    it('normalizes domain in browser requests preventing spoofing', () => {
      const requests = buildMatchRequest({
        source: 'browser',
        domain: 'https://evil.com/attacker?target=github.com',
      });

      expect(requests).toEqual([['domain', 'evil.com']]);
    });
  });

  describe('BoundedRegexEvaluator', () => {
    it('evaluates safe regex patterns correctly', async () => {
      const evaluator = new BoundedRegexEvaluator();
      try {
        const matches = await evaluator.test('github.*login', 'GitHub - Login Page');
        expect(matches).toBe(true);

        const noMatch = await evaluator.test('gitlab.*', 'GitHub - Login Page');
        expect(noMatch).toBe(false);
      } finally {
        evaluator.terminate();
      }
    });

    it('safely handles invalid regex patterns without crashing', async () => {
      const evaluator = new BoundedRegexEvaluator();
      try {
        const res = await evaluator.test('[unclosed bracket', 'Some window title');
        expect(res).toBe(false);
      } finally {
        evaluator.terminate();
      }
    });

    it('rejects oversized patterns and strings beyond bounds', async () => {
      const evaluator = new BoundedRegexEvaluator();
      try {
        const oversizedPattern = 'a'.repeat(600);
        const res = await evaluator.test(oversizedPattern, 'text');
        expect(res).toBe(false);
      } finally {
        evaluator.terminate();
      }
    });
  });
});
