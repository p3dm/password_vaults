// src/desktop/windows.ts
// BrowserWindow creation and management for Electron desktop UI.
// Candidate selection popup, save form, and notifications.

import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import type { Candidate } from '../domain/types.js';

let candidateWindow: BrowserWindow | null = null;
let saveWindow: BrowserWindow | null = null;

const PRELOAD_PATH = join(__dirname, 'preload.js');

/** Create and show the candidate selection popup. */
export function showCandidatePopup(
  operationId: string,
  candidates: Candidate[]
): BrowserWindow {
  if (candidateWindow && !candidateWindow.isDestroyed()) {
    candidateWindow.close();
  }

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  candidateWindow = new BrowserWindow({
    width: 520,
    height: Math.min(300 + candidates.length * 40, 600),
    x: Math.round(screenW / 2 - 260),
    y: Math.round(screenH / 2 - 200),
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Restrict navigation and new window creation
  candidateWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  candidateWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Load the candidate selection page
  candidateWindow.loadFile(
    join(__dirname, 'renderer', 'candidate.html')
  );

  candidateWindow.once('ready-to-show', () => {
    candidateWindow?.show();
    candidateWindow?.focus();
  });

  candidateWindow.on('closed', () => {
    candidateWindow = null;
  });

  return candidateWindow;
}

/** Create and show the save credential popup. */
export function showSavePopup(
  operationId: string,
  contextInfo: { processName?: string; windowTitle?: string }
): BrowserWindow {
  if (saveWindow && !saveWindow.isDestroyed()) {
    saveWindow.close();
  }

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  saveWindow = new BrowserWindow({
    width: 480,
    height: 450,
    x: Math.round(screenW / 2 - 240),
    y: Math.round(screenH / 2 - 225),
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    frame: false,
    transparent: false,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  saveWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  saveWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  saveWindow.loadFile(join(__dirname, 'renderer', 'save.html'));

  saveWindow.once('ready-to-show', () => {
    saveWindow?.show();
    saveWindow?.focus();
  });

  saveWindow.on('closed', () => {
    saveWindow = null;
  });

  return saveWindow;
}

/** Close all popup windows. */
export function closeAllPopups(): void {
  if (candidateWindow && !candidateWindow.isDestroyed()) {
    candidateWindow.close();
    candidateWindow = null;
  }
  if (saveWindow && !saveWindow.isDestroyed()) {
    saveWindow.close();
    saveWindow = null;
  }
}

/** Show a toast notification at bottom-right of screen. */
export function showNotification(message: string, durationMs: number = 3000): void {
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  const notifWindow = new BrowserWindow({
    width: 400,
    height: 80,
    x: screenW - 420,
    y: screenH - 100,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  notifWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head><style>
      body {
        margin: 0; padding: 12px 20px;
        background: #1e1e2e; color: #cdd6f4;
        font-family: 'Segoe UI', sans-serif; font-size: 13px;
        border-radius: 8px; border: 1px solid #45475a;
        display: flex; align-items: center;
        -webkit-app-region: no-drag;
      }
    </style></head>
    <body>${message}</body>
    </html>
  `)}`
  );

  notifWindow.once('ready-to-show', () => {
    notifWindow.show();
    setTimeout(() => {
      if (!notifWindow.isDestroyed()) notifWindow.close();
    }, durationMs);
  });
}
