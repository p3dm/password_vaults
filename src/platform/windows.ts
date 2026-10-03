// src/platform/windows.ts
// Narrow Win32 adapter using koffi — behind a testable interface.
// Provides: GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
//   OpenProcess, QueryFullProcessImageNameW, CloseHandle,
//   SetForegroundWindow, SendInput.

import koffi, { type LibraryHandle } from 'koffi';

// ── Win32 type definitions ────────────────────────────────────

const HWND = 'void*';
const HANDLE = 'void*';
const DWORD = 'uint32';
const BOOL = 'int32';
const UINT = 'uint32';
const LPWSTR = 'char16*';

// ── Load libraries ────────────────────────────────────────────

let user32: LibraryHandle | null = null;
let kernel32: LibraryHandle | null = null;

try {
  user32 = koffi.load('user32.dll');
  kernel32 = koffi.load('kernel32.dll');
} catch (err) {
  // Non-Windows platform — bindings will throw on use
  console.warn('Win32 libraries not available (non-Windows platform)');
  user32 = null as any;
  kernel32 = null as any;
}

// ── Function bindings ─────────────────────────────────────────

function ensureWin32(): void {
  if (!user32 || !kernel32) {
    throw new Error('Win32 functions not available on this platform');
  }
}

// Lazy-initialized function pointers
let _GetForegroundWindow: (() => any) | null = null;
let _GetWindowTextW: ((hwnd: any, buf: Buffer, maxCount: number) => number) | null = null;
let _GetWindowThreadProcessId: ((hwnd: any, lpdwProcessId: any) => number) | null = null;
let _SetForegroundWindow: ((hwnd: any) => number) | null = null;
let _OpenProcess: ((access: number, inherit: number, pid: number) => any) | null = null;
let _QueryFullProcessImageNameW: ((hProcess: any, flags: number, buf: Buffer, size: any) => number) | null = null;
let _CloseHandle: ((handle: any) => number) | null = null;

function initBindings(): void {
  ensureWin32();
  if (_GetForegroundWindow) return;

  _GetForegroundWindow = user32!.func('GetForegroundWindow', HWND, []);
  _GetWindowTextW = user32!.func('GetWindowTextW', 'int32', [HWND, 'char16*', 'int32']);
  _GetWindowThreadProcessId = user32!.func('GetWindowThreadProcessId', DWORD, [HWND, koffi.out(koffi.pointer('uint32', 1))]);
  _SetForegroundWindow = user32!.func('SetForegroundWindow', BOOL, [HWND]);
  _OpenProcess = kernel32!.func('OpenProcess', HANDLE, [DWORD, BOOL, DWORD]);
  _QueryFullProcessImageNameW = kernel32!.func('QueryFullProcessImageNameW', BOOL, [HANDLE, DWORD, 'char16*', koffi.inout(koffi.pointer('uint32', 1))]);
  _CloseHandle = kernel32!.func('CloseHandle', BOOL, [HANDLE]);
}

// ── Public Win32 interface ────────────────────────────────────

export interface WindowInfo {
  hwnd: any;
  title: string;
  pid: number;
  processName: string;
}

/** Get the foreground window handle. */
export function getForegroundWindow(): any {
  initBindings();
  return _GetForegroundWindow!();
}

/** Get window title text. */
export function getWindowTitle(hwnd: any): string {
  initBindings();
  const buf = Buffer.alloc(1024);
  const len = _GetWindowTextW!(hwnd, buf, 512);
  if (len <= 0) return '';
  return buf.toString('utf16le', 0, len * 2);
}

/** Get process ID from window handle. */
export function getWindowProcessId(hwnd: any): number {
  initBindings();
  const pidBuf = [0];
  _GetWindowThreadProcessId!(hwnd, pidBuf);
  return pidBuf[0];
}

/** Get full process image name from PID. */
export function getProcessName(pid: number): string {
  initBindings();
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const hProcess = _OpenProcess!(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!hProcess) return '';

  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    const ok = _QueryFullProcessImageNameW!(hProcess, 0, buf, size);
    if (!ok) return '';
    const fullPath = buf.toString('utf16le', 0, size[0] * 2);
    // Return just the basename
    const parts = fullPath.split('\\');
    return parts[parts.length - 1] || '';
  } finally {
    _CloseHandle!(hProcess);
  }
}

/** Set foreground window. Returns true if successful. */
export function setForegroundWindow(hwnd: any): boolean {
  initBindings();
  return _SetForegroundWindow!(hwnd) !== 0;
}

/** Get complete info for the foreground window. */
export function getForegroundWindowInfo(): WindowInfo {
  const hwnd = getForegroundWindow();
  const title = getWindowTitle(hwnd);
  const pid = getWindowProcessId(hwnd);
  const processName = pid > 0 ? getProcessName(pid) : '';

  return { hwnd, title, pid, processName };
}
