// src/shared/ipc.ts
// Renderer-safe IPC contracts — shared between preload and renderer.
// No database, Electron, or Node.js imports allowed here.

/** IPC channel names */
export const IPC_CHANNELS = {
  GET_CANDIDATES: 'vault:getCandidates',
  SELECT_CANDIDATE: 'vault:selectCandidate',
  SAVE_CREDENTIAL: 'vault:saveCredential',
  CANCEL_OPERATION: 'vault:cancelOperation',
  GET_STATUS: 'vault:getStatus',
} as const;

/** Discriminated success/error result types */
export interface IpcSuccess<T> {
  success: true;
  data: T;
}

export interface IpcError {
  success: false;
  code: string;
  message: string;
}

export type IpcResult<T> = IpcSuccess<T> | IpcError;

/** Candidate data visible to renderer (no secrets) */
export interface RendererCandidate {
  credentialId: string;
  title: string;
  username: string;
  priority: number;
  favorite: boolean;
}

/** Credential save input from renderer */
export interface SaveCredentialInput {
  title: string;
  username: string;
  password: string;
  platformType: string;
  platformIdentifier?: string;
}

/** Application status */
export interface AppStatus {
  dbConnected: boolean;
  httpEnabled: boolean;
  httpPort?: number;
  version: string;
}

/** The typed API exposed to renderers via window.vault */
export interface VaultBridgeApi {
  getCandidates(operationId: string): Promise<IpcResult<RendererCandidate[]>>;
  selectCandidate(operationId: string, credentialId: string): Promise<IpcResult<void>>;
  saveCredential(operationId: string, input: SaveCredentialInput): Promise<IpcResult<{ id: string }>>;
  cancelOperation(operationId: string): Promise<IpcResult<void>>;
  getStatus(): Promise<IpcResult<AppStatus>>;
}
