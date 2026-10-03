// src/entrypoints/native-host.ts
// Browser native messaging host — length-prefixed UTF-8 JSON on stdin/stdout.
// Authenticated client of the running Electron application's HTTP API.
// No DB pool, no Electron windows, no application lifecycle ownership.

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(__dirname, '..', '..', '.env') });

const API_BASE = `http://${process.env.LOCAL_API_HOST || '127.0.0.1'}:${
  process.env.LOCAL_API_PORT || '8765'
}`;
const API_TOKEN = process.env.LOCAL_API_TOKEN || '';

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB

// ── Message framing ───────────────────────────────────────────

/**
 * Read one native messaging frame from stdin.
 * Format: 4-byte little-endian uint32 length prefix + UTF-8 JSON body.
 */
function readMessage(stdin: NodeJS.ReadableStream): Promise<any> {
  return new Promise((resolve, reject) => {
    let headerBuf = Buffer.alloc(0);

    const readHeader = () => {
      const chunk = stdin.read(4 - headerBuf.length);
      if (!chunk) {
        stdin.once('readable', readHeader);
        return;
      }
      const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      headerBuf = Buffer.concat([headerBuf, chunkBuf]);
      if (headerBuf.length < 4) {
        stdin.once('readable', readHeader);
        return;
      }

      const length = headerBuf.readUInt32LE(0);
      if (length === 0 || length > MAX_MESSAGE_SIZE) {
        reject(new Error(`Invalid message length: ${length}`));
        return;
      }

      let bodyBuf = Buffer.alloc(0);
      const readBody = () => {
        const chunk = stdin.read(length - bodyBuf.length);
        if (!chunk) {
          stdin.once('readable', readBody);
          return;
        }
        const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyBuf = Buffer.concat([bodyBuf, chunkBuf]);
        if (bodyBuf.length < length) {
          stdin.once('readable', readBody);
          return;
        }

        try {
          const message = JSON.parse(bodyBuf.toString('utf-8'));
          resolve(message);
        } catch (err) {
          reject(new Error('Invalid JSON in message body'));
        }
      };
      readBody();
    };
    readHeader();

    stdin.on('end', () => reject(new Error('stdin EOF')));
    stdin.on('error', reject);
  });
}

/**
 * Write one native messaging frame to stdout.
 */
function writeMessage(data: any): void {
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

/**
 * Write an error response.
 */
function writeError(code: string, message: string): void {
  writeMessage({ success: false, error: code, message });
}

// ── API client ────────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Local-Token': API_TOKEN,
  };

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

// ── Message handler ───────────────────────────────────────────

async function handleMessage(message: any): Promise<void> {
  const { action } = message;

  try {
    switch (action) {
      case 'getCandidates': {
        const result = await apiRequest('POST', '/api/autofill/candidates', {
          source: 'browser',
          domain: message.domain,
          url: message.url,
        });
        writeMessage({ success: true, ...result });
        break;
      }

      case 'getPayload': {
        if (!message.credential_id) {
          writeError('MISSING_PARAM', 'credential_id is required');
          return;
        }
        const result = await apiRequest('POST', '/api/autofill/payload', {
          credential_id: message.credential_id,
        });
        writeMessage({ success: true, ...result });
        break;
      }

      case 'health': {
        const result = await apiRequest('GET', '/health');
        writeMessage({ success: true, ...result });
        break;
      }

      default:
        writeError('UNKNOWN_ACTION', `Unknown action: ${action}`);
    }
  } catch (err: any) {
    // API unavailable
    writeError('API_UNAVAILABLE', err.message || 'Electron API is not available');
  }
}

// ── Main loop ─────────────────────────────────────────────────

async function main(): Promise<void> {
  // Diagnostic output to stderr only
  process.stderr.write('Password Vault native host started\n');

  if (!API_TOKEN) {
    process.stderr.write('Warning: LOCAL_API_TOKEN not configured\n');
  }

  while (true) {
    try {
      const message = await readMessage(process.stdin);
      await handleMessage(message);
    } catch (err: any) {
      if (err.message === 'stdin EOF') {
        break; // Browser closed the connection
      }
      process.stderr.write(`Error: ${err.message}\n`);
      break;
    }
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
