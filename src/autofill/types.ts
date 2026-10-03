// src/autofill/types.ts
// Autofill adapter interface — replaces Python's Protocol base class.

import type { AutofillContext } from '../domain/types.js';

/** Interface for platform-specific autofill adapters. */
export interface AutofillAdapter {
  /** Get the current autofill context from the active window/process. */
  getContext(): AutofillContext;
  /** Fill username and password into the target application. */
  fill(username: string, password: string): Promise<void>;
}
