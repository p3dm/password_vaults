import { describe, it, expect, vi } from 'vitest';
import { WindowsAutofillAdapter } from '../../src/autofill/windows.js';

describe('Windows Autofill Adapter', () => {
  it('instantiates with custom or default timing options', () => {
    const adapter = new WindowsAutofillAdapter({
      pasteDelayMs: 20,
      tabDelayMs: 100,
      clipboardClearDelayMs: 500,
      autoSubmit: false,
    });

    expect(adapter).toBeDefined();
    expect(typeof adapter.getContext).toBe('function');
    expect(typeof adapter.fill).toBe('function');
  });

  it('safely obtains context with fallback on any environment', () => {
    const adapter = new WindowsAutofillAdapter();
    const context = adapter.getContext();

    expect(context).toBeDefined();
    expect(context.source).toBe('desktop');
  });

  it('handles simulated credential fill execution gracefully', async () => {
    const adapter = new WindowsAutofillAdapter({
      pasteDelayMs: 1,
      tabDelayMs: 1,
      clipboardClearDelayMs: 10,
    });

    // Fill without target HWND
    await expect(adapter.fill('my_username', 'my_password')).resolves.not.toThrow();
  });
});
