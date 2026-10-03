// src/domain/errors.ts
// Domain exceptions — consistent error types for API/IPC handling.

/** Base error for all credential store operations. */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

/** Backward compatibility alias */
export const VaultError = CredentialStoreError;

/** Credential with given ID does not exist. */
export class CredentialNotFoundError extends CredentialStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialNotFoundError';
  }
}

/** Input data failed validation. */
export class ValidationError extends CredentialStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Autofill rule already exists for item + match_type + match_value. */
export class DuplicateAutofillRuleError extends CredentialStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateAutofillRuleError';
  }
}

/** Request to local API has invalid or missing token. */
export class LocalApiUnauthorizedError extends CredentialStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'LocalApiUnauthorizedError';
  }
}

/** Autofill rule not found. */
export class RuleNotFoundError extends CredentialStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'RuleNotFoundError';
  }
}
