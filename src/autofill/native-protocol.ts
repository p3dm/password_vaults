// src/autofill/native-protocol.ts
// Native messaging protocol framing and message types.
// Used by browser native host and test harnesses.

import type { AutofillContext, Candidate } from '../domain/types.js';

export const MAX_NATIVE_FRAME_SIZE = 1024 * 1024; // 1 MB

export type NativeMessageAction = 'find_candidates' | 'get_payload' | 'ping';

export interface NativeBaseRequest {
  id?: string;
  action: NativeMessageAction;
}

export interface NativeFindCandidatesRequest extends NativeBaseRequest {
  action: 'find_candidates';
  context: AutofillContext;
}

export interface NativeGetPayloadRequest extends NativeBaseRequest {
  action: 'get_payload';
  credentialId: string;
  context: AutofillContext;
}

export interface NativePingRequest extends NativeBaseRequest {
  action: 'ping';
}

export type NativeRequest =
  | NativeFindCandidatesRequest
  | NativeGetPayloadRequest
  | NativePingRequest;

export interface NativeSuccessResponse<T = any> {
  id?: string;
  success: true;
  data: T;
}

export interface NativeErrorResponse {
  id?: string;
  success: false;
  error: string;
  message: string;
}

export type NativeResponse<T = any> = NativeSuccessResponse<T> | NativeErrorResponse;

/** Encode JSON message into 4-byte little-endian length prefix + UTF-8 payload. */
export function encodeNativeMessage(message: unknown): Buffer {
  const jsonStr = JSON.stringify(message);
  const bodyBuf = Buffer.from(jsonStr, 'utf-8');
  if (bodyBuf.length > MAX_NATIVE_FRAME_SIZE) {
    throw new Error(`Message exceeds maximum size: ${bodyBuf.length} > ${MAX_NATIVE_FRAME_SIZE}`);
  }
  const headerBuf = Buffer.alloc(4);
  headerBuf.writeUInt32LE(bodyBuf.length, 0);
  return Buffer.concat([headerBuf, bodyBuf]);
}

/** Decode native frames from an incoming stream buffer chunk by chunk. */
export class NativeFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  public push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_NATIVE_FRAME_SIZE) {
        this.buffer = Buffer.alloc(0);
        throw new Error(`Invalid frame length: ${length}`);
      }
      if (this.buffer.length < 4 + length) {
        break; // Wait for rest of frame
      }
      const frameBody = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        const parsed = JSON.parse(frameBody.toString('utf-8'));
        messages.push(parsed);
      } catch (err: any) {
        throw new Error(`Invalid JSON in frame body: ${err.message}`);
      }
    }

    return messages;
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
