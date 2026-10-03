import { describe, it, expect, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc.js';
import { createOperation, getOperation, removeOperation } from '../../src/desktop/ipc.js';
import type { Candidate } from '../../src/domain/types.js';

describe('Desktop IPC Operation & Channel Management', () => {
  it('defines stable IPC channels matching contract', () => {
    expect(IPC_CHANNELS.GET_CANDIDATES).toBe('vault:get-candidates');
    expect(IPC_CHANNELS.SELECT_CANDIDATE).toBe('vault:select-candidate');
    expect(IPC_CHANNELS.SAVE_CREDENTIAL).toBe('vault:save-credential');
    expect(IPC_CHANNELS.CANCEL_OPERATION).toBe('vault:cancel-operation');
    expect(IPC_CHANNELS.GET_STATUS).toBe('vault:get-status');
  });

  it('creates and manages operation context securely', () => {
    const candidates: Candidate[] = [
      {
        credentialId: 'cred-1',
        title: 'Work Account',
        username: 'alice',
        priority: 5,
        favorite: true,
        lastUsedAt: new Date(),
      },
    ];

    const opId = createOperation(
      { source: 'desktop', processName: 'chrome.exe' },
      candidates,
      12345
    );

    expect(opId).toBeDefined();
    expect(typeof opId).toBe('string');

    const op = getOperation(opId);
    expect(op).toBeDefined();
    expect(op?.id).toBe(opId);
    expect(op?.targetHwnd).toBe(12345);
    expect(op?.candidates.length).toBe(1);
    expect(op?.candidates[0].username).toBe('alice');

    // Remove operation
    removeOperation(opId);
    expect(getOperation(opId)).toBeUndefined();
  });

  it('returns undefined for non-existent or stale operations', () => {
    expect(getOperation('non-existent-op-id')).toBeUndefined();
  });
});
