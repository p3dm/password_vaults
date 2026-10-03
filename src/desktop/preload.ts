// src/desktop/preload.ts
// Preload script — sandbox-compatible context bridge.
// Exposes only a narrow typed window.vault API to renderers.
// No database, filesystem, or raw IPC access exposed.

import { contextBridge, ipcRenderer } from 'electron';
import type { VaultBridgeApi, SaveCredentialInput, IpcResult } from '../shared/ipc.js';
import { IPC_CHANNELS } from '../shared/ipc.js';

const api: VaultBridgeApi = {
  getCandidates(operationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_CANDIDATES, operationId);
  },
  selectCandidate(operationId: string, credentialId: string) {
    return ipcRenderer.invoke(
      IPC_CHANNELS.SELECT_CANDIDATE,
      operationId,
      credentialId
    );
  },
  saveCredential(operationId: string, input: SaveCredentialInput) {
    return ipcRenderer.invoke(
      IPC_CHANNELS.SAVE_CREDENTIAL,
      operationId,
      input
    );
  },
  cancelOperation(operationId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_OPERATION, operationId);
  },
  getStatus() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_STATUS);
  },
};

contextBridge.exposeInMainWorld('vault', api);
