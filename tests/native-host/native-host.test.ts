import { describe, it, expect } from 'vitest';
import {
  encodeNativeMessage,
  NativeFrameDecoder,
  MAX_NATIVE_FRAME_SIZE,
} from '../../src/autofill/native-protocol.js';

describe('Browser Native Host Protocol Framing', () => {
  it('encodes message with 4-byte little-endian length prefix', () => {
    const payload = { action: 'find_candidates', domain: 'example.com' };
    const encoded = encodeNativeMessage(payload);

    expect(encoded.length).toBeGreaterThan(4);
    const length = encoded.readUInt32LE(0);
    const bodyString = encoded.subarray(4).toString('utf-8');

    expect(encoded.length).toBe(4 + length);
    expect(JSON.parse(bodyString)).toEqual(payload);
  });

  it('decodes single complete frame', () => {
    const decoder = new NativeFrameDecoder();
    const message = { action: 'ping' };
    const encoded = encodeNativeMessage(message);

    const decoded = decoder.push(encoded);
    expect(decoded).toEqual([message]);
  });

  it('decodes frame split across multiple chunks', () => {
    const decoder = new NativeFrameDecoder();
    const message = { action: 'find_candidates', url: 'https://test.com/login' };
    const encoded = encodeNativeMessage(message);

    // Split in half
    const half = Math.floor(encoded.length / 2);
    const chunk1 = encoded.subarray(0, half);
    const chunk2 = encoded.subarray(half);

    const firstPass = decoder.push(chunk1);
    expect(firstPass).toEqual([]); // Incomplete

    const secondPass = decoder.push(chunk2);
    expect(secondPass).toEqual([message]);
  });

  it('decodes multiple frames contained in a single chunk', () => {
    const decoder = new NativeFrameDecoder();
    const msg1 = { action: 'ping', id: '1' };
    const msg2 = { action: 'find_candidates', id: '2' };

    const combined = Buffer.concat([
      encodeNativeMessage(msg1),
      encodeNativeMessage(msg2),
    ]);

    const decoded = decoder.push(combined);
    expect(decoded).toEqual([msg1, msg2]);
  });

  it('rejects oversized frame lengths', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_NATIVE_FRAME_SIZE + 100, 0);

    const decoder = new NativeFrameDecoder();
    expect(() => decoder.push(header)).toThrow('Invalid frame length');
  });

  it('rejects invalid JSON frame body', () => {
    const badBody = Buffer.from('{not-json', 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(badBody.length, 0);

    const decoder = new NativeFrameDecoder();
    expect(() => decoder.push(Buffer.concat([header, badBody]))).toThrow('Invalid JSON in frame body');
  });
});
