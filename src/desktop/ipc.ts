// src/desktop/ipc.ts
// Main-process IPC handler registration.
// Validates requests and delegates to controllers.
// Secrets and DB settings never enter renderer responses.

import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../shared/ipc.js';
import type {
  IpcResult,
  RendererCandidate,
  SaveCredentialInput,
  AppStatus,
} from '../shared/ipc.js';
import { CredentialService } from '../services/credential.js';
import { checkHealth } from '../db/health.js';
import type { AutofillContext, Candidate } from '../domain/types.js';

// ── Operation state ───────────────────────────────────────────
// Main creates operation IDs and stores context/allowed candidates.

interface OperationContext {
  id: string;
  autofillContext: AutofillContext;
  candidates: Candidate[];
  targetHwnd?: any;
  createdAt: number;
}

const activeOperations = new Map<string, OperationContext>();
const OPERATION_TTL_MS = 60_000; // 1 minute

function cleanupStaleOperations(): void {
  const now = Date.now();
  for (const [id, op] of activeOperations) {
    if (now - op.createdAt > OPERATION_TTL_MS) {
      activeOperations.delete(id);
    }
  }
}

// ── Service instance ──────────────────────────────────────────
const service = new CredentialService();

// ── Register handlers ─────────────────────────────────────────

export function registerIpcHandlers(appStatus: {
  httpEnabled: boolean;
  httpPort?: number;
}): void {
  // GET_CANDIDATES
  ipcMain.handle(
    IPC_CHANNELS.GET_CANDIDATES,
    async (event, operationId: string): Promise<IpcResult<RendererCandidate[]>> => {
      try {
        cleanupStaleOperations();
        const op = activeOperations.get(operationId);
        if (!op) {
          return {
            success: false,
            code: 'INVALID_OPERATION',
            message: 'Operation not found or expired',
          };
        }
        return {
          success: true,
          data: op.candidates.map((c) => ({
            credentialId: c.credentialId,
            title: c.title,
            username: c.username,
            priority: c.priority,
            favorite: c.favorite,
          })),
        };
      } catch (err: any) {
        return {
          success: false,
          code: 'INTERNAL_ERROR',
          message: 'Failed to get candidates',
        };
      }
    }
  );

  // SELECT_CANDIDATE
  ipcMain.handle(
    IPC_CHANNELS.SELECT_CANDIDATE,
    async (
      event,
      operationId: string,
      credentialId: string
    ): Promise<IpcResult<void>> => {
      try {
        const op = activeOperations.get(operationId);
        if (!op) {
          return {
            success: false,
            code: 'INVALID_OPERATION',
            message: 'Operation not found or expired',
          };
        }
        // Verify credential is in the allowed candidates
        const allowed = op.candidates.some(
          (c) => c.credentialId === credentialId
        );
        if (!allowed) {
          return {
            success: false,
            code: 'INVALID_SELECTION',
            message: 'Selected credential is not a valid candidate for this operation',
          };
        }
        // Clean up operation
        activeOperations.delete(operationId);
        return { success: true, data: undefined };
      } catch (err: any) {
        return {
          success: false,
          code: 'INTERNAL_ERROR',
          message: 'Failed to select candidate',
        };
      }
    }
  );

  // SAVE_CREDENTIAL
  ipcMain.handle(
    IPC_CHANNELS.SAVE_CREDENTIAL,
    async (
      event,
      operationId: string,
      input: SaveCredentialInput
    ): Promise<IpcResult<{ id: string }>> => {
      try {
        const op = activeOperations.get(operationId);
        if (!op) {
          return {
            success: false,
            code: 'INVALID_OPERATION',
            message: 'Operation not found or expired',
          };
        }

        const credId = await service.savePassword(
          {
            title: input.title,
            username: input.username,
            password: input.password,
            platformType: input.platformType,
            platformIdentifier: input.platformIdentifier,
          },
          op.autofillContext
        );

        activeOperations.delete(operationId);

        if (!credId) {
          return {
            success: false,
            code: 'DUPLICATE',
            message: 'Credential already exists',
          };
        }

        return { success: true, data: { id: credId } };
      } catch (err: any) {
        return {
          success: false,
          code: 'SAVE_FAILED',
          message: err.message ?? 'Failed to save credential',
        };
      }
    }
  );

  // CANCEL_OPERATION
  ipcMain.handle(
    IPC_CHANNELS.CANCEL_OPERATION,
    async (event, operationId: string): Promise<IpcResult<void>> => {
      activeOperations.delete(operationId);
      return { success: true, data: undefined };
    }
  );

  // GET_STATUS
  ipcMain.handle(
    IPC_CHANNELS.GET_STATUS,
    async (): Promise<IpcResult<AppStatus>> => {
      try {
        const health = await checkHealth();
        return {
          success: true,
          data: {
            dbConnected: health.connected,
            httpEnabled: appStatus.httpEnabled,
            httpPort: appStatus.httpPort,
            version: '1.0.0',
          },
        };
      } catch {
        return {
          success: false,
          code: 'STATUS_ERROR',
          message: 'Failed to get status',
        };
      }
    }
  );
}

/** Create a new operation and return its ID with candidates. */
export function createOperation(
  context: AutofillContext,
  candidates: Candidate[],
  targetHwnd?: any
): string {
  cleanupStaleOperations();
  const id = randomUUID();
  activeOperations.set(id, {
    id,
    autofillContext: context,
    candidates,
    targetHwnd,
    createdAt: Date.now(),
  });
  return id;
}

/** Get operation by ID. */
export function getOperation(operationId: string): OperationContext | undefined {
  return activeOperations.get(operationId);
}

/** Remove an operation. */
export function removeOperation(operationId: string): void {
  activeOperations.delete(operationId);
}
