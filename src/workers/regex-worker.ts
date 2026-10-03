// src/workers/regex-worker.ts
// Bounded regular expression evaluation worker.
// Protects main loop from catastrophic backtracking (ReDoS).

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

export interface RegexTask {
  pattern: string;
  text: string;
  flags?: string;
}

export interface RegexResult {
  matches: boolean;
  error?: string;
}

// ── Worker Thread Execution ──────────────────────────────────
if (!isMainThread && parentPort) {
  parentPort.on('message', (task: RegexTask) => {
    try {
      if (task.pattern.length > 512 || task.text.length > 4096) {
        parentPort!.postMessage({ matches: false, error: 'Input exceeds maximum length' } satisfies RegexResult);
        return;
      }
      const regex = new RegExp(task.pattern, task.flags ?? 'i');
      const matches = regex.test(task.text);
      parentPort!.postMessage({ matches } satisfies RegexResult);
    } catch (err: any) {
      parentPort!.postMessage({ matches: false, error: err?.message || 'Invalid regex' } satisfies RegexResult);
    }
  });
}

// ── Main Thread Client ───────────────────────────────────────
const WORKER_SCRIPT = __filename;
const DEFAULT_TIMEOUT_MS = 100;

export class BoundedRegexEvaluator {
  private worker: Worker | null = null;
  private pendingReject: ((reason?: any) => void) | null = null;

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(WORKER_SCRIPT);
      this.worker.unref(); // Don't hold node process open
      this.worker.on('error', (err) => {
        if (this.pendingReject) {
          this.pendingReject(err);
          this.pendingReject = null;
        }
        this.terminate();
      });
    }
    return this.worker;
  }

  public async test(pattern: string, text: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (!pattern || !text) return false;
    if (pattern.length > 512 || text.length > 4096) return false;

    // Fast-path test if pattern contains no complex regex quantifiers
    const isSimple = !/([*+?]|\{\d+,?\d*\}).*\1/.test(pattern);
    if (isSimple) {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(text);
      } catch {
        return false;
      }
    }

    // Run in isolated worker with hard timeout
    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const worker = this.getOrCreateWorker();

      const onMessage = (result: RegexResult) => {
        cleanup();
        resolve(result.matches);
      };

      const onError = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        this.pendingReject = null;
      };

      timer = setTimeout(() => {
        cleanup();
        this.terminate(); // Terminate hung worker (catastrophic backtracking)
        resolve(false);
      }, timeoutMs);

      worker.on('message', onMessage);
      worker.on('error', onError);
      this.pendingReject = onError;

      worker.postMessage({ pattern, text } satisfies RegexTask);
    });
  }

  public terminate(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Ignore termination error
      }
      this.worker = null;
    }
  }
}

export const defaultRegexEvaluator = new BoundedRegexEvaluator();
